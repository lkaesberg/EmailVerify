// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Self-diagnosis for the two ways a correctly-configured server still fails:
//
//  1. the bot was invited without the permissions it needs (the old invite link
//     asked for neither Embed Links nor Attach Files, so embeds and /export could
//     fail on a server that granted exactly what was asked for), and
//  2. the bot HAS Manage Roles but its own role sits below the role it is told to
//     hand out. Discord silently refuses that with a bare 50013, which used to
//     surface as a generic "role assignment failed".
//
// Both are invisible until a real member tries to verify and it is too late. Everything
// here answers the same question — "can the bot actually do what it was configured to
// do, right now" — so the check, the invite link and the wording live in one place and
// are reused by /status, /setup, the role commands, guildCreate and the failure path.

const Discord = require('discord.js')
const { PermissionsBitField } = Discord
const { getLocale } = require('../Language')
const { clientId } = require('../../config/config.json')

const Flags = PermissionsBitField.Flags

// Each permission carries the label Discord shows in its own settings UI (`nameKey`,
// localized — the admin has to find the exact checkbox), plus the stable English `name`
// used for logs and analytics so a dashboard is not split across ten languages.
const REQUIRED_PERMISSIONS = [
    { flag: Flags.ManageRoles, name: 'Manage Roles', nameKey: 'permNameManageRoles', whyKey: 'permWhyManageRoles' },
    { flag: Flags.ViewChannel, name: 'View Channels', nameKey: 'permNameViewChannel', whyKey: 'permWhyViewChannel' },
    { flag: Flags.SendMessages, name: 'Send Messages', nameKey: 'permNameSendMessages', whyKey: 'permWhySendMessages' },
    { flag: Flags.EmbedLinks, name: 'Embed Links', nameKey: 'permNameEmbedLinks', whyKey: 'permWhyEmbedLinks' }
]

// Absent these, the bot still verifies members; specific features degrade instead.
const RECOMMENDED_PERMISSIONS = [
    { flag: Flags.ReadMessageHistory, name: 'Read Message History', nameKey: 'permNameReadHistory', whyKey: 'permWhyReadHistory' },
    { flag: Flags.AttachFiles, name: 'Attach Files', nameKey: 'permNameAttachFiles', whyKey: 'permWhyAttachFiles' },
    { flag: Flags.ViewAuditLog, name: 'View Audit Log', nameKey: 'permNameViewAuditLog', whyKey: 'permWhyViewAuditLog' }
]

/** The label Discord itself shows for this permission, in the guild's language. */
function permissionLabel(permission, language) {
    return permission.nameKey ? getLocale(language, permission.nameKey) : permission.name
}

/** Bits the invite link should ask for: everything above, required and recommended. */
const INVITE_PERMISSION_BITS = [...REQUIRED_PERMISSIONS, ...RECOMMENDED_PERMISSIONS]
    .reduce((bits, p) => bits | p.flag, 0n)

/**
 * OAuth URL that grants exactly the permissions this module checks for.
 *
 * Re-inviting an already-present bot does not remove it or reset anything — Discord
 * just updates the managed role's permissions — so this is the safe one-click fix to
 * offer an admin who does not want to hand-edit role permissions.
 */
function buildInviteUrl() {
    return 'https://discord.com/oauth2/authorize'
        + `?client_id=${clientId}`
        + `&permissions=${INVITE_PERMISSION_BITS.toString()}`
        + '&scope=bot%20applications.commands'
}

/**
 * The bot's own GuildMember, fetching it when the guild came from REST (a cross-shard
 * `guilds.fetch` has no member cache, so `guild.members.me` is null there).
 * Returns null when even the fetch fails.
 */
async function resolveSelfMember(guild) {
    if (!guild) return null
    if (guild.members?.me) return guild.members.me
    // Defensive rather than merely optional: every caller runs either inside a database
    // callback or on an error path, where a throw becomes an unhandled rejection instead
    // of a caught failure. Returning null degrades to "could not determine", which every
    // caller already handles as "report nothing".
    if (typeof guild.members?.fetchMe !== 'function') return null
    try {
        return await guild.members.fetchMe()
    } catch {
        return null
    }
}

