// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const Discord = require('discord.js');
const {token, clientId} = require('../config/config.json');
const database = require('./database/Database.js')
const {stdin, stdout} = require('process')
const readline = require('readline')
let rl = null
const fs = require("fs");
const {getLocale, defaultLanguage} = require('./Language')
require("./database/ServerSettings");
const ServerStatsAPI = require("./api/ServerStatsAPI");
const topggAPI = require("./api/TopGG")
const MailSender = require("./mail/MailSender")
const sendVerifyMessage = require("./bot/sendVerifyMessage")
const {showEmailModal} = require("./bot/showEmailModal")
const rest = require("./api/DiscordRest")
const registerRemoveDomain = require("./bot/registerRemoveDomain")
const registerBlacklistChoices = require("./bot/registerBlacklistChoices")
const {PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, TextDisplayBuilder, EmbedBuilder} = require("discord.js");
const { MessageFlags } = require('discord.js');
const { createSessionExpiredEmbed, createCodeExpiredEmbed, createTooManyAttemptsEmbed, createGenericErrorEmbed, createInvalidCodeEmbed, createInvalidEmailEmbed, createVerificationSuccessEmbed, createCodeSentEmbed, createMailLimitReachedEmbed, createMailFailedEmbed } = require('./utils/embeds');
const ErrorNotifier = require('./utils/ErrorNotifier');
const { getWebsiteUrl, describeSku, getCurrency } = require('./utils/premiumButtons');
const onboarding = require('./utils/onboarding');
const OperatorWebhook = require('./utils/OperatorWebhook');
const analytics = require('./utils/Analytics');

// The verification rules themselves (code TTL, attempt cap, resend cooldown,
// domain/blacklist matching, quota gating) live in core/VerificationService so the
// Telegram adapter runs exactly the same flow. What remains in this file is Discord:
// modals, embeds, interactions and roles.
const premiumManager = require('./premium/PremiumManager');
const VerificationService = require('./core/VerificationService');
const DiscordAuthorizer = require('./discord/DiscordAuthorizer');
const DiscordNotifier = require('./discord/DiscordNotifier');

const bot = new Discord.Client({
    intents: [
        Discord.GatewayIntentBits.DirectMessages,
        Discord.GatewayIntentBits.GuildMessageReactions,
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.GuildMembers
    ],
    partials: [Discord.Partials.Channel]
});

const serverStatsAPI = new ServerStatsAPI(bot, false)
// expose for shard broadcast usage
bot.serverStatsAPI = serverStatsAPI

let emailNotify = true

const mailSender = new MailSender(serverStatsAPI)
// Exposed for commands that send mail outside the verification flow (/testmail)
bot.mailSender = mailSender

// Pending verification codes live in SQLite (see Database.pending_verifications) so
// they survive restarts and are reachable from whichever shard a DM interaction
// lands on. The best-effort email-send rate limiter stays in memory, inside the
// service, and is therefore per-shard exactly as before.
const discordNotifier = new DiscordNotifier()
const verification = new VerificationService({
    platform: 'discord',
    mailTransport: mailSender.transport,
    authorizer: new DiscordAuthorizer(),
    notifier: discordNotifier,
    serverStatsAPI,
    formatDate: premiumManager.discordDate
})

// Track the ephemeral "code sent" prompt so we can delete it after code submission.
// Values carry a timestamp so a periodic sweep can evict abandoned entries.
const codePromptMessages = new Map()   // key: userId+guildId, value: { id, ts }

/**
 * Verification customIds carry the guild id as a `:`-suffix (e.g. `emailModal:123`)
 * so DM interactions — which always land on shard 0 with no interaction.guild —
 * still know which guild they belong to. Returns the suffix (or null) plus the bare action.
 */
function parseVerificationCustomId(customId) {
    const idx = customId.indexOf(':')
    if (idx === -1) return { action: customId, guildId: null }
    return { action: customId.slice(0, idx), guildId: customId.slice(idx + 1) || null }
}

/**
 * Resolve a Guild from its id on any shard. Returns the cached guild when this
 * shard owns it; otherwise fetches it over REST (uncached — shard 0 receives no
 * gateway events for foreign guilds, so caching them would freeze their roles
 * forever and inflate guilds.cache.size in cross-shard stats). The REST guild
 * payload already includes the full roles list, so no separate roles fetch is
 * needed. Returns null if unavailable.
 */
async function resolveGuild(guildId) {
    if (!guildId) return null
    const cached = bot.guilds.cache.get(guildId)
    if (cached) return cached
    try {
        const guild = await bot.guilds.fetch({ guild: guildId, cache: false })
        // Paranoia fallback: the guild payload includes roles, but re-fetch if empty.
        if (guild.roles.cache.size <= 1) {
            await guild.roles.fetch().catch(() => {})
        }
        return guild
    } catch (e) {
        console.warn(`[resolveGuild] Could not fetch guild ${guildId}:`, e?.message ?? e)
        return null
    }
}

/**
 * Entitlements for premium checks against a specific guild. DM interactions do not
 * reliably carry another guild's entitlements in interaction.entitlements, so when
 * the interaction's own guild isn't the verification target we fetch the target
 * guild's active entitlements over REST. In-guild interactions keep the zero-cost
 * interaction.entitlements path.
 */
async function getEntitlementsForGuild(guildId, interaction) {
    if (interaction.guildId === guildId) return interaction.entitlements
    try {
        return await bot.application.entitlements.fetch({ guild: guildId, excludeEnded: true })
    } catch (e) {
        console.warn(`[entitlements] Could not fetch entitlements for guild ${guildId}:`, e?.message ?? e)
        return interaction.entitlements
    }
}

/** Resolve a guild's configured language by id (for messages shown before the guild object is available). */
function getGuildLanguage(guildId) {
    return new Promise(resolve => {
        if (!guildId) return resolve(defaultLanguage)
        database.getServerSettings(guildId, s => resolve(s.language || defaultLanguage))
    })
}

/** Button row shown with the "code sent" prompt: enter the code, or resend it. */
function buildCodePromptRow(language, guildId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`openCodeModal:${guildId}`)
            .setLabel(getLocale(language, 'enterCodeButton'))
            .setEmoji('🔑')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`resendCode:${guildId}`)
            .setLabel(getLocale(language, 'resendCodeButton'))
            .setEmoji('📨')
            .setStyle(ButtonStyle.Secondary)
    )
}

/**
 * "Resend code" button: re-send the pending verification email with a fresh code.
 * Requires an unexpired pending row (it holds the email address); enforces a flat
 * cooldown via pending.lastSentAt and goes through the normal premium/quota check
 * so resends can't bypass the guild's mail limits.
 */
