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
const messageCreate = require("./bot/messageCreate")
const sendVerifyMessage = require("./bot/sendVerifyMessage")
const {showEmailModal} = require("./bot/showEmailModal")
const rest = require("./api/DiscordRest")
const registerRemoveDomain = require("./bot/registerRemoveDomain")
const {PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, TextDisplayBuilder} = require("discord.js");
const UserTimeout = require("./UserTimeout");
const md5hash = require("./crypto/Crypto");
const EmailUser = require("./database/EmailUser");
const { MessageFlags } = require('discord.js');

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

const mailSender = new MailSender(userGuilds, serverStatsAPI)

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
            try {
                const errorChannel = guild.channels.cache.find(channel =>
                    channel.type === 'GUILD_TEXT' &&
                    channel.permissionsFor(bot.user).has('SEND_MESSAGES')
                );

                if (errorChannel) {
                    await errorChannel.send(
                        'No permissions to create Commands. Please visit: ' +
                        'https://emailbot.larskaesberg.de/'
                    );
                }
            } catch (e) {
                console.error(
                    `Failed to send error message in ${guild.name} before leaving:`,
                    e
                );
            }

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
                    const errorChannel = member.guild.channels.cache.find(channel => channel.type === 'GUILD_TEXT' && channel.permissionsFor(bot.user).has('SEND_MESSAGES'))
                    if (errorChannel) {
                        try {
                            await errorChannel.send("Cant add unverified role to new member. Help: Ensure that the bot role is higher in the serversettings role menu then the verified and unverified role.")
                        } catch (e) {

                        }
                    }
                }

            }
        }
        if (serverSettings.autoVerify) {
            await sendVerifyMessage(member.guild, member.user, null, null, userGuilds, true)
        }
    })
})

bot.on('guildCreate', guild => {
    console.log(`[Shard ${bot.shard?.ids ?? 'N/A'}] New guild: ${guild.name}`)
    registerCommands(guild)
})