/**
 * Guild-wide permission audit.
 *
 * Guild-level permissions are checked rather than per-channel ones because role
 * assignment — the thing that actually breaks — is guild-level, and a channel override
 * can only ever be diagnosed against a channel we already know about (see
 * checkChannelPermissions for that).
 *
 * @returns {Promise<{ok: boolean, resolved: boolean, missingRequired: Array, missingRecommended: Array, self: ?import('discord.js').GuildMember}>}
 *          `resolved: false` means we could not determine anything (member fetch failed)
 *          and callers must not report a problem.
 */
async function checkGuildPermissions(guild) {
    const self = await resolveSelfMember(guild)
    if (!self) {
        return { ok: true, resolved: false, missingRequired: [], missingRecommended: [], self: null }
    }

    const perms = self.permissions
    const missingRequired = REQUIRED_PERMISSIONS.filter(p => !perms.has(p.flag))
    const missingRecommended = RECOMMENDED_PERMISSIONS.filter(p => !perms.has(p.flag))

    return {
        ok: missingRequired.length === 0,
        resolved: true,
        missingRequired,
        missingRecommended,
        self
    }
}

/**
 * Permissions the bot is missing *in one specific channel* (overrides included).
 * A server can grant Send Messages globally and deny it on the verify channel; that
 * only shows up here.
 *
 * @returns {Promise<{ok: boolean, resolved: boolean, missing: Array}>}
 */
async function checkChannelPermissions(guild, channelId, required = [Flags.ViewChannel, Flags.SendMessages, Flags.EmbedLinks]) {
    const self = await resolveSelfMember(guild)
    if (!self || !channelId || !guild.channels) return { ok: true, resolved: false, missing: [] }

    const channel = guild.channels.cache?.get(channelId)
        || await guild.channels.fetch?.(channelId).catch(() => null)
        || null
    if (!channel?.isTextBased?.()) return { ok: true, resolved: false, missing: [] }

    const perms = channel.permissionsFor(self)
    if (!perms) return { ok: true, resolved: false, missing: [] }

    const all = [...REQUIRED_PERMISSIONS, ...RECOMMENDED_PERMISSIONS]
    const missing = required
        .filter(flag => !perms.has(flag))
        .map(flag => all.find(p => p.flag === flag) || { flag, name: String(flag) })

    return { ok: missing.length === 0, resolved: true, missing }
}

/**
 * Which of these roles the bot cannot hand out, and why.
 *
 * Three distinct causes, each with a different fix, which is exactly why the old single
 * "role assignment failed" message was unhelpful:
 *  - `managed`: a role owned by another bot, an integration, or Nitro boosting. Nobody
 *    can assign these, so no permission or reordering will ever help.
 *  - `everyone`: the @everyone role, which is not assignable either.
 *  - `hierarchy`: the role sits at or above the bot's highest role. Fixed by dragging
 *    the bot's role up — this is the common case.
 *
 * @param {import('discord.js').Guild} guild
 * @param {Array<string|import('discord.js').Role>} roles ids or resolved roles
 * @returns {Promise<{resolved: boolean, botRole: ?import('discord.js').Role, unassignable: Array<{role: object, reason: string}>}>}
 */
async function findUnassignableRoles(guild, roles) {
    const self = await resolveSelfMember(guild)
    if (!self) return { resolved: false, botRole: null, unassignable: [] }

    const botRole = self.roles.highest
    const unassignable = []

    for (const entry of roles || []) {
        const role = typeof entry === 'string' ? guild.roles?.cache?.get(entry) : entry
        if (!role) continue                                   // deleted roles are a separate problem
        if (role.id === guild.id) { unassignable.push({ role, reason: 'everyone' }); continue }
        if (role.managed) { unassignable.push({ role, reason: 'managed' }); continue }
        if (botRole && role.position >= botRole.position) unassignable.push({ role, reason: 'hierarchy' })
    }

    return { resolved: true, botRole, unassignable }
}

/** Every role id the guild config expects the bot to be able to assign. */
function configuredRoleIds(serverSettings) {
    const ids = new Set(serverSettings.defaultRoles || [])
    for (const roleIds of Object.values(serverSettings.domainRoles || {})) {
        for (const id of roleIds || []) ids.add(id)
    }
    if (serverSettings.unverifiedRoleName) ids.add(serverSettings.unverifiedRoleName)
    return [...ids]
}

