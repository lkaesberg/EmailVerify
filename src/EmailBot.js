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
const UserTimeout = require("./UserTimeout");
const md5hash = require("./crypto/Crypto");
const EmailUser = require("./database/EmailUser");
const { MessageFlags } = require('discord.js');
const { createSessionExpiredEmbed, createInvalidCodeEmbed, createInvalidEmailEmbed, createVerificationSuccessEmbed, createCodeSentEmbed, createMailLimitReachedEmbed } = require('./utils/embeds');
const ErrorNotifier = require('./utils/ErrorNotifier');
const { getWebsiteUrl, describeSku } = require('./utils/premiumButtons');
const OperatorWebhook = require('./utils/OperatorWebhook');

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
const { emailMatchesDomains, emailIsBlacklisted, getMatchingDomainPatterns } = require('./utils/wildcardMatch');
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

module.exports.userGuilds = userGuilds = new Map()

const userCodes = new Map()

let userTimeouts = new Map()

const mailSender = new MailSender(serverStatsAPI)

// Expose cross-shard state on the client for broadcastEval access
bot.userGuilds = userGuilds
bot.userCodes = userCodes
bot.userTimeouts = userTimeouts
bot.serverStatsAPI = serverStatsAPI

// Track ephemeral prompt messages so we can delete them at the right time
const verifyPromptMessages = new Map() // key: userId, value: messageId for "Enter Email" prompt
const codePromptMessages = new Map()   // key: userId+guildId, value: messageId for "Enter Code" prompt

module.exports.verifyPromptMessages = verifyPromptMessages
module.exports.codePromptMessages = codePromptMessages

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
    }
});

setInterval(function () {
    bot.user.setActivity("/verify | Website", {
        type: "PLAYING", url: "https://emailbot.larskaesberg.de"
    })
}, 3600000);

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
            await sendVerifyMessage(member.guild, member.user, userGuilds)
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