async function handleResendCode(interaction, guildId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {})
    const autoDelete = (ms) => setTimeout(() => { interaction.deleteReply().catch(() => {}) }, ms)

    const pending = guildId ? await verification.peekPending(guildId, interaction.user.id) : null
    if (!pending) {
        // Nothing to resend (expired/consumed) — the stored email is gone, so the
        // user must restart from the verify button.
        const lang = await getGuildLanguage(guildId)
        await interaction.editReply({ embeds: [createCodeExpiredEmbed(lang)] }).catch(() => {})
        autoDelete(15000)
        return
    }

    const userGuild = await resolveGuild(guildId)
    if (!userGuild) {
        const lang = await getGuildLanguage(guildId)
        await interaction.editReply({ embeds: [createSessionExpiredEmbed(lang, true)] }).catch(() => {})
        autoDelete(10000)
        return
    }

    await database.getServerSettings(userGuild.id, async serverSettings => {
        const language = serverSettings.language
        const result = await verification.resendCode({
            community: userGuild,
            settings: serverSettings,
            userID: interaction.user.id,
            pending,
            entitlements: await getEntitlementsForGuild(userGuild.id, interaction),
            passthrough: { interaction }
        })

        switch (result.outcome) {
            case 'cooldown': {
                const cooldownEmbed = new EmbedBuilder()
                    .setTitle(getLocale(language, 'mailTimeoutTitle'))
                    .setDescription(getLocale(language, 'resendCooldownDescription', String(result.waitSeconds)))
                    .setColor(0xFFA500)
                await interaction.editReply({ embeds: [cooldownEmbed] }).catch(() => {})
                autoDelete(10000)
                return
            }
            case 'quota_denied':
                await interaction.editReply({ embeds: [createMailLimitReachedEmbed(language, getWebsiteUrl())] }).catch(() => {})
                autoDelete(15000)
                return
            case 'mail_failed':
                await interaction.editReply({ embeds: [createMailFailedEmbed(language, result.email)] }).catch(() => {})
                autoDelete(15000)
                return
            case 'no_pending':
                await interaction.editReply({ embeds: [createCodeExpiredEmbed(language)] }).catch(() => {})
                autoDelete(15000)
                return
            case 'code_sent': {
                await interaction.editReply({
                    embeds: [createCodeSentEmbed(language, result.email)],
                    components: [buildCodePromptRow(language, guildId)]
                }).catch(() => {})
                const sent = await interaction.fetchReply().catch(() => null)
                if (sent && sent.id) {
                    codePromptMessages.set(interaction.user.id + guildId, { id: sent.id, ts: Date.now() })
                }
                setTimeout(() => { interaction.deleteReply().catch(() => {}) }, 300000)
                return
            }
            default:
                await interaction.editReply({ embeds: [createGenericErrorEmbed(language)] }).catch(() => {})
                autoDelete(15000)
        }
    })
}

bot.commands = new Discord.Collection();
const commandFiles = fs.readdirSync('./src/commands').filter(file => file.endsWith('.js'));
const commands = []

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    bot.commands.set(command.data.name, command);
    commands.push(command.data.toJSON())
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000; // 5 seconds

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function registerCommands(guild, count = 0, total = 0, attempt = 1) {
    try {
        await rest.put(
            Discord.Routes.applicationGuildCommands(clientId, guild.id),
            { body: commands }
        );

        console.log(
            `[Shard ${bot.shard?.ids ?? 'N/A'}] Successfully registered application commands for ${guild.name}: ${count}/${total}`
        );
    } catch (err) {
        const code = err?.code || err?.cause?.code;
        const status = err?.status ?? err?.statusCode;
        const discordCode = err?.rawError?.code;

        console.error(
            `[Shard ${bot.shard?.ids ?? 'N/A'}] Failed to register commands for ${guild.name} ` +
            `(attempt ${attempt}/${MAX_RETRIES}) – code=${code}, status=${status}, discordCode=${discordCode}`
        );

        const isTimeout =
            code === 'UND_ERR_CONNECT_TIMEOUT' ||
            err?.message?.includes('Connect Timeout Error');

        // 1) Retry on transient timeouts
        if (isTimeout && attempt < MAX_RETRIES) {
            console.log(
                `Timeout while registering commands for ${guild.name}, ` +
                `retrying in ${RETRY_DELAY_MS}ms...`
            );
            await sleep(RETRY_DELAY_MS);
            return registerCommands(guild, count, total, attempt + 1);
        }

        // 2) Handle real "missing permissions" cases → notify + leave
        const missingPerms =
            status === 403 ||          // HTTP Forbidden
            discordCode === 50013;     // Discord: Missing Permissions

        if (missingPerms) {
            // Notify the guild owner about missing permissions before leaving
            await ErrorNotifier.notify({
                guild: guild,
                errorTitle: 'Missing Permissions',
                errorMessage: 'The bot does not have permission to create slash commands. The bot will leave the server.\n\nTo fix this, please re-invite the bot with proper permissions: https://emailbot.larskaesberg.de/',
                language: 'english'
            });

            try {
                await bot.guilds.cache.get(guild.id)?.leave();
                console.log(`Left guild ${guild.name} due to missing permissions.`);
            } catch (e) {
                console.error(`Failed to leave guild ${guild.name}:`, e);
            }

            return;
        }

        // 3) Other errors: log and continue, don't crash or leave
        console.warn(
            `Non-fatal error while registering commands for ${guild.name}. ` +
            `Not leaving guild; continuing.`
        );
    }
}

async function registerAllGuilds(bot) {
    const guilds = Array.from(bot.guilds.cache.values());
    const total = guilds.length;
    const concurrency = 5;
    let index = 0;

    async function worker() {
        while (true) {
            const i = index++;
            if (i >= total) break;

            const guild = guilds[i];
            const count = i + 1;

            await registerCommands(guild, count, total);

            registerRemoveDomain(guild.id);
            registerBlacklistChoices(guild.id);
            database.getServerSettings(guild.id, async serverSettings => {
                try {
                    await bot.guilds.cache
                        .get(guild.id)
                        ?.channels.cache
                        .get(serverSettings.channelID)
                        ?.messages.fetch(serverSettings.messageID);
                } catch (e) {
                    // ignore
                }
            });
        }
    }

    await Promise.all(
        Array.from({ length: concurrency }, () => worker())
    );

    console.log(`[Shard ${bot.shard?.ids ?? 'N/A'}] Finished registering commands for all guilds`);
}


/**
 * Fetch every currently-active entitlement for the application, following pagination.
 * Entitlement gateway events only arrive while the bot is online, so reconciling the
 * live set periodically is the only way to know true recurring revenue after any
 * downtime. Capped at 20 pages (2,000 entitlements) as a runaway guard.
 *
 * Results are cached deliberately, for two reasons: discord.js resolves `oldEntitlement`
 * on an update from `application.entitlements.cache`, so priming it is what lets a
 * consumption or removal be told apart from an opaque update; and it's how a renewing
 * subscription is mapped back to a guild (see subscriptionGuildId). Entitlements are few
 * and app-level, so unlike guilds this cache is cheap to hold.
 */