bot.on("messageCreate", async (message) => {
        await messageCreate(message, bot, userGuilds, userCodes, userTimeouts, mailSender, emailNotify)
    }
)

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
                await interaction.reply({ content: 'Not linked to a guild. Try again using the button in the server.', flags: MessageFlags.Ephemeral }).catch(() => {})
                return
            }
            const key = interaction.user.id + userGuild.id
            const userCode = userCodes.get(key)
            await database.getServerSettings(userGuild.id, async serverSettings => {
                const modal = new ModalBuilder().setCustomId('codeModal').setTitle('Enter Verification Code')
                let description = '-# Check your inbox for a 6-digit code'
                if (userCode && userCode.logEmail) {
                    description = getLocale(serverSettings.language, 'mailPositive', userCode.logEmail)
                }
                const codeInput = new TextInputBuilder()
                    .setCustomId('codeInput')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('123456')
                    .setMinLength(6)
                    .setMaxLength(6)
                    .setRequired(true)
                const codeLabel = new LabelBuilder()
                    .setLabel('Verification code')
                    .setTextInputComponent(codeInput)
                const instructionText = new TextDisplayBuilder().setContent(description)
                modal.addTextDisplayComponents(instructionText).addLabelComponents(codeLabel)
                // Show code modal
                await interaction.showModal(modal).catch(() => {})
                // After opening the code modal, delete the preceding ephemeral code prompt (the one with the button)
                setTimeout(() => {
                    try {
                        if (interaction.message && interaction.message.id) {
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
                await interaction.followUp({ content: 'Not linked to a guild. Try again using the button in the server.', flags: MessageFlags.Ephemeral }).catch(() => {})
                return
            }
            await database.getServerSettings(userGuild.id, async serverSettings => {
                if (!serverSettings.status) {
                    await interaction.followUp({ content: getLocale(serverSettings.language, "userBotError"), flags: MessageFlags.Ephemeral }).catch(() => {})
                    return
                }
                // Blacklist
                if (serverSettings.blacklist.some((element) => emailText.includes(element))) {
                    await interaction.followUp({ content: getLocale(serverSettings.language, "mailBlacklisted"), flags: MessageFlags.Ephemeral }).catch(() => {})
                    return
                }
                // Domain allowlist
                let validEmail = false
                for (const domain of serverSettings.domains) {
                    const regex = new RegExp(domain.replace(/\./g, "\\.").replace(/\*/g, ".+").concat("$"))
                    if (regex.test(emailText)) {
                        validEmail = true
                    }
                }
                if (emailText.split("@").length - 1 !== 1) {
                    validEmail = false
                }
                if (emailText.includes(' ') || !validEmail) {
                    await interaction.followUp({ content: getLocale(serverSettings.language, "mailInvalid"), flags: MessageFlags.Ephemeral }).catch(() => {})
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
                    await interaction.followUp({ content: getLocale(serverSettings.language, "mailTimeout", (timeoutMs / 1000).toFixed(2)), flags: MessageFlags.Ephemeral }).catch(() => {})
                    return
                }
                userTimeout.timestamp = Date.now()
                userTimeout.increaseWaitTime()

                const code = Math.floor((Math.random() + 1) * 100000).toString()
                // Send email and store code on success
                // suppressReply to reduce chat noise; we'll present the code modal button separately on success
                await mailSender.sendEmail(emailText.toLowerCase(), code, userGuild.name, interaction, emailNotify, async (email) => {
                    userCodes.set(interaction.user.id + userGuild.id, {
                        code: code,
                        email: md5hash(email),
                        logEmail: email
                    })

                    // Only show the code prompt if email was successfully sent
                    const infoText = getLocale(serverSettings.language, 'mailPositive', emailText.toLowerCase())
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('openCodeModal').setLabel('Enter Code').setStyle(ButtonStyle.Success)
                    )
                    // Delete the initial verify prompt ("Enter Email") once email has been submitted
                    const prevVerifyPromptId = verifyPromptMessages.get(interaction.user.id)
                    if (prevVerifyPromptId) {
                        verifyPromptMessages.delete(interaction.user.id)
                        // Try both deletion methods for reliability with ephemeral messages
                        interaction.webhook.deleteMessage(prevVerifyPromptId).catch(() => {})
                    }

                    await interaction.followUp({ content: infoText, components: [row], flags: MessageFlags.Ephemeral }).catch(() => null)
                    const follow = await interaction.fetchReply().catch(() => null)
                    if (follow && follow.id) {
                        // Track the code prompt so we can delete it after code submission
                        codePromptMessages.set(interaction.user.id + userGuild.id, follow.id)
                        setTimeout(() => {
                            interaction.webhook.deleteMessage(follow.id).catch(() => {})
                        }, 300000)
                    }
                }, { suppressReply: true })
            })
            return
        }
        // Code modal submit
        if (interaction.customId === 'codeModal') {
            const codeText = interaction.fields.getTextInputValue('codeInput').trim()
            const userGuild = userGuilds.get(interaction.user.id)
            if (!userGuild) {
                await interaction.reply({ content: 'Not linked to a guild. Try again using the button in the server.', flags: MessageFlags.Ephemeral }).catch(() => null)
                const sent = await interaction.fetchReply().catch(() => null)
                setTimeout(() => {
                    try { interaction.deleteReply().catch(() => {}) } catch {}
                    try { if (sent && sent.id) interaction.webhook.deleteMessage(sent.id).catch(() => {}) } catch {}
                }, 2500)
                return
            }
            await database.getServerSettings(userGuild.id, async serverSettings => {
                if (!serverSettings.status) {
                    await interaction.reply({ content: getLocale(serverSettings.language, "userBotError"), flags: MessageFlags.Ephemeral }).catch(() => null)
                    const sent = await interaction.fetchReply().catch(() => null)
                    setTimeout(() => {
                        try { interaction.deleteReply().catch(() => {}) } catch {}
                        try { if (sent && sent.id) interaction.webhook.deleteMessage(sent.id).catch(() => {}) } catch {}
                    }, 2500)
                    return
                }
                const userCode = userCodes.get(interaction.user.id + userGuild.id)
                if (userCode && userCode.code === codeText) {
                    // Success: assign roles and update DB
                    const roleVerified = userGuild.roles.cache.find(role => role.id === serverSettings.verifiedRoleName);
                    const roleUnverified = userGuild.roles.cache.find(role => role.id === serverSettings.unverifiedRoleName);

                    database.getEmailUser(userCode.email, userGuild.id, async (currentUserEmail) => {
                        let member = await userGuild.members.fetch(currentUserEmail.userID).catch(() => null)
                        if (interaction.user.id === currentUserEmail.userID) {
                            // same user, nothing to unverify
                        } else if (member) {
                            try {
                                await member.roles.remove(roleVerified)
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

                    database.updateEmailUser(new EmailUser(userCode.email, interaction.user.id, userGuild.id, serverSettings.verifiedRoleName, 0))

                    try {
                        const verifyMember = await userGuild.members.fetch(interaction.user.id)
                        await verifyMember.roles.add(roleVerified)
                        if (serverSettings.unverifiedRoleName !== "") {
                            await verifyMember.roles.remove(roleUnverified).catch(() => {})
                        }
                    } catch (e) {
                        await interaction.reply({ content: getLocale(serverSettings.language, "userCantFindRole"), flags: MessageFlags.Ephemeral }).catch(() => {})
                        return
                    }
                    try {
                        if (serverSettings.logChannel !== "") {
                            userGuild.channels.cache.get(serverSettings.logChannel).send(`Authorized: <@${interaction.user.id}>\t →\t ${userCode.logEmail}`).catch(() => {})
                        }
                    } catch {}
                    await interaction.reply({ content: getLocale(serverSettings.language, "roleAdded", roleVerified.name), flags: MessageFlags.Ephemeral }).catch(() => null)
                    const sent = await interaction.fetchReply().catch(() => null)
                    // Track successful verification
                    serverStatsAPI.increaseVerifiedUsers()
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
                    }, 2500)
                    userCodes.delete(interaction.user.id + userGuild.id)
                } else {
                    await interaction.reply({ content: 'Invalid code. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => null)
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
                    }, 2500)
                }
            })
            return
        }
        return
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
            if (interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) || interaction.commandName === "delete_user_data" || interaction.commandName === "verify") {
                await command.execute(interaction);
            } else {
                await interaction.reply({
                    content: getLocale(language, "invalidPermissions"),
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (error) {
            console.error(error);
            try {
                await interaction.reply({
                    content: getLocale(language, "commandFailed"),
                    flags: MessageFlags.Ephemeral
                });
            } catch {
                try {
                    await interaction.editReply({
                        content: getLocale(language, "commandFailed"),
                        flags: MessageFlags.Ephemeral
                    });
                } catch {
                    console.log("ERROR: Can't reply")
                }
            }

        }
    })
});

// CLI listener is initialized in ready() only on primary shard

bot.login(token).catch((e) => {
    console.log("Failed to login: " + e.toString())
    process.exitCode = 1;
});