/**
 * Audit everything the guild is configured to do: permissions plus every role it expects
 * the bot to hand out. This is what /status and the startup sweep report on.
 *
 * @returns {Promise<{resolved: boolean, ok: boolean, permissions: object, roles: object}>}
 */
async function auditGuild(guild, serverSettings) {
    const permissions = await checkGuildPermissions(guild)
    const roles = await findUnassignableRoles(guild, configuredRoleIds(serverSettings))

    // Channel overrides are checked separately: a server can grant Send Messages
    // server-wide and deny it on the one channel holding the verify button, which the
    // guild-level check above cannot see.
    const channels = []
    for (const [key, id] of [['verify', serverSettings.channelID], ['log', serverSettings.logChannel]]) {
        if (!id) continue
        const result = await checkChannelPermissions(guild, id)
        if (result.resolved && !result.ok) channels.push({ kind: key, id, missing: result.missing })
    }

    return {
        resolved: permissions.resolved,
        ok: permissions.ok && roles.unassignable.length === 0 && channels.length === 0,
        permissions,
        roles,
        channels
    }
}

/** `• **Manage Roles** — why it is needed` lines for an embed. */
function formatPermissionList(list, language) {
    return list.map(p => `• **${permissionLabel(p, language)}** — ${getLocale(language, p.whyKey)}`).join('\n')
}

/** `• @Role — is above the bot's own role` lines, one per unassignable role. */
function formatUnassignableList(unassignable, language) {
    const reasonKey = {
        hierarchy: 'permReasonHierarchy',
        managed: 'permReasonManaged',
        everyone: 'permReasonEveryone'
    }
    return unassignable
        .map(({ role, reason }) => {
            // <@&guildId> IS the @everyone mention, so that one role is rendered as
            // inert code rather than a mention that would ping the whole server.
            const label = reason === 'everyone' ? '`@everyone`' : `<@&${role.id}>`
            return `• ${label} — ${getLocale(language, reasonKey[reason] || 'permReasonHierarchy')}`
        })
        .join('\n')
}

/** `• #channel — missing Send Messages, Embed Links` lines, one per affected channel. */
function formatChannelIssues(channels, language) {
    return channels
        .map(c => `• <#${c.id}> — ${getLocale(language, 'permChannelMissing',
            c.missing.map(p => `**${permissionLabel(p, language)}**`).join(', '))}`)
        .join('\n')
}

/**
 * The "here is exactly what to drag where" block. Written as numbered steps because the
 * fix is a physical drag in a UI the admin may never have opened, and because the
 * previous wording ("ensure the bot's role is higher") described the end state without
 * saying how to reach it.
 */
function formatHierarchyFix(botRole, language) {
    const botRoleLabel = botRole ? `<@&${botRole.id}>` : getLocale(language, 'permBotRoleFallback')
    return getLocale(language, 'permHierarchyFix', botRoleLabel)
}

/**
 * Admin-facing report of every problem auditGuild found, as one markdown block.
 *
 * Plain markdown rather than an embed with fields, because the single destination that
 * matters — ErrorNotifier — renders its own embed and is what the guild has already
 * configured (channel, ping, DM opt-ins). Returns null when there is nothing to report,
 * so callers can use it directly as their "should I notify" test.
 *
 * @returns {?string}
 */
function buildPermissionIssueReport(guild, audit, language) {
    if (!audit.resolved || audit.ok) return null

    const sections = [getLocale(language, 'permIssueIntro')]

    if (audit.permissions.missingRequired.length > 0) {
        sections.push(`**${getLocale(language, 'permFieldMissingRequired')}**\n`
            + formatPermissionList(audit.permissions.missingRequired, language))
    }
    if (audit.permissions.missingRecommended.length > 0) {
        sections.push(`**${getLocale(language, 'permFieldMissingRecommended')}**\n`
            + formatPermissionList(audit.permissions.missingRecommended, language))
    }
    if (audit.permissions.missingRequired.length > 0 || audit.permissions.missingRecommended.length > 0) {
        const botRoleLabel = audit.roles.botRole
            ? `<@&${audit.roles.botRole.id}>`
            : getLocale(language, 'permBotRoleFallback')
        sections.push(`**${getLocale(language, 'permFieldHowToFixPerms')}**\n`
            + getLocale(language, 'permFixPerms', botRoleLabel))
    }

    if (audit.roles.unassignable.length > 0) {
        sections.push(`**${getLocale(language, 'permFieldUnassignableRoles')}**\n`
            + formatUnassignableList(audit.roles.unassignable, language))
        sections.push(`**${getLocale(language, 'permFieldHowToFixHierarchy')}**\n`
            + formatHierarchyFix(audit.roles.botRole, language))
    }

    if ((audit.channels || []).length > 0) {
        sections.push(`**${getLocale(language, 'permFieldChannelOverrides')}**\n`
            + formatChannelIssues(audit.channels, language)
            + `\n\n${getLocale(language, 'permChannelFix')}`)
    }

    return sections.join('\n\n')
}

