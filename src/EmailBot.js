// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const Discord = require('discord.js');
const crypto = require('crypto');
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
const {PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, TextDisplayBuilder, EmbedBuilder} = require("discord.js");
const UserTimeout = require("./UserTimeout");
const md5hash = require("./crypto/Crypto");
const EmailUser = require("./database/EmailUser");
const { MessageFlags } = require('discord.js');
const { createSessionExpiredEmbed, createCodeExpiredEmbed, createTooManyAttemptsEmbed, createGenericErrorEmbed, createInvalidCodeEmbed, createInvalidEmailEmbed, createVerificationSuccessEmbed, createCodeSentEmbed, createMailLimitReachedEmbed } = require('./utils/embeds');
const { resolveVerificationRoles, unverifyPreviousHolder } = require('./utils/resolveVerificationRoles');
const ErrorNotifier = require('./utils/ErrorNotifier');
const { getWebsiteUrl, describeSku, getCurrency } = require('./utils/premiumButtons');
const onboarding = require('./utils/onboarding');
const OperatorWebhook = require('./utils/OperatorWebhook');
const analytics = require('./utils/Analytics');
const permissions = require('./utils/permissions');

// Verification code lifetime and the number of wrong guesses tolerated before the
// code is invalidated. The old in-memory codes had neither, leaving a 100k-keyspace
// code brute-forceable with unlimited attempts and no expiry.
const CODE_TTL_MS = 15 * 60 * 1000
const MAX_CODE_ATTEMPTS = 5
// Flat cooldown between "Resend code" clicks (separate from the escalating
// email-request backoff — resending to the SAME address is lower-risk).
const RESEND_COOLDOWN_MS = 60 * 1000

const EMAILLIST_LOCKED_NOTIFY_INTERVAL_MS = 60 * 60 * 1000
const emaillistLockedLastNotify = new Map()

function notifyEmaillistLocked(guild, language) {
    const last = emaillistLockedLastNotify.get(guild.id) || 0
    if (Date.now() - last < EMAILLIST_LOCKED_NOTIFY_INTERVAL_MS) return
    emaillistLockedLastNotify.set(guild.id, Date.now())
    ErrorNotifier.notify({
        guild,
        errorTitle: getLocale(language, 'emaillistLockedAdminTitle'),
        errorMessage: getLocale(language, 'emaillistLockedAdminMessage'),
        language
    }).catch(() => {})
}
const { emailMatchesDomains, emailIsBlacklisted } = require('./utils/wildcardMatch');
const premiumManager = require('./premium/PremiumManager');

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

// Pending verification codes now live in SQLite (see Database.pending_verifications)
// so they survive restarts and are reachable from whichever shard a DM interaction
// lands on. Only the best-effort, same-shard email-send rate limiter stays in memory.
let userTimeouts = new Map()