async function fetchActiveEntitlements() {
    const out = []
    let after
    for (let page = 0; page < 20; page++) {
        const batch = await bot.application.entitlements.fetch({
            limit: 100,
            after,
            excludeEnded: true,
            excludeDeleted: true,
            cache: true
        })
        if (!batch || batch.size === 0) break
        for (const [, e] of batch) out.push(e)
        if (batch.size < 100) break
        after = batch.lastKey()
    }
    return out
}

/**
 * Current recurring revenue from live subscription entitlements. Subscription prices in
 * config are treated as per-month, so this is MRR.
 */
function computeRecurringRevenue(entitlements) {
    let mrr = 0
    let activeSubscriptions = 0
    // Split by tier as well as totalled: the mix matters (a churned Pro is worth two
    // Standards), and it can't be reconstructed after the fact from purchase events —
    // those only cover signups since instrumentation started, not the live population.
    // Keyed off the catalog's `tier`, not the label, so a rename can't break the metric.
    const byTier = { tier1: 0, tier2: 0 }
    for (const e of entitlements) {
        const info = describeSku(e.skuId)
        if (!info || info.kind !== 'subscription') continue
        if (!e.isActive?.()) continue
        activeSubscriptions++
        if (info.tier in byTier) byTier[info.tier]++
        if (typeof info.price === 'number' && info.price > 0) mrr += info.price
    }
    return {
        activeSubscriptions,
        activeStandard: byTier.tier1,
        activePro: byTier.tier2,
        mrr: Math.round(mrr * 100) / 100
    }
}

/**
 * Snapshot the cumulative all-time counters to PostHog as a `stats_snapshot` event.
 * Primary-shard only: serverStatsAPI.serverStats holds the cross-shard authoritative
 * totals (sibling shards forward their increments to shard 0) and getServerCount()
 * sums guild counts across all shards. This lets PostHog chart true all-time totals —
 * servers / mails / verifications accumulated before instrumentation existed.
 */
async function sendStatsSnapshot() {
    try {
        const stats = serverStatsAPI.serverStats
        const servers = await serverStatsAPI.getServerCount()

        // Recurring revenue is a level, not an event stream — reconcile it here so it
        // stays correct across restarts and missed renewal events.
        let recurring = { activeSubscriptions: null, activeStandard: null, activePro: null, mrr: null }
        try {
            recurring = computeRecurringRevenue(await fetchActiveEntitlements())
        } catch (e) {
            console.warn('[Analytics] could not reconcile subscriptions for snapshot:', e?.message || e)
        }

        // Credit-balance histogram: how many paying servers are close to running dry.
        // Nulls (not zeros) on failure so a broken read reads as "no data" on the
        // dashboard instead of a fake "every server is out of credits".
        let credits = { b0: null, b1_10: null, b11_50: null, b51_100: null, b101_500: null, b501_plus: null }
        try {
            credits = await database.getCreditBuckets()
        } catch (e) {
            console.warn('[Analytics] could not read credit buckets for snapshot:', e?.message || e)
        }

        analytics.capture({
            event: 'stats_snapshot',
            properties: {
                servers_total: servers,
                mails_sent_all_time: stats.mailsSendAll,
                verifications_all_time: stats.usersVerifiedAll,
                mails_sent_today: stats.mailsSendToday,
                verifications_today: stats.usersVerifiedToday,
                active_subscriptions: recurring.activeSubscriptions,
                active_subscriptions_standard: recurring.activeStandard,
                active_subscriptions_pro: recurring.activePro,
                mrr: recurring.mrr,
                // Servers by remaining credits. Counts only guilds that have ever held
                // credits — see Database#getCreditBuckets.
                credit_servers_0: credits.b0,
                credit_servers_1_10: credits.b1_10,
                credit_servers_11_50: credits.b11_50,
                credit_servers_51_100: credits.b51_100,
                credit_servers_101_500: credits.b101_500,
                credit_servers_501_plus: credits.b501_plus,
                currency: getCurrency()
            }
        })
    } catch (e) {
        console.error('[Analytics] stats snapshot failed:', e?.message || e)
    }
}

bot.once('clientReady', async () => {
    // Determine primary shard at runtime per discord.js docs
    const isPrimary = !bot.shard || bot.shard.ids.includes(0)
    if (isPrimary) {
        serverStatsAPI.app.listen(serverStatsAPI.port, () => {
            console.log(`App listening on port ${serverStatsAPI.port}!`)
        })
        rl = readline.createInterface(stdin, stdout)
        rl.on("line", async command => {
            switch (command) {
                case "help":
                    console.log("Commands: email,servers")
                    break
                case "email":
                    emailNotify = !emailNotify
                    console.log("Email Notification: " + emailNotify.toString())
                    break
                case "servers":
                    console.log("------------------------------")
                    console.log("Servers:");
                    const servers = (await bot.guilds.fetch())
                    servers.forEach(guild => {
                        console.log(guild.name)
                    })
                    console.log("Server: " + servers.size)
                    console.log("------------------------------")
                    break
                default:
                    console.log("No command found!")
                    break
            }
        })
    }
    // Only in unsharded mode, post TopGG stats from client
    if (!bot.shard) {
        try {
            topggAPI(bot);
        } catch (e) {
            console.error('Failed to start TopGG API:', e);
        }
    }

    await registerAllGuilds(bot);

    // Seed guild group properties (name / member count) for this shard's guilds so
    // PostHog group analytics have labels from the first boot onward.
    for (const g of bot.guilds.cache.values()) analytics.identifyGuild(g)

    // Prime the entitlement cache so updates arrive with a prior state to diff against
    // (a consumption or removal is otherwise indistinguishable from an opaque update),
    // and so a renewing subscription can be mapped back to its guild. Discord sends
    // entitlement and subscription events to shard 0 only — they carry no guild_id — so
    // shard 0 is the one that matters; priming elsewhere is harmless redundancy.
    fetchActiveEntitlements()
        .then(list => console.log(`[Premium] Cached ${list.length} active entitlements for premium event diffing`))
        .catch(e => console.warn('[Premium] Could not prime entitlement cache:', e?.message || e))

    bot.user.setActivity("/verify | Website", {
        type: "PLAYING",
        url: "https://emailbot.larskaesberg.de"
    });

    // Operator notification: only fire from the primary shard to avoid N-per-restart spam.
    if (isPrimary) {
        const shardLabel = bot.shard?.ids?.join(',') ?? 'unsharded'
        const totalShards = bot.shard?.count ?? 1
        OperatorWebhook.notify({
            title: '🟢 Bot online',
            description: `Logged in as **${bot.user.tag}**.`,
            fields: [
                { name: 'Shard', value: `${shardLabel} / ${totalShards}`, inline: true },
                { name: 'Guilds (this shard)', value: String(bot.guilds.cache.size), inline: true }
            ],
            level: 'success'
        })

        analytics.capture({
            event: 'bot_online',
            properties: {
                shard: shardLabel,
                total_shards: totalShards,
                guild_count: bot.guilds.cache.size
            }
        })

        // All-time totals → PostHog. Delay the first snapshot so sibling shards have
        // spawned and the cross-shard getServerCount() can reach them; refresh daily after.
        setTimeout(sendStatsSnapshot, 120000).unref()
        setInterval(sendStatsSnapshot, 24 * 60 * 60 * 1000).unref()

        // Boot-time SMTP self-test: catch broken credentials/hosts before the first
        // member's verification silently fails.
        mailSender.selfTest().then(result => {
            if (result.ok) {
                console.log('[MailSender] SMTP self-test passed')
            } else {
                console.error('[MailSender] SMTP self-test FAILED:', result.error)
                analytics.capture({
                    event: 'smtp_selftest_failed',
                    properties: { error: String(result.error).slice(0, 500) }
                })
                OperatorWebhook.notify({
                    title: '🚨 SMTP self-test failed',
                    description: `The self-SMTP transport failed verification at boot — verification emails may not be deliverable.\n\`\`\`${String(result.error).slice(0, 1500)}\`\`\``,
                    level: 'error'
                })
            }
        }).catch(() => {})
    }
});