/** Link button to the fixed-permission invite, attached to any permission notification. */
function buildReinviteRow(language) {
    return new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder()
            .setStyle(Discord.ButtonStyle.Link)
            .setLabel(getLocale(language, 'permReinviteButton'))
            .setEmoji('🔧')
            .setURL(buildInviteUrl())
    )
}

/**
 * One-line inline warning for the moment an admin *sets* a role (`/role add`,
 * `/role unverified`, `/domainrole add`, `/setup`). Catching it here is the whole point:
 * the admin is already in the roles UI mindset and the failure has not reached a member
 * yet. Returns null when the roles are fine.
 *
 * @param {Array<string|import('discord.js').Role>} roles
 * @returns {Promise<?string>}
 */
async function buildRoleWarning(guild, roles, language) {
    const { resolved, botRole, unassignable } = await findUnassignableRoles(guild, roles)
    const perms = await checkGuildPermissions(guild)
    const noManageRoles = perms.resolved && perms.missingRequired.some(p => p.flag === Flags.ManageRoles)

    // Missing Manage Roles blocks every role equally, so it is worth saying even when
    // the role order itself is fine — otherwise the admin saves a perfectly good role
    // and hears nothing until a member fails to verify.
    if (noManageRoles) {
        return [
            getLocale(language, 'permWarnNoManageRolesTitle'),
            getLocale(language, 'permWarnNoManageRoles', buildInviteUrl()),
            ...(resolved && unassignable.length > 0
                ? [formatUnassignableList(unassignable, language), formatHierarchyFix(botRole, language)]
                : [])
        ].join('\n\n')
    }

    if (!resolved || unassignable.length === 0) return null

    return [
        getLocale(language, 'permWarnRolesUnassignable'),
        formatUnassignableList(unassignable, language),
        formatHierarchyFix(botRole, language)
    ].join('\n\n')
}

/**
 * Re-notification throttle. A permission problem is a standing condition, not an event:
 * without this, a guild whose bot role is too low would be told again on every restart,
 * every join and every failed verification. One reminder per destination per day is
 * enough to be actionable without becoming noise the admin mutes.
 */
const NOTIFY_INTERVAL_MS = 24 * 60 * 60 * 1000
const lastNotified = new Map()

/**
 * Audit a guild and, if anything is broken, tell its admins — with the concrete list of
 * what is missing, the exact fix, and a one-click re-invite button.
 *
 * Throttled per guild.
 *
 * @returns {Promise<?object>} the audit when a notification was sent, else null
 */
/**
 * Discord rejects an embed whose description exceeds 4096 characters, and ErrorNotifier
 * renders this text as exactly that. A guild with dozens of unassignable roles can get
 * there, and the failure mode would be silent — the whole alert dropped, precisely when
 * something is most wrong. Trim at a line boundary and say so instead.
 */
const MAX_DESCRIPTION = 4096
function clampDescription(text, language = 'english') {
    if (text.length <= MAX_DESCRIPTION) return text
    const notice = '\n\n' + getLocale(language, 'permReportTruncated')
    const budget = MAX_DESCRIPTION - notice.length
    let cut = text.slice(0, budget)
    const lastBreak = cut.lastIndexOf('\n')
    if (lastBreak > budget * 0.5) cut = cut.slice(0, lastBreak)
    return cut + notice
}