const mailSender = new MailSender(serverStatsAPI)
// Exposed for commands that send mail outside the verification flow (/testmail)
bot.mailSender = mailSender

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

    const pending = guildId ? await database.getPendingVerification(interaction.user.id, guildId) : null
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

    await database.getServerSettings(guildId, async serverSettings => {
        const language = serverSettings.language

        const sinceLast = Date.now() - (pending.lastSentAt || 0)
        if (sinceLast < RESEND_COOLDOWN_MS) {
            const wait = Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000)
            const cooldownEmbed = new EmbedBuilder()
                .setTitle(getLocale(language, 'mailTimeoutTitle'))
                .setDescription(getLocale(language, 'resendCooldownDescription', String(wait)))
                .setColor(0xFFA500)
            await interaction.editReply({ embeds: [cooldownEmbed] }).catch(() => {})
            autoDelete(10000)
            return
        }

        // Resends consume quota/credits like any other send.
        const premiumCheck = await premiumManager.canSendMail(guildId, await getEntitlementsForGuild(guildId, interaction))
        if (premiumCheck.autoDisabled) {
            premiumManager.notifyZeptoModeAutoDisabled(userGuild, language).catch(() => {})
        }
        if (!premiumCheck.allowed) {
            analytics.capture({
                event: 'mail_denied',
                userId: interaction.user.id,
                guild: userGuild,
                properties: {
                    reason: premiumCheck.reason || 'limit_reached',
                    mails_sent_month: premiumCheck.mailsSentMonth ?? null,
                    free_limit: premiumCheck.freeLimit ?? null,
                    resend: true
                }
            })
            await interaction.editReply({ embeds: [createMailLimitReachedEmbed(language, getWebsiteUrl())] }).catch(() => {})
            premiumManager.notifyMailDenied(userGuild, language).catch(() => {})
            autoDelete(15000)
            return
        }

        const code = crypto.randomInt(100000, 1000000).toString()
        await mailSender.sendEmail(pending.logEmail, code, userGuild.name, interaction, emailNotify, async (email) => {
            // Replace the old code with the fresh one (resets attempts, new TTL).
            await database.setPendingVerification(interaction.user.id, guildId, {
                code,
                emailHash: pending.emailHash,
                logEmail: pending.logEmail,
                expiresAt: Date.now() + CODE_TTL_MS
            })
            analytics.capture({ event: 'verification_code_resent', userId: interaction.user.id, guild: userGuild })
            const codePromptEmbed = createCodeSentEmbed(language, pending.logEmail)
            await interaction.editReply({ embeds: [codePromptEmbed], components: [buildCodePromptRow(language, guildId)] }).catch(() => {})
            const sent = await interaction.fetchReply().catch(() => null)
            if (sent && sent.id) {
                codePromptMessages.set(interaction.user.id + guildId, { id: sent.id, ts: Date.now() })
            }
            setTimeout(() => { interaction.deleteReply().catch(() => {}) }, 300000)
        }, premiumCheck.source, serverSettings.emailStyle, userGuild, serverSettings)
    })
}

bot.commands = new Discord.Collection();
const commandFiles = fs.readdirSync('./src/commands').filter(file => file.endsWith('.js'));
const commands = []

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    bot.commands.set(command.data.name, command);
    // Pin every command to guild context.
    //
    // Guild-scoped commands could never be invoked in a DM, so nothing here was ever
    // written to cope with one: every command reads guild settings, roles or members and
    // would throw on `interaction.guild` being null. Global commands, by contrast, are
    // DM-invocable by default — and setDefaultMemberPermissions does not apply there, so
    // the admin gate would be gone too. Setting the context keeps the exact surface the
    // bot had before the move to global registration.
    command.data.setContexts(Discord.InteractionContextType.Guild);
    commands.push(command.data.toJSON())
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000; // 5 seconds

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Publish the command set once, application-wide.
 *
 * Commands used to be registered per guild — one PUT per guild on every boot and on
 * every join — purely because `/domain remove` and `/blacklist remove` carried the
 * guild's own domains as static `choices`, which a global command cannot express. Both
 * now use autocomplete (see utils/autocompleteList), so a single global registration
 * serves every server and the per-guild traffic disappears entirely.
 *
 * Every shard calls this. The PUT is idempotent with an identical body, and paying one
 * extra request per shard is what lets each shard know its own registration succeeded
 * before it clears that guild's stale commands — no cross-shard coordination needed.
 *
 * @returns {Promise<boolean>} whether the command set is published
 */