setInterval(function () {
    bot.user.setActivity("/verify | Website", {
        type: "PLAYING", url: "https://emailbot.larskaesberg.de"
    })
}, 3600000).unref();

// Periodic cleanup. The in-memory maps are per-shard, so every shard prunes its own;
// the expired-code sweep touches the shared DB, so only the primary shard runs it.
const CLEANUP_STALE_MS = 60 * 60 * 1000
setInterval(() => {
    const now = Date.now()
    verification.pruneRateLimits(now, CLEANUP_STALE_MS)
    for (const [key, v] of codePromptMessages) {
        if (!v || v.ts < now - CLEANUP_STALE_MS) codePromptMessages.delete(key)
    }
    for (const [gid, ts] of discordNotifier.emaillistLockedLastNotify) {
        if (ts < now - CLEANUP_STALE_MS) discordNotifier.emaillistLockedLastNotify.delete(gid)
    }
    const isPrimary = !bot.shard || bot.shard.ids.includes(0)
    if (isPrimary) {
        database.sweepExpiredPendingVerifications().catch(() => {})
    }
}, 30 * 60 * 1000).unref();

bot.on("guildDelete", guild => {
    console.log("Removed: " + guild.name)
    database.deleteServerData(guild.id)
    analytics.capture({ event: 'guild_left', guild, properties: { member_count: guild.memberCount } })
})

bot.on("guildMemberAdd", async member => {
    await database.getServerSettings(member.guild.id, async serverSettings => {
        analytics.capture({
            event: 'member_joined',
            userId: member.user.id,
            guild: member.guild,
            properties: {
                auto_verify: !!serverSettings.autoVerify,
                auto_add_unverified: !!serverSettings.autoAddUnverified
            }
        })
        if (serverSettings.autoAddUnverified) {
            const roleUnverified = member.guild.roles.cache.find(role => role.id === serverSettings.unverifiedRoleName);
            if (roleUnverified !== undefined) {
                try {
                    await member.roles.add(roleUnverified)
                } catch (e) {
                    await ErrorNotifier.notify({
                        guild: member.guild,
                        errorTitle: getLocale(serverSettings.language, 'errorRoleAssignTitle'),
                        errorMessage: getLocale(serverSettings.language, 'errorRoleAssignMessage'),
                        user: member.user,
                        language: serverSettings.language
                    })
                }

            }
        }
        if (serverSettings.autoVerify) {
            await sendVerifyMessage(member.guild, member.user)
        }
    })
})

bot.on('guildCreate', guild => {
    console.log(`[Shard ${bot.shard?.ids ?? 'N/A'}] New guild: ${guild.name}`)
    registerCommands(guild)
    analytics.identifyGuild(guild)
    analytics.capture({ event: 'guild_joined', guild, properties: { member_count: guild.memberCount } })

    // Greet the server and DM whoever added the bot. Only genuine joins reach this
    // handler — discord.js suppresses guildCreate for the startup guild load unless the
    // socket is already Ready (see GUILD_CREATE.js) — so a restart cannot spam anyone.
    //
    // Fire-and-forget: onboarding must never delay or break command registration. The
    // delivery flags are captured so the effect on first-hour churn is measurable.
    onboarding.sendOnboarding(guild)
        .then(result => analytics.capture({
            event: 'onboarding_sent',
            guild,
            properties: { ...result, member_count: guild.memberCount }
        }))
        .catch(e => console.warn(`[Onboarding] failed for ${guild.id}:`, e?.message || e))
})

// Premium purchase lifecycle — turn every Discord entitlement event into a
// readable operator notification (and keep the raw log line as an audit trail).
// We resolve the SKU snowflake to a product name, humanise the entitlement type,
// render dates as Discord timestamps, and — for updates — diff old→new so the
// title says whether it was a renewal, cancellation, or consumption rather than
// guessing. Redemption of consumables is logged separately in PremiumManager.

const ENTITLEMENT_TYPE_LABELS = {
    [Discord.EntitlementType.Purchase]: 'One-time purchase',
    [Discord.EntitlementType.PremiumSubscription]: 'Nitro subscription',
    [Discord.EntitlementType.DeveloperGift]: 'Developer gift',
    [Discord.EntitlementType.TestModePurchase]: 'Test-mode purchase',
    [Discord.EntitlementType.FreePurchase]: 'Free purchase',
    [Discord.EntitlementType.UserGift]: 'User gift',
    [Discord.EntitlementType.PremiumPurchase]: 'Premium purchase',
    [Discord.EntitlementType.ApplicationSubscription]: 'App subscription'
}

function entitlementProductName(entitlement) {
    const info = describeSku(entitlement.skuId)
    return info ? info.label : `Unknown product (\`${entitlement.skuId}\`)`
}

function formatEntitlementType(type) {
    return ENTITLEMENT_TYPE_LABELS[type] ?? `Unknown (${type})`
}

// Discord renders <t:unix:f> / <t:unix:R> as a localized absolute + relative
// time in the reader's own timezone — far more useful to an operator than a UTC
// ISO string. Returns null for absent dates so callers can label them.
function formatDiscordTime(date) {
    if (!date) return null
    const unix = Math.floor(date.getTime() / 1000)
    return `<t:${unix}:f> (<t:${unix}:R>)`
}

// Configured list price for the operator webhook's Price field. Prices are stored
// as major-currency floats (e.g. 4.99 EUR — see config.monetization.prices), so we
// render two decimals with the currency symbol (falling back to the ISO code).
const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', GBP: '£' }
function formatPrice(amount) {
    if (typeof amount !== 'number' || amount <= 0) return null
    const currency = getCurrency()
    const symbol = CURRENCY_SYMBOLS[currency]
    return symbol ? `${symbol}${amount.toFixed(2)}` : `${amount.toFixed(2)} ${currency}`
}

