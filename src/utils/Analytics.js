// Product analytics for EmailVerify, sent to PostHog.
//
// Config-driven and fail-safe, mirroring OperatorWebhook: when the `posthog`
// config block is missing/disabled or no API key is set, every export becomes a
// silent no-op so the bot runs unchanged. One PostHog client is created per shard
// process (the bot is sharded — see sharder.js); posthog-node batches events and
// flushes on its own interval, and we flush explicitly on shutdown.
//
// Privacy: Discord user ids are never sent raw. They're turned into a stable
// salted-SHA-256 pseudonym so per-user funnels/retention still work while the raw
// id (and email addresses) never leave the process. Server-scoped events also
// carry a PostHog `guild` group so per-server analytics work independently.

const crypto = require('crypto')
const config = require('../../config/config.json')

const phCfg = config.posthog || {}
const enabled = !!phCfg.enabled && typeof phCfg.apiKey === 'string' && phCfg.apiKey.trim().length > 0
const host = (phCfg.host && String(phCfg.host).trim()) || 'https://eu.i.posthog.com'
// Salt for hashing user ids into stable pseudonyms. Prefer an explicit salt;
// fall back to the bot token (secret + stable across restarts) so no extra
// config is required. If the token ever rotates, historical pseudonyms simply
// stop matching new ones — acceptable and rare.
const salt = (phCfg.salt && String(phCfg.salt)) || config.token || 'emailverify'

const GUILD_GROUP_TYPE = 'guild'

let client = null
if (enabled) {
    try {
        const { PostHog } = require('posthog-node')
        client = new PostHog(phCfg.apiKey.trim(), { host })
    } catch (err) {
        console.error('[Analytics] PostHog disabled — init failed:', err?.message || err)
        client = null
    }
}

/** Stable pseudonymous distinct id for a Discord user id. Never reversible to the raw id. */
function hashUser(userId) {
    return 'u_' + crypto.createHash('sha256').update(`${salt}:${userId}`).digest('hex').slice(0, 32)
}

/**
 * Capture an event. Fire-and-forget; never throws into the bot flow.
 *
 * distinct_id resolution:
 *   - a user is involved  → hashed user pseudonym (creates a person profile)
 *   - only a guild        → `guild_<id>` (no person profile)
 *   - neither             → `system` (bot lifecycle events)
 *
 * @param {Object}  opts
 * @param {string}  opts.event                 event name (required)
 * @param {string}  [opts.userId]              Discord user id (hashed before send)
 * @param {string}  [opts.guildId]             Discord guild id (attached as a `guild` group)
 * @param {import('discord.js').Guild} [opts.guild] resolved guild (for id + name)
 * @param {Object}  [opts.properties]          extra event properties
 */
function capture({ event, userId = null, guildId = null, guild = null, properties = {} } = {}) {
    if (!client || !event) return
    try {
        const gid = guildId || guild?.id || null
        const hasUser = !!userId
        const distinctId = hasUser ? hashUser(userId) : (gid ? `guild_${gid}` : 'system')

        const props = { ...properties }
        if (gid) props.guild_id = gid
        if (guild?.name) props.guild_name = guild.name
        // Don't spin up person profiles for guild/system-scoped events.
        if (!hasUser) props.$process_person_profile = false

        const payload = { distinctId, event, properties: props }
        if (gid) payload.groups = { [GUILD_GROUP_TYPE]: gid }

        client.capture(payload)
    } catch (err) {
        console.error('[Analytics] capture failed:', err?.message || err)
    }
}

/**
 * Set/refresh properties on a guild group (name, member count) so PostHog group
 * analytics can label servers. Safe to call repeatedly; call on guild join and boot.
 * @param {import('discord.js').Guild} guild
 */
function identifyGuild(guild) {
    if (!client || !guild?.id) return
    try {
        const properties = { name: guild.name }
        if (typeof guild.memberCount === 'number') properties.member_count = guild.memberCount
        client.groupIdentify({ groupType: GUILD_GROUP_TYPE, groupKey: guild.id, properties })
    } catch (err) {
        console.error('[Analytics] groupIdentify failed:', err?.message || err)
    }
}

/** Flush and stop the client. Call once on shard shutdown so buffered events aren't lost. */
async function shutdown() {
    if (!client) return
    try {
        await client.shutdown()
    } catch (err) {
        console.error('[Analytics] shutdown failed:', err?.message || err)
    }
}

module.exports = {
    capture,
    identifyGuild,
    shutdown,
    hashUser,
    get enabled() { return !!client }
}