async function registerGlobalCommands(attempt = 1) {
    try {
        await rest.put(Discord.Routes.applicationCommands(clientId), { body: commands });
        console.log(`[Shard ${bot.shard?.ids ?? 'N/A'}] Registered ${commands.length} global application commands`);
        return true;
    } catch (err) {
        const code = err?.code || err?.cause?.code;
        const isTimeout = code === 'UND_ERR_CONNECT_TIMEOUT' || err?.message?.includes('Connect Timeout Error');

        if (isTimeout && attempt < MAX_RETRIES) {
            console.log(`Timeout registering global commands, retrying in ${RETRY_DELAY_MS}ms...`);
            await sleep(RETRY_DELAY_MS);
            return registerGlobalCommands(attempt + 1);
        }

        // Nothing to fall back on and nothing guild-specific to blame, so log loudly and
        // leave the previously published command set in place rather than tearing it down.
        console.error(
            `[Shard ${bot.shard?.ids ?? 'N/A'}] Failed to register global commands ` +
            `(attempt ${attempt}/${MAX_RETRIES}):`, err?.rawError ?? err?.message ?? err
        );
        return false;
    }
}

/**
 * Remove the guild-scoped command copies left behind by the per-guild era.
 *
 * Discord serves a guild command and a global command of the same name side by side, so
 * until this runs an admin in an old server sees every command twice. Clearing is a
 * single PUT of an empty array; the result is recorded in the database so a guild is
 * touched exactly once, no matter how often the bot restarts.
 *
 * @returns {Promise<boolean>} whether the guild can be marked done
 */
async function clearGuildCommands(guild) {
    try {
        await rest.put(Discord.Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
        return true;
    } catch (err) {
        const status = err?.status ?? err?.statusCode;
        const discordCode = err?.rawError?.code;

        // 403/50001/10004 mean the guild-command scope is gone or the guild is
        // unreachable — either way there is nothing left to clear, so treat it as done
        // instead of retrying it on every boot forever.
        if (status === 403 || status === 404 || discordCode === 50001 || discordCode === 10004) return true;

        console.warn(`[Commands] Could not clear guild commands for ${guild.id}:`, err?.message ?? err);
        return false;
    }
}

/**
 * One-time sweep over this shard's guilds, clearing stale guild-scoped commands.
 *
 * Skipped entirely unless the global registration succeeded — removing a guild's working
 * commands when the replacements are not published would leave that server with none.
 */
async function clearStaleGuildCommands(bot) {
    const guilds = Array.from(bot.guilds.cache.values());
    const pending = await database.getGuildsNeedingCommandCleanup(guilds.map(g => g.id));
    const todo = guilds.filter(g => pending.has(g.id));
    if (todo.length === 0) return;

    console.log(`[Shard ${bot.shard?.ids ?? 'N/A'}] Clearing stale guild commands for ${todo.length} guild(s)`);

    let index = 0;
    let cleared = 0;
    const worker = async () => {
        while (index < todo.length) {
            const guild = todo[index++];
            if (await clearGuildCommands(guild)) {
                await database.markGuildCommandsCleared(guild.id);
                cleared++;
            }
        }
    };
    await Promise.all(Array.from({ length: 5 }, worker));

    console.log(`[Shard ${bot.shard?.ids ?? 'N/A'}] Cleared stale guild commands: ${cleared}/${todo.length}`);
}

/**
 * Warm this shard's guilds: prime the verification message so the persistent button's
 * message is in cache. Command registration used to happen here too and no longer does.
 */
async function primeGuilds(bot) {
    for (const guild of bot.guilds.cache.values()) {
        database.getServerSettings(guild.id, async serverSettings => {
            if (!serverSettings.channelID || !serverSettings.messageID) return;
            try {
                await guild.channels.cache
                    .get(serverSettings.channelID)
                    ?.messages.fetch(serverSettings.messageID);
            } catch (e) {
                // ignore
            }
        });
    }
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

    // Publish the command set once, then retire the guild-scoped copies this shard's
    // guilds still carry. Strictly ordered: a guild must not lose its working commands
    // before the global ones are live.
    const published = await registerGlobalCommands();
    if (published) {
        await clearStaleGuildCommands(bot);
    } else {
        console.warn('[Commands] Global registration failed — leaving existing guild commands in place');
    }
    await primeGuilds(bot);

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
        url: "https://getemailverified.com"
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
        type: "PLAYING", url: "https://getemailverified.com"
    })
}, 3600000).unref();