async function notifyPermissionIssues(guild, serverSettings, language) {
    const ErrorNotifier = require('./ErrorNotifier')

    const audit = await auditGuild(guild, serverSettings)
    const report = buildPermissionIssueReport(guild, audit, language)
    if (!report) return null

    const last = lastNotified.get(guild.id) || 0
    if (Date.now() - last < NOTIFY_INTERVAL_MS) return null
    lastNotified.set(guild.id, Date.now())

    await ErrorNotifier.notify({
        guild,
        errorTitle: getLocale(language, 'permIssueTitle'),
        errorMessage: clampDescription(report, language),
        language,
        components: [buildReinviteRow(language)]
    }).catch(e => console.warn(`[permissions] notify failed for ${guild.id}:`, e?.message || e))

    return audit
}

/**
 * Notify admins that a role could not be assigned, naming the actual cause.
 *
 * Role assignment failing is the single most common support case, and Discord answers
 * every cause with the same opaque 50013. So instead of repeating the old catch-all
 * ("ensure the role is higher, the roles exist, and the bot has Manage Roles"), audit the
 * guild at the moment of failure and report the one thing that is actually wrong. Falls
 * back to the generic message only when the audit finds nothing — i.e. the failure was
 * transient or something we do not model.
 *
 * Throttled per guild, because the trigger is a member action, not an admin one: with
 * `auto-unverified` on and the bot's role too low, EVERY join fails, and each failure
 * notifies a channel (optionally with an @everyone ping) plus the owner and every opted-in
 * admin by DM. A busy server would bury its admins in identical alerts about one problem.
 * Suppressed failures are counted and reported in the next notification, so the throttle
 * loses no information — it turns N copies of one alert into one alert that says N.
 *
 * @param {import('discord.js').User} [user] the member whose verification failed
 * @returns {Promise<?object>} the audit when a notification was sent, else null
 */
const ROLE_FAILURE_INTERVAL_MS = 60 * 60 * 1000
const roleFailureState = new Map()   // guildId -> { lastNotify: number, suppressed: number }

async function notifyRoleAssignmentFailure(guild, serverSettings, language, user = null) {
    const ErrorNotifier = require('./ErrorNotifier')

    // Checked before the audit, not after: on a raid every join would otherwise trigger a
    // full permission audit (member fetch, channel fetches) just to be discarded.
    const state = roleFailureState.get(guild.id) || { lastNotify: 0, suppressed: 0 }
    if (Date.now() - state.lastNotify < ROLE_FAILURE_INTERVAL_MS) {
        state.suppressed++
        roleFailureState.set(guild.id, state)
        return null
    }

    const suppressed = state.suppressed
    roleFailureState.set(guild.id, { lastNotify: Date.now(), suppressed: 0 })

    const audit = await auditGuild(guild, serverSettings).catch(() => null)
    const report = audit ? buildPermissionIssueReport(guild, audit, language) : null

    const parts = [getLocale(language, report ? 'permRoleAssignFailedIntro' : 'errorRoleAssignMessage')]
    if (report) parts.push(report)
    if (suppressed > 0) parts.push(getLocale(language, 'permRoleAssignSuppressed', String(suppressed)))

    await ErrorNotifier.notify({
        guild,
        errorTitle: getLocale(language, report ? 'permRoleAssignFailedTitle' : 'errorRoleAssignTitle'),
        errorMessage: clampDescription(parts.join('\n\n'), language),
        user,
        language,
        components: report ? [buildReinviteRow(language)] : null
    }).catch(e => console.warn(`[permissions] role-failure notify failed for ${guild.id}:`, e?.message || e))

    return audit
}

/** Test seam: drop the throttle state so a test is not shaped by a previous one. */
function __resetNotificationThrottles() {
    roleFailureState.clear()
    lastNotified.clear()
}

module.exports = {
    REQUIRED_PERMISSIONS,
    RECOMMENDED_PERMISSIONS,
    INVITE_PERMISSION_BITS,
    buildInviteUrl,
    resolveSelfMember,
    checkGuildPermissions,
    checkChannelPermissions,
    findUnassignableRoles,
    configuredRoleIds,
    auditGuild,
    buildPermissionIssueReport,
    buildReinviteRow,
    buildRoleWarning,
    notifyPermissionIssues,
    notifyRoleAssignmentFailure,
    __resetNotificationThrottles,
    permissionLabel,
    formatPermissionList,
    formatUnassignableList,
    formatChannelIssues,
    formatHierarchyFix
}