bot.on('messageCreate', async (message) => {
    if (message.author.bot) return
    if (message.content === "") return
    console.log(`[Shard ${bot.shard?.ids ?? 'N/A'}] Message created: "${message.content}" in ${message.guild?.name ?? 'DM'} by ${message.author.username} (${message.author.id})`)
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
    // Button: open email modal or open code modal
    if (interaction.isButton()) {
        if (interaction.customId === 'verifyButton' || interaction.customId === 'openEmailModal') {
            const guild = interaction.guild || userGuilds.get(interaction.user.id)
            await showEmailModal(interaction, guild, userGuilds)
            return
        }
        if (interaction.customId === 'openCodeModal') {
            // Open code modal, include instruction with email
            const userGuild = interaction.guild || userGuilds.get(interaction.user.id)
            if (!userGuild) {
                await interaction.reply({ embeds: [createSessionExpiredEmbed(true)], flags: MessageFlags.Ephemeral }).catch(() => {})
                return
            }
            const key = interaction.user.id + userGuild.id
            const userCode = userCodes.get(key)
            await database.getServerSettings(userGuild.id, async serverSettings => {
                const language = serverSettings.language
                
                // Build header text
                let headerText = getLocale(language, 'codeModalHeader')
                if (userCode && userCode.logEmail) {
                    headerText += `\n\n📬 **Sent to:** ${userCode.logEmail}`
                }
                headerText += '\n\n-# Check your spam folder if you don\'t see the email'
                
                const modal = new ModalBuilder()
                    .setCustomId('codeModal')
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
        // Email modal submit
        if (interaction.customId === 'emailModal') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {})
            const emailText = interaction.fields.getTextInputValue('emailInput').trim()
            const userGuild = userGuilds.get(interaction.user.id)
            if (!userGuild) {
                await interaction.followUp({ embeds: [createSessionExpiredEmbed(false)], flags: MessageFlags.Ephemeral }).catch(() => {})
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
                    const csvCheck = await premiumManager.canUseCSVFeature(userGuild.id, interaction.entitlements)
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
                // Rate limit per user
                let userTimeout = userTimeouts.get(interaction.user.id)
                if (!userTimeout) {
                    userTimeout = new UserTimeout()
                    userTimeouts.set(interaction.user.id, userTimeout)
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
                const premiumCheck = await premiumManager.canSendMail(userGuild.id, interaction.entitlements)
                if (premiumCheck.autoDisabled) {
                    premiumManager.notifyZeptoModeAutoDisabled(userGuild, serverSettings.language).catch(() => {})
                }
                if (!premiumCheck.allowed) {
                    const limitEmbed = createMailLimitReachedEmbed(serverSettings.language, getWebsiteUrl())
                    await interaction.followUp({ embeds: [limitEmbed], flags: MessageFlags.Ephemeral }).catch(() => {})
                    return
                }

                const code = Math.floor((Math.random() + 1) * 100000).toString()
                // Send email and store code on success
                await mailSender.sendEmail(emailText.toLowerCase(), code, userGuild.name, interaction, emailNotify, async (email) => {
                    userCodes.set(interaction.user.id + userGuild.id, {
                        code: code,
                        email: md5hash(email),
                        logEmail: email
                    })

                    // Only show the code prompt if email was successfully sent
                    const codePromptEmbed = createCodeSentEmbed(serverSettings.language, emailText.toLowerCase())
                    
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('openCodeModal')
                            .setLabel(getLocale(serverSettings.language, 'enterCodeButton'))
                            .setEmoji('🔑')
                            .setStyle(ButtonStyle.Success)
                    )
                    // Delete the initial verify prompt ("Enter Email") once email has been submitted
                    const prevVerifyPromptId = verifyPromptMessages.get(interaction.user.id)
                    if (prevVerifyPromptId) {
                        verifyPromptMessages.delete(interaction.user.id)
                        // Try both deletion methods for reliability with ephemeral messages
                        interaction.webhook.deleteMessage(prevVerifyPromptId).catch(() => {})
                    }

                    await interaction.followUp({ embeds: [codePromptEmbed], components: [row], flags: MessageFlags.Ephemeral }).catch(() => null)
                    const follow = await interaction.fetchReply().catch(() => null)
                    if (follow && follow.id) {
                        // Track the code prompt so we can delete it after code submission
                        codePromptMessages.set(interaction.user.id + userGuild.id, follow.id)
                        setTimeout(() => {
                            interaction.webhook.deleteMessage(follow.id).catch(() => {})
                        }, 300000)
                    }
                }, premiumCheck.source, serverSettings.emailStyle)
            })
            return
        }
        // Code modal submit
        if (interaction.customId === 'codeModal') {
            const codeText = interaction.fields.getTextInputValue('codeInput').trim()
            const userGuild = userGuilds.get(interaction.user.id)
            if (!userGuild) {
                await interaction.reply({ embeds: [createSessionExpiredEmbed(true)], flags: MessageFlags.Ephemeral }).catch(() => null)
                const sent = await interaction.fetchReply().catch(() => null)
                setTimeout(() => {
                    try { interaction.deleteReply().catch(() => {}) } catch {}
                    try { if (sent && sent.id) interaction.webhook.deleteMessage(sent.id).catch(() => {}) } catch {}
                }, 10000)
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
                const userCode = userCodes.get(interaction.user.id + userGuild.id)
                if (userCode && userCode.code === codeText) {
                    // Success: assign roles and update DB
                    // Collect all roles to assign: default roles + domain-specific roles
                    const defaultRoles = serverSettings.defaultRoles || []
                    const domainRoles = serverSettings.domainRoles || {}
                    
                    // Get all matching domain patterns for this email
                    const matchingPatterns = getMatchingDomainPatterns(userCode.logEmail, Object.keys(domainRoles))
                    
                    // Collect domain-specific role IDs
                    const domainRoleIds = []
                    for (const pattern of matchingPatterns) {
                        if (domainRoles[pattern]) {
                            domainRoleIds.push(...domainRoles[pattern])
                        }
                    }
                    
                    // Combine and deduplicate all role IDs
                    const allRoleIds = [...new Set([...defaultRoles, ...domainRoleIds])]
                    
                    // Get role objects and filter out invalid ones
                    const rolesToAdd = allRoleIds
                        .map(id => userGuild.roles.cache.get(id))
                        .filter(role => role !== undefined)
                    
                    const roleUnverified = userGuild.roles.cache.find(role => role.id === serverSettings.unverifiedRoleName);

                    // Handle previous user with same email (unverify them)
                    database.getEmailUser(userCode.email, userGuild.id, async (currentUserEmail) => {
                        let member = await userGuild.members.fetch(currentUserEmail.userID).catch(() => null)
                        if (interaction.user.id === currentUserEmail.userID) {
                            // same user, nothing to unverify
                        } else if (member) {
                            try {
                                // Remove all verified roles from previous user
                                for (const role of rolesToAdd) {
                                    await member.roles.remove(role).catch(() => {})
                                }
                                if (roleUnverified) {
                                    await member.roles.add(roleUnverified)
                                }
                            } catch (e) {
                                console.log(e)
                            }
                            try {
                                await member.send("You got unverified on " + userGuild.name + " because somebody else used that email!").catch(() => {})
                            } catch {}
                        }
                    })

                    // Store the first default role in the legacy field for backward compatibility
                    const primaryRoleId = defaultRoles.length > 0 ? defaultRoles[0] : (allRoleIds[0] || '')
                    database.updateEmailUser(new EmailUser(userCode.email, interaction.user.id, userGuild.id, primaryRoleId, 0))

                    // Assign all roles to the verified user
                    const assignedRoleNames = []
                    try {
                        const verifyMember = await userGuild.members.fetch(interaction.user.id)
                        for (const role of rolesToAdd) {
                            await verifyMember.roles.add(role)
                            assignedRoleNames.push(role.name)
                        }
                        if (serverSettings.unverifiedRoleName !== "") {
                            await verifyMember.roles.remove(roleUnverified).catch(() => {})
                        }
                    } catch (e) {
                        // Send generic error to user and detailed error to admin
                        await ErrorNotifier.notify({
                            guild: userGuild,
                            errorTitle: getLocale(serverSettings.language, 'errorRoleAssignTitle'),
                            errorMessage: getLocale(serverSettings.language, 'errorRoleAssignMessage'),
                            user: interaction.user,
                            interaction: interaction,
                            language: serverSettings.language
                        })
                        return
                    }
                    try {
                        if (serverSettings.logChannel !== "") {
                            const rolesText = assignedRoleNames.length > 0 ? ` [${assignedRoleNames.join(', ')}]` : ''
                            userGuild.channels.cache.get(serverSettings.logChannel).send(`✅ <@${interaction.user.id}> → \`${userCode.logEmail}\`${rolesText}`).catch(() => {})
                        }
                    } catch {}
                    const successEmbed = createVerificationSuccessEmbed(serverSettings.language, assignedRoleNames, userGuild.name, userGuild.iconURL({ dynamic: true }))
                    await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral }).catch(() => null)
                    const sent = await interaction.fetchReply().catch(() => null)
                    // Track successful verification (global and per-guild)
                    serverStatsAPI.increaseVerifiedUsers()
                    database.incrementVerifications(userGuild.id)
                    // Delete the code prompt message after successful verification
                    const codePromptId = codePromptMessages.get(interaction.user.id + userGuild.id)
                    if (codePromptId) {
                        codePromptMessages.delete(interaction.user.id + userGuild.id)
                        interaction.webhook.deleteMessage(codePromptId).catch(() => {})
                    }
                    // Remove the success message shortly after showing it
                    setTimeout(() => {
                        try { interaction.deleteReply().catch(() => {}) } catch {}
                        try { if (sent && sent.id) interaction.webhook.deleteMessage(sent.id).catch(() => {}) } catch {}
                    }, 20000)
                    userCodes.delete(interaction.user.id + userGuild.id)
                } else {
                    await interaction.reply({ embeds: [createInvalidCodeEmbed(serverSettings.language)], flags: MessageFlags.Ephemeral }).catch(() => null)
                    const sent = await interaction.fetchReply().catch(() => null)
                    // Delete the code prompt message after any code submission (even if invalid)
                    const codePromptId = codePromptMessages.get(interaction.user.id + userGuild.id)
                    if (codePromptId) {
                        codePromptMessages.delete(interaction.user.id + userGuild.id)
                        interaction.webhook.deleteMessage(codePromptId).catch(() => {})
                    }
                    // Remove the error message shortly after showing it
                    setTimeout(() => {
                        try { interaction.deleteReply().catch(() => {}) } catch {}
                        try { if (sent && sent.id) interaction.webhook.deleteMessage(sent.id).catch(() => {}) } catch {}
                    }, 10000)
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
