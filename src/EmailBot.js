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
const registerRemoveDomain = require("./bot/registerRemoveDomain")
const registerBlacklistChoices = require("./bot/registerBlacklistChoices")
const {PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, TextDisplayBuilder, EmbedBuilder} = require("discord.js");
const UserTimeout = require("./UserTimeout");
const md5hash = require("./crypto/Crypto");
const EmailUser = require("./database/EmailUser");
const { MessageFlags } = require('discord.js');
const { createSessionExpiredEmbed, createCodeExpiredEmbed, createTooManyAttemptsEmbed, createGenericErrorEmbed, createInvalidCodeEmbed, createInvalidEmailEmbed, createVerificationSuccessEmbed, createCodeSentEmbed, createMailLimitReachedEmbed } = require('./utils/embeds');
const { resolveVerificationRoles, unverifyPreviousHolder } = require('./utils/resolveVerificationRoles');
const ErrorNotifier = require('./utils/ErrorNotifier');
const { getWebsiteUrl, describeSku } = require('./utils/premiumButtons');
const OperatorWebhook = require('./utils/OperatorWebhook');

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

        // Boot-time SMTP self-test: catch broken credentials/hosts before the first
        // member's verification silently fails.
        mailSender.selfTest().then(result => {
            if (result.ok) {
                console.log('[MailSender] SMTP self-test passed')
            } else {
                console.error('[MailSender] SMTP self-test FAILED:', result.error)
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
})

bot.on("guildMemberAdd", async member => {
    await database.getServerSettings(member.guild.id, async serverSettings => {
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
    const status = entitlement.isTest() ? '🧪 Test purchase' : '🟢 Started'
    OperatorWebhook.notify({
        title: `💎 New purchase — ${entitlementProductName(entitlement)}`,
        fields: entitlementFields(entitlement, status),
        level: 'success'
    })

    // Consumables (credit packs, CSV unlock) do nothing until the buyer runs
    // /premium redeem — a paid-but-never-redeemed pack is a refund waiting to
    // happen. Subscriptions activate automatically, so no DM needed there.
    const info = describeSku(entitlement.skuId)
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
    // approximate, so we read the most reliable signals: a later end date is a
    // renewal, an earlier/new one is a scheduled cancellation, the consumed flag
    // flipping is a redemption, and the deleted flag flipping is a removal.
    const oldEnds = oldEntitlement.endsTimestamp ?? null
    const newEnds = newEntitlement.endsTimestamp ?? null
    let status
    if (!oldEntitlement.deleted && newEntitlement.deleted) {
        status = '🔴 Deleted'
    } else if (!oldEntitlement.consumed && newEntitlement.consumed) {
        status = '✅ Consumed'
    } else if (oldEnds !== null && newEnds !== null && newEnds > oldEnds) {
        status = '🔄 Renewed'
    } else if (oldEnds !== null && newEnds !== null && newEnds < oldEnds) {
        status = '🚫 Cancelled (active until end date)'
    } else if (oldEnds === null && newEnds !== null) {
        status = '🚫 End date set (cancelled / scheduled)'
    } else {
        status = '🔁 Updated'
    }

    const fields = entitlementFields(newEntitlement, status)
    if (oldEnds !== newEnds) {
        fields.push({ name: 'Previous end', value: formatDiscordTime(oldEntitlement.endsAt) ?? 'None', inline: true })
    }

    OperatorWebhook.notify({
        title: `🔁 Subscription updated — ${entitlementProductName(newEntitlement)}`,
        fields,
        level: 'info'
    })
})

bot.on('entitlementDelete', entitlement => {
    console.log(`[Premium] Entitlement deleted: sku=${entitlement.skuId} user=${entitlement.userId ?? 'n/a'} guild=${entitlement.guildId ?? 'n/a'} type=${entitlement.type}`)
    OperatorWebhook.notify({
        title: `❌ Entitlement removed — ${entitlementProductName(entitlement)}`,
        description: 'Subscription ended, was cancelled, refunded, or revoked.',
        fields: entitlementFields(entitlement, '🔴 Removed'),
        level: 'warn'
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
            const userGuild = await resolveGuild(guildId)
            if (!userGuild) {
                const lang = await getGuildLanguage(guildId)
                await interaction.followUp({ embeds: [createSessionExpiredEmbed(lang, false)], flags: MessageFlags.Ephemeral }).catch(() => {})
                return
            }
            await database.getServerSettings(userGuild.id, async serverSettings => {
                if (!serverSettings.status) {
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
                const hasValidFormat = emailText.split("@").length - 1 === 1 && !emailText.includes(' ')
                const allowedEmails = serverSettings.allowedEmails || []
                const noRestrictionsConfigured = serverSettings.domains.length === 0 && allowedEmails.length === 0
                const matchesDomain = emailMatchesDomains(emailText, serverSettings.domains)
                // allowedEmails are stored as MD5 hashes of the lowercased address (same scheme as userEmails)
                const isInAllowedList = allowedEmails.includes(md5hash(emailText.toLowerCase()))

                if (!hasValidFormat || (!noRestrictionsConfigured && !matchesDomain && !isInAllowedList)) {
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
                    if (attempts === 'error') {
                        await interaction.editReply({ embeds: [createGenericErrorEmbed(language)] }).catch(() => {})
                    } else if (attempts === null) {
                        // Row vanished between read and increment: consumed or expired.
                        await interaction.editReply({ embeds: [createCodeExpiredEmbed(language)] }).catch(() => {})
                        cleanupCodePrompt()
                    } else if (attempts >= MAX_CODE_ATTEMPTS) {
                        await database.deletePendingVerification(interaction.user.id, userGuild.id)
                        await interaction.editReply({ embeds: [createTooManyAttemptsEmbed(language)] }).catch(() => {})
                        cleanupCodePrompt()
                    } else {
                        // Attempts remain — keep the "Enter Code" prompt alive so the user
                        // can retry without restarting the whole email flow.
                        await interaction.editReply({ embeds: [createInvalidCodeEmbed(language)] }).catch(() => {})
                    }
                    autoDelete(10000)
                    return
                }

                // Correct code → consume it atomically. If another submission of the same
                // code (e.g. DM modal racing the guild-channel modal on another shard)
                // already consumed it, this delete reports no change and we bail out
                // instead of double-verifying.
                const consumed = await database.deletePendingVerification(interaction.user.id, userGuild.id)
                if (!consumed) {
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
                    await restorePending()
                    await ErrorNotifier.notify({
                        guild: userGuild,
                        errorTitle: getLocale(language, 'errorRoleAssignTitle'),
                        errorMessage: getLocale(language, 'errorRoleAssignMessage'),
                        user: interaction.user,
                        language: language
                    })
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
                    await restorePending()
                    await ErrorNotifier.notify({
                        guild: userGuild,
                        errorTitle: getLocale(language, 'errorRoleAssignTitle'),
                        errorMessage: getLocale(language, 'errorRoleAssignMessage'),
                        user: interaction.user,
                        language: language
                    })
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
        try {
            // Allow all users to use /verify and /data (delete-user subcommand is user-accessible)
            // Allow /globalstats for owner check to happen inside the command
            if (interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) || interaction.commandName === "data" || interaction.commandName === "verify" || interaction.commandName === "globalstats" || interaction.commandName === "premium") {
                await command.execute(interaction);
            } else {
                await interaction.reply({
                    content: getLocale(language, "invalidPermissions"),
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (error) {
            console.error(error);
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
    try { bot.destroy() } catch {}
    process.exit(0)
}
process.on('SIGTERM', () => __handleShutdownSignal('SIGTERM'))
process.on('SIGINT', () => __handleShutdownSignal('SIGINT'))