function entitlementFields(entitlement, statusValue) {
    const info = describeSku(entitlement.skuId)
    const fields = [
        { name: 'Product', value: entitlementProductName(entitlement), inline: true },
        { name: 'Status', value: statusValue, inline: true },
        { name: 'Type', value: formatEntitlementType(entitlement.type), inline: true },
        {
            name: 'Server',
            value: entitlement.guildId
                ? `${entitlement.guild?.name ? `${entitlement.guild.name} ` : ''}\`${entitlement.guildId}\``
                : '— (user-level)',
            inline: true
        },
        { name: 'User', value: entitlement.userId ? `<@${entitlement.userId}>` : 'n/a', inline: true },
        { name: 'Active', value: entitlement.isActive() ? '✅ Yes' : '❌ No', inline: true }
    ]

    // Configured list price, shown right after the product (omitted when unpriced).
    const priceLabel = formatPrice(info?.price)
    if (priceLabel) fields.splice(1, 0, { name: 'Price', value: priceLabel, inline: true })

    const starts = formatDiscordTime(entitlement.startsAt)
    if (starts) fields.push({ name: 'Started', value: starts, inline: true })
    fields.push({ name: 'Renews / ends', value: formatDiscordTime(entitlement.endsAt) ?? 'Never expires', inline: true })

    // "Consumed" is only meaningful for one-time consumables (credits / CSV);
    // subscriptions never carry it, so showing it there would just be noise.
    if (info && info.kind !== 'subscription') {
        fields.push({ name: 'Consumed', value: entitlement.consumed ? 'Yes' : 'No', inline: true })
    }

    fields.push({ name: 'Entitlement ID', value: `\`${entitlement.id}\``, inline: false })
    return fields
}

bot.on('entitlementCreate', entitlement => {
    console.log(`[Premium] Entitlement created: sku=${entitlement.skuId} user=${entitlement.userId ?? 'n/a'} guild=${entitlement.guildId ?? 'n/a'} type=${entitlement.type} consumed=${entitlement.consumed} startsAt=${entitlement.startsAt?.toISOString?.() ?? 'n/a'} endsAt=${entitlement.endsAt?.toISOString?.() ?? 'n/a'}`)
    const status = '🟢 Started'
    OperatorWebhook.notify({
        title: `💎 New purchase — ${entitlementProductName(entitlement)}`,
        fields: entitlementFields(entitlement, status),
        level: 'success'
    })

    // Consumables (credit packs, CSV unlock) do nothing until the buyer runs
    // /premium redeem — a paid-but-never-redeemed pack is a refund waiting to
    // happen. Subscriptions activate automatically, so no DM needed there.
    const info = describeSku(entitlement.skuId)
    analytics.capture({
        event: 'premium_purchased',
        userId: entitlement.userId || null,
        guildId: entitlement.guildId || null,
        properties: {
            sku: entitlement.skuId,
            product_label: info?.label ?? null,
            product_kind: info?.kind ?? 'unknown',
            entitlement_type: entitlement.type,
            // List price from config (monetization.prices); null for an unpriced SKU.
            revenue: (typeof info?.price === 'number' && info.price > 0) ? info.price : null,
            currency: getCurrency()
        }
    })
    if (info && info.kind !== 'subscription' && entitlement.userId && !entitlement.consumed) {
        bot.users.fetch(entitlement.userId).then(user => user.send(
            `🎉 Thanks for purchasing **${info.label}**!\n\n` +
            'To activate it, run **`/premium redeem`** in the server where you want to use it — ' +
            'the benefits apply to that server only, so pick carefully.'
        )).catch(() => {})
    }
})

bot.on('entitlementUpdate', (oldEntitlement, newEntitlement) => {
    console.log(`[Premium] Entitlement updated: sku=${newEntitlement.skuId} user=${newEntitlement.userId ?? 'n/a'} guild=${newEntitlement.guildId ?? 'n/a'} type=${newEntitlement.type} consumed=${newEntitlement.consumed} endsAt=${newEntitlement.endsAt?.toISOString?.() ?? 'n/a'}`)

    // Characterise the change by diffing old→new. Discord's update semantics are
    // approximate, so we read the most reliable signals: an earlier/new end date is a
    // scheduled cancellation, the consumed flag flipping is a redemption, and the
    // deleted flag flipping is a removal. Renewals are NOT visible here — see the
    // subscriptionUpdate handler below for why.
    //
    // `oldEntitlement` is NULL whenever the entitlement isn't in this shard's cache —
    // discord.js's EntitlementUpdate action does `cache.get(id)?._clone() ?? null`, and
    // the cache only holds entitlements seen since the process started. An entitlement
    // created before the last restart therefore arrives with no prior state, which used
    // to throw a TypeError on the first property access and silently kill the operator
    // notification and the analytics event. Never dereference it unguarded; the
    // boot-time cache warm-up above is what makes real diffs possible.
    const oldEnds = oldEntitlement?.endsTimestamp ?? null
    const newEnds = newEntitlement.endsTimestamp ?? null
    let status
    if (!oldEntitlement) {
        // No prior state to compare against. Report it honestly rather than guessing.
        status = '🔁 Updated (no cached prior state)'
    } else if (!oldEntitlement.deleted && newEntitlement.deleted) {
        status = '🔴 Deleted'
    } else if (!oldEntitlement.consumed && newEntitlement.consumed) {
        status = '✅ Consumed'
    } else if (oldEnds !== null && newEnds !== null && newEnds > oldEnds) {
        // Deliberately NOT labelled a renewal, and deliberately not revenue-bearing:
        // a live subscription's endsAt stays null for its whole life, so this can only
        // be an already-ending entitlement being pushed back. Real recurring payments
        // are counted in the subscriptionUpdate handler below.
        status = '🔄 End date extended'
    } else if (oldEnds !== null && newEnds !== null && newEnds < oldEnds) {
        status = '🚫 Cancelled (active until end date)'
    } else if (oldEnds === null && newEnds !== null) {
        status = '🚫 End date set (cancelled / scheduled)'
    } else {
        status = '🔁 Updated'
    }

    const fields = entitlementFields(newEntitlement, status)
    if (oldEntitlement && oldEnds !== newEnds) {
        fields.push({ name: 'Previous end', value: formatDiscordTime(oldEntitlement.endsAt) ?? 'None', inline: true })
    }

    const updateInfo = describeSku(newEntitlement.skuId)
    analytics.capture({
        event: 'premium_updated',
        userId: newEntitlement.userId || null,
        guildId: newEntitlement.guildId || null,
        properties: {
            sku: newEntitlement.skuId,
            product_label: updateInfo?.label ?? null,
            product_kind: updateInfo?.kind ?? 'unknown',
            status,
            consumed: !!newEntitlement.consumed,
            deleted: !!newEntitlement.deleted
        }
    })

    OperatorWebhook.notify({
        title: `🔁 Subscription updated — ${entitlementProductName(newEntitlement)}`,
        fields,
        level: 'info'
    })
})