// Periodic cleanup. The in-memory maps are per-shard, so every shard prunes its own;
// the expired-code sweep touches the shared DB, so only the primary shard runs it.
const CLEANUP_STALE_MS = 60 * 60 * 1000
setInterval(() => {
    const now = Date.now()
    for (const [userId, t] of userTimeouts) {
        if (t.timestamp + t.waitseconds * 1000 < now - CLEANUP_STALE_MS) userTimeouts.delete(userId)
    }
    for (const [key, v] of codePromptMessages) {
        if (!v || v.ts < now - CLEANUP_STALE_MS) codePromptMessages.delete(key)
    }
    for (const [gid, ts] of emaillistLockedLastNotify) {
        if (ts < now - EMAILLIST_LOCKED_NOTIFY_INTERVAL_MS) emaillistLockedLastNotify.delete(gid)
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
                    await permissions.notifyRoleAssignmentFailure(
                        member.guild, serverSettings, serverSettings.language, member.user
                    )
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
    // No command registration here: commands are global, so a new guild receives them
    // from Discord the moment the bot is added. It also has no guild-scoped commands to
    // retire, so record it as already cleaned up — otherwise the next restart would spend
    // a pointless request clearing commands that were never there.
    database.markGuildCommandsCleared(guild.id).catch(() => {})
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
        // Permission self-check at the only moment the admin is guaranteed to be looking:
        // right after they added the bot. An invite that granted too little is otherwise
        // invisible until a member fails to verify, which is where servers were churning.
        //
        // Chained after onboarding rather than fired alongside it: a fresh guild has no
        // error channel configured, so this alert lands in the owner's DMs — the same
        // place the welcome message just went. Sequencing them keeps the greeting first
        // and the problem report second, instead of two DMs racing. Sends nothing at all
        // when the invite was correct.
        .finally(() => checkGuildPermissionHealth(guild, 'guild_joined'))
})

/**
 * Audit a guild's permissions and role order and notify its admins if anything is wrong.
 * Fire-and-forget, and throttled inside permissions.notifyPermissionIssues.
 */
function checkGuildPermissionHealth(guild, trigger) {
    database.getServerSettings(guild.id, async serverSettings => {
        const language = serverSettings.language || defaultLanguage
        try {
            const audit = await permissions.notifyPermissionIssues(guild, serverSettings, language)
            if (!audit) return
            analytics.capture({
                event: 'permission_issue_detected',
                guild,
                properties: {
                    trigger,
                    missing_required: audit.permissions.missingRequired.map(p => p.name),
                    missing_recommended: audit.permissions.missingRecommended.map(p => p.name),
                    unassignable_roles: audit.roles.unassignable.length,
                    unassignable_reasons: audit.roles.unassignable.map(u => u.reason)
                }
            })
        } catch (e) {
            console.warn(`[permissions] health check failed for ${guild.id}:`, e?.message || e)
        }
    })
}

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
                if (!serverSettings.status) {
                    analytics.capture({ event: 'verification_email_rejected', userId: interaction.user.id, guild: userGuild, properties: { reason: 'not_configured' } })
                    await ErrorNotifier.notify({
                        guild: userGuild,
                        errorTitle: getLocale(serverSettings.language, 'errorBotNotConfiguredTitle'),
                        errorMessage: getLocale(serverSettings.language, 'errorBotNotConfiguredMessage'),
                        user: interaction.user,
                        interaction: interaction,
                        language: serverSettings.language
                    });
                    return
                }
                // Blacklist check (supports wildcards, e.g., *@tempmail.*, spam*)
                if (emailIsBlacklisted(emailText, serverSettings.blacklist)) {
                    analytics.capture({ event: 'verification_email_rejected', userId: interaction.user.id, guild: userGuild, properties: { reason: 'blacklisted' } })
                    const blacklistEmbed = new EmbedBuilder()
                        .setTitle(getLocale(serverSettings.language, "mailBlacklistedTitle"))
                        .setDescription(getLocale(serverSettings.language, "mailBlacklistedDescription"))
                        .setColor(0xED4245)
                    await interaction.followUp({ embeds: [blacklistEmbed], flags: MessageFlags.Ephemeral }).catch(() => {})
                    return
                }
                // Locked-list gate: an allowedEmails list exists from a prior Pro / CSV unlock,
                // but the guild can no longer manage it. Block all verifications until the admin
                // either clears the list (`/emaillist clear`) or restores CSV access.
                if ((serverSettings.allowedEmails || []).length > 0) {
                    const csvCheck = await premiumManager.canUseCSVFeature(userGuild.id, await getEntitlementsForGuild(userGuild.id, interaction))
                    if (!csvCheck.allowed) {
                        analytics.capture({ event: 'verification_email_rejected', userId: interaction.user.id, guild: userGuild, properties: { reason: 'emaillist_locked' } })
                        const lockedUserEmbed = new EmbedBuilder()
                            .setTitle(getLocale(serverSettings.language, 'emaillistLockedUserTitle'))
                            .setDescription(getLocale(serverSettings.language, 'emaillistLockedUserMessage'))
                            .setColor(0xED4245)
                        await interaction.followUp({ embeds: [lockedUserEmbed], flags: MessageFlags.Ephemeral }).catch(() => {})
                        notifyEmaillistLocked(userGuild, serverSettings.language)
                        return
                    }
                }
                // Domain allowlist check (supports wildcards, e.g., @*.edu, @*.harvard.edu)
                // Also checks against uploaded email list. If neither domains nor an allowedEmails
                // list is configured, all valid email addresses are accepted (subject to blacklist).
                // Must be strict enough that the mail provider never sees an address it
                // would reject: exactly one @, no whitespace, and a dotted domain. Same
                // shape as the CSV import check in commands/emaillist.js.
                const hasValidFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailText)
                const allowedEmails = serverSettings.allowedEmails || []
                const noRestrictionsConfigured = serverSettings.domains.length === 0 && allowedEmails.length === 0
                const matchesDomain = emailMatchesDomains(emailText, serverSettings.domains)
                // allowedEmails are stored as MD5 hashes of the lowercased address (same scheme as userEmails)
                const isInAllowedList = allowedEmails.includes(md5hash(emailText.toLowerCase()))

                if (!hasValidFormat || (!noRestrictionsConfigured && !matchesDomain && !isInAllowedList)) {
                    analytics.capture({ event: 'verification_email_rejected', userId: interaction.user.id, guild: userGuild, properties: { reason: hasValidFormat ? 'domain_not_allowed' : 'invalid_format' } })
                    await interaction.followUp({ embeds: [createInvalidEmailEmbed(serverSettings.language)], flags: MessageFlags.Ephemeral }).catch(() => {})
                    return
                }
                // Rate limit per user per guild — per-guild keying means abusive
                // escalation in one guild neither penalizes nor is reset by the same
                // user's legitimate activity in another guild.
                let userTimeout = userTimeouts.get(interaction.user.id + userGuild.id)
                if (!userTimeout) {
                    userTimeout = new UserTimeout()
                    userTimeouts.set(interaction.user.id + userGuild.id, userTimeout)
                }
                const timeoutMs = userTimeout.timestamp + userTimeout.waitseconds * 1000 - Date.now()
                if (timeoutMs > 0) {
                    analytics.capture({ event: 'verification_email_rejected', userId: interaction.user.id, guild: userGuild, properties: { reason: 'rate_limited' } })
                    const timeoutEmbed = new EmbedBuilder()
                        .setTitle(getLocale(serverSettings.language, "mailTimeoutTitle"))
                        .setDescription(getLocale(serverSettings.language, "mailTimeoutDescription", (timeoutMs / 1000).toFixed(0)))
                        .setColor(0xFFA500)
                    await interaction.followUp({ embeds: [timeoutEmbed], flags: MessageFlags.Ephemeral }).catch(() => {})
                    return
                }
                userTimeout.timestamp = Date.now()
                userTimeout.increaseWaitTime()

                // Premium check: verify the guild hasn't exceeded its free monthly limit.
                // The user-facing embed deliberately omits quota numbers and purchase prompts —
                // verifying members can't (and shouldn't) pay for a server-level SKU. The
                // server's admins get the full purchase-enabled warning via ErrorNotifier instead.
                const premiumCheck = await premiumManager.canSendMail(userGuild.id, await getEntitlementsForGuild(userGuild.id, interaction))
                if (premiumCheck.autoDisabled) {
                    premiumManager.notifyZeptoModeAutoDisabled(userGuild, serverSettings.language).catch(() => {})
                }
                if (!premiumCheck.allowed) {
                    analytics.capture({
                        event: 'mail_denied',
                        userId: interaction.user.id,
                        guild: userGuild,
                        properties: {
                            reason: premiumCheck.reason || 'limit_reached',
                            mails_sent_month: premiumCheck.mailsSentMonth ?? null,
                            free_limit: premiumCheck.freeLimit ?? null
                        }
                    })
                    const limitEmbed = createMailLimitReachedEmbed(serverSettings.language, getWebsiteUrl())
                    await interaction.followUp({ embeds: [limitEmbed], flags: MessageFlags.Ephemeral }).catch(() => {})
                    // Record the denial and fire the escalating admin upsell (1st/5th/20th
                    // blocked member per month) — this is lost demand admins can't see otherwise.
                    premiumManager.notifyMailDenied(userGuild, serverSettings.language).catch(() => {})
                    return
                }

                // 6-digit code from a CSPRNG (the old Math.random()+1 scheme only ever
                // produced 100000–199999). Persisted to SQLite with a TTL so it survives
                // restarts and is readable from the shard a DM code-entry lands on.
                const code = crypto.randomInt(100000, 1000000).toString()
                // Send email and store code on success
                await mailSender.sendEmail(emailText.toLowerCase(), code, userGuild.name, interaction, emailNotify, async (email) => {
                    await database.setPendingVerification(interaction.user.id, userGuild.id, {
                        code,
                        emailHash: md5hash(email),
                        logEmail: email,
                        expiresAt: Date.now() + CODE_TTL_MS
                    })

                    // Only show the code prompt if email was successfully sent
                    const codePromptEmbed = createCodeSentEmbed(serverSettings.language, emailText.toLowerCase())
                    const row = buildCodePromptRow(serverSettings.language, userGuild.id)

                    await interaction.followUp({ embeds: [codePromptEmbed], components: [row], flags: MessageFlags.Ephemeral }).catch(() => null)
                    const follow = await interaction.fetchReply().catch(() => null)
                    if (follow && follow.id) {
                        // Track the code prompt so we can delete it after code submission
                        codePromptMessages.set(interaction.user.id + userGuild.id, { id: follow.id, ts: Date.now() })
                        setTimeout(() => {
                            interaction.webhook.deleteMessage(follow.id).catch(() => {})
                        }, 300000)
                    }
                }, premiumCheck.source, serverSettings.emailStyle, userGuild, serverSettings)
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
            const pending = guildId ? await database.getPendingVerification(interaction.user.id, guildId) : null
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
                if (!serverSettings.status) {
                    analytics.capture({ event: 'verification_code_failed', userId: interaction.user.id, guild: userGuild, properties: { reason: 'not_configured' } })
                    // Notify admins (without `interaction`, so it doesn't also followUp the user)
                    // and resolve the deferred reply ourselves — otherwise it hangs on "thinking…".
                    await ErrorNotifier.notify({
                        guild: userGuild,
                        errorTitle: getLocale(language, 'errorBotNotConfiguredTitle'),
                        errorMessage: getLocale(language, 'errorBotNotConfiguredMessage'),
                        user: interaction.user,
                        language: language
                    });
                    await interaction.editReply({ embeds: [createGenericErrorEmbed(language)] }).catch(() => {})
                    autoDelete(15000)
                    return
                }

                // Wrong code: count the attempt and invalidate the code once the cap is hit
                // so a 6-digit code can't be brute-forced. incrementPendingAttempts is a
                // single atomic UPDATE…RETURNING; on a DB error we fail closed (generic
                // error, attempt not revealed) instead of treating it as "not at the cap".
                if (pending.code !== codeText) {
                    const attempts = await database.incrementPendingAttempts(interaction.user.id, userGuild.id)
                    let failReason = 'wrong_code'
                    if (attempts === 'error') {
                        failReason = 'db_error'
                        await interaction.editReply({ embeds: [createGenericErrorEmbed(language)] }).catch(() => {})
                    } else if (attempts === null) {
                        // Row vanished between read and increment: consumed or expired.
                        failReason = 'expired'
                        await interaction.editReply({ embeds: [createCodeExpiredEmbed(language)] }).catch(() => {})
                        cleanupCodePrompt()
                    } else if (attempts >= MAX_CODE_ATTEMPTS) {
                        failReason = 'too_many_attempts'
                        await database.deletePendingVerification(interaction.user.id, userGuild.id)
                        await interaction.editReply({ embeds: [createTooManyAttemptsEmbed(language)] }).catch(() => {})
                        cleanupCodePrompt()
                    } else {
                        // Attempts remain — keep the "Enter Code" prompt alive so the user
                        // can retry without restarting the whole email flow.
                        await interaction.editReply({ embeds: [createInvalidCodeEmbed(language)] }).catch(() => {})
                    }
                    analytics.capture({ event: 'verification_code_failed', userId: interaction.user.id, guild: userGuild, properties: { reason: failReason } })
                    autoDelete(10000)
                    return
                }

                // Correct code → consume it atomically. If another submission of the same
                // code (e.g. DM modal racing the guild-channel modal on another shard)
                // already consumed it, this delete reports no change and we bail out
                // instead of double-verifying.
                const consumed = await database.deletePendingVerification(interaction.user.id, userGuild.id)
                if (!consumed) {
                    analytics.capture({ event: 'verification_code_failed', userId: interaction.user.id, guild: userGuild, properties: { reason: 'expired' } })
                    await interaction.editReply({ embeds: [createCodeExpiredEmbed(language)] }).catch(() => {})
                    autoDelete(15000)
                    return
                }
                // If anything below fails before roles are assigned, restore the pending row
                // (with its remaining TTL) so the user can resubmit the same code instead of
                // burning another email send from the guild's quota.
                const restorePending = () => database.setPendingVerification(interaction.user.id, userGuild.id, {
                    code: pending.code,
                    emailHash: pending.emailHash,
                    logEmail: pending.logEmail,
                    expiresAt: pending.expiresAt
                }).catch(() => {})

                const { rolesToAdd, roleUnverified } = resolveVerificationRoles(userGuild, serverSettings, pending.logEmail)

                // Config expects roles but none resolved (roles deleted, or a stale/failed
                // role cache on a cross-shard fetch): don't silently verify with no roles.
                const expectsRoles = (serverSettings.defaultRoles || []).length > 0
                    || Object.keys(serverSettings.domainRoles || {}).length > 0
                if (rolesToAdd.length === 0 && expectsRoles) {
                    analytics.capture({ event: 'verification_code_failed', userId: interaction.user.id, guild: userGuild, properties: { reason: 'role_assignment_failed', detail: 'no_roles_resolved' } })
                    await restorePending()
                    await permissions.notifyRoleAssignmentFailure(userGuild, serverSettings, language, interaction.user)
                    await interaction.editReply({ embeds: [createGenericErrorEmbed(language)] }).catch(() => {})
                    autoDelete(15000)
                    return
                }

                // Unverify any previous holder of this email.
                unverifyPreviousHolder(userGuild, pending.emailHash, interaction.user.id, rolesToAdd, roleUnverified, language)

                // Persist the new verified user (first role kept in the legacy field for back-compat).
                const primaryRoleId = (serverSettings.defaultRoles && serverSettings.defaultRoles[0]) || (rolesToAdd[0] && rolesToAdd[0].id) || ''
                database.updateEmailUser(new EmailUser(pending.emailHash, interaction.user.id, userGuild.id, primaryRoleId, 0))

                // Assign roles to the verifying member.
                const assignedRoleNames = []
                try {
                    const verifyMember = await userGuild.members.fetch(interaction.user.id)
                    for (const role of rolesToAdd) {
                        await verifyMember.roles.add(role)
                        assignedRoleNames.push(role.name)
                    }
                    if (roleUnverified) {
                        await verifyMember.roles.remove(roleUnverified).catch(() => {})
                    }
                } catch (e) {
                    // Restore the code so the user can resubmit once the admin fixes the
                    // bot's permissions, notify admins (no `interaction`, so no duplicate
                    // followUp), and resolve the deferred reply so it doesn't hang.
                    analytics.capture({ event: 'verification_code_failed', userId: interaction.user.id, guild: userGuild, properties: { reason: 'role_assignment_failed', detail: 'role_add_error' } })
                    await restorePending()
                    await permissions.notifyRoleAssignmentFailure(userGuild, serverSettings, language, interaction.user)
                    await interaction.editReply({ embeds: [createGenericErrorEmbed(language)] }).catch(() => {})
                    autoDelete(15000)
                    return
                }

                try {
                    if (serverSettings.logChannel !== "") {
                        const rolesText = assignedRoleNames.length > 0 ? ` [${assignedRoleNames.join(', ')}]` : ''
                        const logChannel = userGuild.channels.cache.get(serverSettings.logChannel)
                            || await userGuild.channels.fetch(serverSettings.logChannel).catch(() => null)
                        if (logChannel) {
                            logChannel.send(`✅ <@${interaction.user.id}> → \`${pending.logEmail}\`${rolesText}`).catch(() => {})
                        }
                    }
                } catch {}

                const successEmbed = createVerificationSuccessEmbed(language, assignedRoleNames, userGuild.name, userGuild.iconURL({ dynamic: true }))
                await interaction.editReply({ embeds: [successEmbed] }).catch(() => {})

                // Track successful verification (global and per-guild) and clear the rate limiter
                // so a returning user isn't stuck behind the escalating email-send backoff.
                serverStatsAPI.increaseVerifiedUsers()
                database.incrementVerifications(userGuild.id)
                analytics.capture({ event: 'verification_completed', userId: interaction.user.id, guild: userGuild, properties: { roles_assigned: assignedRoleNames.length } })
                userTimeouts.delete(interaction.user.id + userGuild.id)

                cleanupCodePrompt()
                autoDelete(20000)
            })
            return
        }
        return
    }

    // Handle autocomplete interactions
    if (interaction.isAutocomplete()) {
        const command = bot.commands.get(interaction.commandName);
        if (!command || !command.autocomplete) return;
        // Every autocomplete source is per-guild configuration; without a guild there is
        // nothing to suggest. Commands are pinned to guild context so this should be
        // unreachable — it exists so a future context change degrades to empty
        // suggestions instead of an exception per keystroke.
        if (!interaction.guildId) return interaction.respond([]).catch(() => {});

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

    // Belt and braces for the same reason as the autocomplete guard above: every command
    // dereferences interaction.guild and interaction.member, both null in a DM. Answer
    // instead of throwing if one ever arrives without a guild.
    if (!interaction.guild || !interaction.member) {
        await interaction.reply({
            content: getLocale(defaultLanguage, 'commandGuildOnly'),
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
    }

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