bot.on('entitlementDelete', entitlement => {
    console.log(`[Premium] Entitlement deleted: sku=${entitlement.skuId} user=${entitlement.userId ?? 'n/a'} guild=${entitlement.guildId ?? 'n/a'} type=${entitlement.type}`)
    const deleteInfo = describeSku(entitlement.skuId)
    analytics.capture({
        event: 'premium_removed',
        userId: entitlement.userId || null,
        guildId: entitlement.guildId || null,
        properties: {
            sku: entitlement.skuId,
            product_label: deleteInfo?.label ?? null,
            product_kind: deleteInfo?.kind ?? 'unknown',
            entitlement_type: entitlement.type
        }
    })
    OperatorWebhook.notify({
        title: `❌ Entitlement removed — ${entitlementProductName(entitlement)}`,
        description: 'Subscription ended, was cancelled, refunded, or revoked.',
        fields: entitlementFields(entitlement, '🔴 Removed'),
        level: 'warn'
    })
})

// Recurring revenue. Renewals are invisible on the entitlement events above: Discord
// stopped sending ENTITLEMENT_UPDATE on successful renewal in October 2024, and a live
// subscription's entitlement carries `endsAt: null` for its whole life (it's only set
// once the subscription ends), so there is no end date to watch move forward.
//
// SUBSCRIPTION_UPDATE is the replacement signal: when a subscription renews, the billing
// period rolls forward — `currentPeriodStart` jumps to now — while the status stays
// Active. Cancellations, lapses and reactivations also land here, but they change the
// status and leave the billing period alone, so the period start is what identifies a
// payment. Only Active is counted: Ending/Inactive mean no money changed hands.
const RENEWAL_FRESHNESS_MS = 10 * 60 * 1000

/** First configured SKU on a subscription, with its catalog entry. */
function subscriptionSkuInfo(subscription) {
    for (const skuId of subscription.skuIds ?? []) {
        const info = describeSku(skuId)
        if (info) return { skuId, info }
    }
    return { skuId: subscription.skuIds?.[0] ?? null, info: null }
}

// Subscription objects are user-scoped and carry no guild id, but the entitlements they
// granted do — and those are already cached app-wide by fetchActiveEntitlements(), which
// is the other reason the boot-time warm-up earns its keep.
function subscriptionGuildId(subscription) {
    for (const entitlementId of subscription.entitlementIds ?? []) {
        const guildId = bot.application.entitlements.cache.get(entitlementId)?.guildId
        if (guildId) return guildId
    }
    return null
}

bot.on('subscriptionUpdate', (oldSubscription, newSubscription) => {
    const periodStart = newSubscription.currentPeriodStartTimestamp
    console.log(`[Premium] Subscription updated: id=${newSubscription.id} user=${newSubscription.userId ?? 'n/a'} status=${newSubscription.status} skus=${(newSubscription.skuIds ?? []).join(',') || 'n/a'} periodStart=${newSubscription.currentPeriodStartAt?.toISOString?.() ?? 'n/a'} periodEnd=${newSubscription.currentPeriodEndAt?.toISOString?.() ?? 'n/a'}`)

    if (newSubscription.status !== Discord.SubscriptionStatus.Active) return

    // `oldSubscription` is null until this process has seen the subscription once —
    // discord.js does the same `cache.get(id)?._clone() ?? null` as for entitlements.
    // Unlike entitlements this cache can't be primed at boot: GET /skus/{sku}/subscriptions
    // requires a user id per query on a bot token, so there's no way to enumerate
    // subscribers. Diff exactly when prior state exists; otherwise fall back to "the
    // period started just now", which only ever runs for the first update of a given
    // subscription after a restart.
    //
    // The fallback additionally requires the period to have started well after the
    // subscription itself was created (its id is a snowflake). Without that, the very
    // first billing period would look like a renewal and double-count the signup that
    // entitlementCreate already recorded as premium_purchased.
    const isRenewal = oldSubscription
        ? periodStart > oldSubscription.currentPeriodStartTimestamp
        : Date.now() - periodStart < RENEWAL_FRESHNESS_MS &&
          periodStart - Discord.SnowflakeUtil.timestampFrom(newSubscription.id) > RENEWAL_FRESHNESS_MS
    if (!isRenewal) return

    const { skuId, info } = subscriptionSkuInfo(newSubscription)
    const guildId = subscriptionGuildId(newSubscription)

    analytics.capture({
        event: 'premium_renewed',
        userId: newSubscription.userId || null,
        guildId,
        properties: {
            sku: skuId,
            product_label: info?.label ?? null,
            product_kind: info?.kind ?? 'unknown',
            // List price from config (monetization.prices); null for an unpriced SKU.
            revenue: (typeof info?.price === 'number' && info.price > 0) ? info.price : null,
            currency: getCurrency()
        }
    })

    const priceLabel = formatPrice(info?.price)
    const fields = [
        { name: 'Product', value: info?.label ?? `Unknown product (\`${skuId}\`)`, inline: true },
        { name: 'User', value: newSubscription.userId ? `<@${newSubscription.userId}>` : 'n/a', inline: true },
        { name: 'Server', value: guildId ? `\`${guildId}\`` : '— (user-level)', inline: true },
        { name: 'Period started', value: formatDiscordTime(newSubscription.currentPeriodStartAt) ?? 'n/a', inline: true },
        { name: 'Renews', value: formatDiscordTime(newSubscription.currentPeriodEndAt) ?? 'n/a', inline: true },
        { name: 'Subscription ID', value: `\`${newSubscription.id}\``, inline: false }
    ]
    if (priceLabel) fields.splice(1, 0, { name: 'Price', value: priceLabel, inline: true })

    OperatorWebhook.notify({
        title: `🔄 Subscription renewed — ${info?.label ?? 'Unknown product'}`,
        fields,
        level: 'success'
    })
})

bot.on('messageReactionAdd', async (reaction, user) => {
    try {
        if (user.bot) return
        // Ensure full reaction/message
        if (reaction.partial) {
            try { await reaction.fetch() } catch {}
        }
        const message = reaction.message
        const guild = message.guild
        if (!guild) return

        await database.getServerSettings(guild.id, async serverSettings => {
            if (
                message.channel.id === serverSettings.channelID &&
                message.id === serverSettings.messageID
            ) {
                try {
                    await message.channel.send(`<@${user.id}> Reaction-based verification is deprecated. Please contact a server admin and ask them to create a new verification flow with the /button command. Once the button message is available, click it to begin verification.`)
                } catch {}
            }
        })
    } catch {}
});

bot.on('interactionCreate', async interaction => {
    // Setup-wizard select menus (role / channel pickers on the ephemeral wizard message)
    if (interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
        if (interaction.customId.startsWith('setup')) {
            try {
                await bot.commands.get('setup')?.handleComponent(interaction)
            } catch (e) {
                console.error('Setup component error:', e)
            }
        }
        return
    }

    // Button: open email modal, open code modal, resend code, or setup-wizard buttons
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('setup')) {
            try {
                await bot.commands.get('setup')?.handleComponent(interaction)
            } catch (e) {
                console.error('Setup component error:', e)
            }
            return
        }
        const { action, guildId: customGuildId } = parseVerificationCustomId(interaction.customId)
        const guildId = customGuildId || interaction.guildId

        if (action === 'resendCode') {
            await handleResendCode(interaction, guildId)
            return
        }
        if (action === 'verifyButton' || action === 'openEmailModal') {
            // showModal is the ack and can't be deferred, so never REST-fetch here.
            // Pass the cached guild for role-name display when this shard owns it; for a
            // cross-shard DM the guild is absent and the modal opens without role names.
            const cachedGuild = guildId ? bot.guilds.cache.get(guildId) : null
            await showEmailModal(interaction, guildId, cachedGuild)
            return
        }
        if (action === 'openCodeModal') {
            // Open code modal, include instruction with email. We only need the guild
            // id (for the modal customId) and the server language here — no guild object
            // required, which keeps this fast enough to stay within the 3s showModal window.
            if (!guildId) {
                await interaction.reply({ embeds: [createSessionExpiredEmbed(defaultLanguage, true)], flags: MessageFlags.Ephemeral }).catch(() => {})
                return
            }
            // Both reads are independent — run them concurrently to halve the pre-modal
            // latency (showModal is the ack and must land within ~3s).
            const pendingPromise = database.getPendingVerification(interaction.user.id, guildId)
            await database.getServerSettings(guildId, async serverSettings => {
                const language = serverSettings.language
                const pending = await pendingPromise

                // Build header text
                let headerText = getLocale(language, 'codeModalHeader')
                if (pending && pending.logEmail) {
                    headerText += `\n\n📬 **Sent to:** ${pending.logEmail}`
                }
                headerText += '\n\n-# Check your spam folder if you don\'t see the email'

                const modal = new ModalBuilder()
                    .setCustomId(`codeModal:${guildId}`)
                    .setTitle(getLocale(language, 'codeModalTitle'))

                const codeInput = new TextInputBuilder()
                    .setCustomId('codeInput')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(getLocale(language, 'codeModalPlaceholder'))
                    .setMinLength(6)
                    .setMaxLength(6)
                    .setRequired(true)
                
                const codeLabel = new LabelBuilder()
                    .setLabel(getLocale(language, 'codeModalLabel'))
                    .setTextInputComponent(codeInput)
                
                const headerDisplay = new TextDisplayBuilder().setContent(headerText)
                
                modal
                    .addTextDisplayComponents(headerDisplay)
                    .addLabelComponents(codeLabel)
                
                // Show code modal
                await interaction.showModal(modal).catch(() => {})
                // After opening the code modal, delete the preceding ephemeral code prompt (the one with the button)
                // Only delete if it's an ephemeral message (not the permanent verification embed)
                setTimeout(() => {
                    try {
                        if (interaction.message && interaction.message.id && interaction.message.flags?.has(MessageFlags.Ephemeral)) {
                            interaction.message.delete().catch(() => {})
                            interaction.webhook.deleteMessage(interaction.message.id).catch(() => {})
                        }
                    } catch {}
                }, 0)
            })
            return
        }
        return
    }

    // Modal submissions
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'setupDomainsModal') {
            try {
                await bot.commands.get('setup')?.handleModal(interaction)
            } catch (e) {
                console.error('Setup modal error:', e)
            }
            return
        }
        const { action, guildId: customGuildId } = parseVerificationCustomId(interaction.customId)
        const guildId = customGuildId || interaction.guildId
        // Email modal submit
        if (action === 'emailModal') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {})
            const emailText = interaction.fields.getTextInputValue('emailInput').trim()
            analytics.capture({ event: 'verification_email_submitted', userId: interaction.user.id, guildId })
            const userGuild = await resolveGuild(guildId)
            if (!userGuild) {
                const lang = await getGuildLanguage(guildId)
                await interaction.followUp({ embeds: [createSessionExpiredEmbed(lang, false)], flags: MessageFlags.Ephemeral }).catch(() => {})
                return
            }
            await database.getServerSettings(userGuild.id, async serverSettings => {
                const language = serverSettings.language
                const reply = (embed, components) => interaction.followUp({
                    embeds: [embed],
                    ...(components ? { components } : {}),
                    flags: MessageFlags.Ephemeral
                }).catch(() => null)

                const result = await verification.submitEmail({
                    community: userGuild,
                    settings: serverSettings,
                    userID: interaction.user.id,
                    email: emailText,
                    entitlements: await getEntitlementsForGuild(userGuild.id, interaction),
                    // notifyViaInteraction lets ErrorNotifier answer the user directly on
                    // this path — the code-submit path resolves its own deferred reply.
                    passthrough: { interaction, notifyViaInteraction: true }
                })

                switch (result.outcome) {
                    case 'not_configured':
                        // ErrorNotifier already answered the user via the interaction.
                        return
                    case 'blacklisted': {
                        const blacklistEmbed = new EmbedBuilder()
                            .setTitle(getLocale(language, 'mailBlacklistedTitle'))
                            .setDescription(getLocale(language, 'mailBlacklistedDescription'))
                            .setColor(0xED4245)
                        await reply(blacklistEmbed)
                        return
                    }
                    case 'emaillist_locked': {
                        const lockedUserEmbed = new EmbedBuilder()
                            .setTitle(getLocale(language, 'emaillistLockedUserTitle'))
                            .setDescription(getLocale(language, 'emaillistLockedUserMessage'))
                            .setColor(0xED4245)
                        await reply(lockedUserEmbed)
                        return
                    }
                    case 'invalid_email':
                        await reply(createInvalidEmailEmbed(language))
                        return
                    case 'rate_limited': {
                        const timeoutEmbed = new EmbedBuilder()
                            .setTitle(getLocale(language, 'mailTimeoutTitle'))
                            .setDescription(getLocale(language, 'mailTimeoutDescription', String(result.waitSeconds)))
                            .setColor(0xFFA500)
                        await reply(timeoutEmbed)
                        return
                    }
                    case 'quota_denied':
                        // The user-facing embed deliberately omits quota numbers and purchase
                        // prompts — verifying members can't (and shouldn't) pay for a
                        // server-level SKU. Admins get the purchase-enabled warning instead.
                        await reply(createMailLimitReachedEmbed(language, getWebsiteUrl()))
                        return
                    case 'mail_failed':
                        await reply(createMailFailedEmbed(language, result.email))
                        return
                    case 'code_sent': {
                        await reply(createCodeSentEmbed(language, result.email), [buildCodePromptRow(language, userGuild.id)])
                        const follow = await interaction.fetchReply().catch(() => null)
                        if (follow && follow.id) {
                            // Track the code prompt so we can delete it after code submission
                            codePromptMessages.set(interaction.user.id + userGuild.id, { id: follow.id, ts: Date.now() })
                            setTimeout(() => {
                                interaction.webhook.deleteMessage(follow.id).catch(() => {})
                            }, 300000)
                        }
                        return
                    }
                    default:
                        await reply(createGenericErrorEmbed(language))
                }
            })
            return
        }
        // Code modal submit
        if (action === 'codeModal') {
            // Defer immediately: this path may REST-fetch the guild and run several role
            // operations (DM flow on shard 0), which can exceed the 3s reply window.
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {})
            const autoDelete = (ms) => setTimeout(() => { interaction.deleteReply().catch(() => {}) }, ms)
            const codeText = interaction.fields.getTextInputValue('codeInput').trim()
            analytics.capture({ event: 'verification_code_submitted', userId: interaction.user.id, guildId })

            const cleanupCodePrompt = () => {
                const codePrompt = codePromptMessages.get(interaction.user.id + guildId)
                if (codePrompt) {
                    codePromptMessages.delete(interaction.user.id + guildId)
                    interaction.webhook.deleteMessage(codePrompt.id).catch(() => {})
                }
            }

            // Cheapest check first: no code on file (never requested, already used, or
            // expired/swept) means we can answer without any REST guild fetch.
            const pending = guildId ? await verification.peekPending(guildId, interaction.user.id) : null
            if (!pending) {
                analytics.capture({ event: 'verification_code_failed', userId: interaction.user.id, guildId, properties: { reason: 'expired' } })
                const lang = await getGuildLanguage(guildId)
                await interaction.editReply({ embeds: [createCodeExpiredEmbed(lang)] }).catch(() => {})
                cleanupCodePrompt()
                autoDelete(15000)
                return
            }

            const userGuild = await resolveGuild(guildId)
            if (!userGuild) {
                const lang = await getGuildLanguage(guildId)
                await interaction.editReply({ embeds: [createSessionExpiredEmbed(lang, true)] }).catch(() => {})
                autoDelete(10000)
                return
            }
            await database.getServerSettings(userGuild.id, async serverSettings => {
                const language = serverSettings.language
                const result = await verification.submitCode({
                    community: userGuild,
                    settings: serverSettings,
                    userID: interaction.user.id,
                    code: codeText,
                    pending,
                    // No notifyViaInteraction: admin notifications must not answer the
                    // user here, or the deferred reply below would hang on "thinking…".
                    passthrough: { interaction }
                })

                switch (result.outcome) {
                    case 'expired':
                        await interaction.editReply({ embeds: [createCodeExpiredEmbed(language)] }).catch(() => {})
                        cleanupCodePrompt()
                        autoDelete(15000)
                        return
                    case 'not_configured':
                    case 'db_error':
                    case 'authorization_failed':
                        await interaction.editReply({ embeds: [createGenericErrorEmbed(language)] }).catch(() => {})
                        autoDelete(15000)
                        return
                    case 'too_many_attempts':
                        await interaction.editReply({ embeds: [createTooManyAttemptsEmbed(language)] }).catch(() => {})
                        cleanupCodePrompt()
                        autoDelete(10000)
                        return
                    case 'wrong_code':
                        // Attempts remain — keep the "Enter Code" prompt alive so the user
                        // can retry without restarting the whole email flow.
                        await interaction.editReply({ embeds: [createInvalidCodeEmbed(language)] }).catch(() => {})
                        autoDelete(10000)
                        return
                    case 'success': {
                        const successEmbed = createVerificationSuccessEmbed(
                            language, result.labels, userGuild.name, userGuild.iconURL({ dynamic: true })
                        )
                        await interaction.editReply({ embeds: [successEmbed] }).catch(() => {})
                        cleanupCodePrompt()
                        autoDelete(20000)
                        return
                    }
                    default:
                        await interaction.editReply({ embeds: [createGenericErrorEmbed(language)] }).catch(() => {})
                        autoDelete(15000)
                }
            })
            return
        }
        return
    }

    // Handle autocomplete interactions
    if (interaction.isAutocomplete()) {
        const command = bot.commands.get(interaction.commandName);
        if (!command || !command.autocomplete) return;
        
        try {
            await command.autocomplete(interaction);
        } catch (error) {
            console.error('Autocomplete error:', error);
        }
        return;
    }

    if (!interaction.isCommand()) return;
    const command = bot.commands.get(interaction.commandName);

    if (!command) return;

    if (interaction.user.id === bot.user.id) return;
    await database.getServerSettings(interaction.guild.id, async serverSettings => {
        let language
        try {
            language = serverSettings.language
        } catch {
            language = defaultLanguage
        }
        // Allow all users to use /verify and /data (delete-user subcommand is user-accessible)
        // and /premium (buy/redeem). Everything else is admin-gated.
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)
        const allowed = isAdmin || interaction.commandName === "data" || interaction.commandName === "verify" || interaction.commandName === "premium"
        let subcommand = null
        try { subcommand = interaction.options.getSubcommand(false) } catch { subcommand = null }
        analytics.capture({
            event: 'command_used',
            userId: interaction.user.id,
            guild: interaction.guild,
            properties: { command: interaction.commandName, subcommand, is_admin: isAdmin, allowed }
        })
        try {
            if (allowed) {
                await command.execute(interaction);
            } else {
                await interaction.reply({
                    content: getLocale(language, "invalidPermissions"),
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (error) {
            console.error(error);
            analytics.capture({
                event: 'command_failed',
                userId: interaction.user.id,
                guild: interaction.guild,
                properties: { command: interaction.commandName, error: String(error?.message || error).slice(0, 500) }
            })
            // Send detailed error to admin and generic message to user
            await ErrorNotifier.notify({
                guild: interaction.guild,
                errorTitle: 'Command Execution Error',
                errorMessage: `Command \`/${interaction.commandName}\` failed with error:\n\`\`\`${error.message || error}\`\`\``,
                user: interaction.user,
                interaction: interaction,
                language: language
            })
        }
    })
});

// CLI listener is initialized in ready() only on primary shard

bot.login(token).catch((e) => {
    console.log("Failed to login: " + e.toString())
    OperatorWebhook.notify({
        title: '🚨 Bot failed to log in',
        description: `\`\`\`${(e?.message || e).toString().slice(0, 1800)}\`\`\``,
        level: 'error'
    })
    process.exitCode = 1;
});

// Graceful shutdown: notify operator before the shard process exits so we can
// distinguish planned restarts from crashes. Each shard fires its own signal,
// so this fires per-shard — useful for spotting partial outages.
let __shutdownInFlight = false
async function __handleShutdownSignal(signal) {
    if (__shutdownInFlight) return
    __shutdownInFlight = true
    const shardLabel = bot.shard?.ids?.join(',') ?? 'unsharded'
    console.log(`[Shard ${shardLabel}] Received ${signal}, shutting down...`)
    try {
        await OperatorWebhook.notify({
            title: '🔴 Bot shutting down',
            description: `Shard \`${shardLabel}\` received \`${signal}\`.`,
            level: 'warn'
        })
    } catch {}
    try {
        analytics.capture({ event: 'bot_shutdown', properties: { signal, shard: shardLabel } })
        await analytics.shutdown()
    } catch {}
    try { bot.destroy() } catch {}
    process.exit(0)
}
process.on('SIGTERM', () => __handleShutdownSignal('SIGTERM'))
process.on('SIGINT', () => __handleShutdownSignal('SIGINT'))
