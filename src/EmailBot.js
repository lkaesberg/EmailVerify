const Discord = require('discord.js');
const {token, clientId} = require('../config/config.json');
const database = require('./database/Database.js')
const {stdin, stdout} = require('process')
let shardListEnv = null;
try { shardListEnv = process.env.SHARD_LIST ? JSON.parse(process.env.SHARD_LIST) : null; } catch {}
const isPrimary = !shardListEnv || (Array.isArray(shardListEnv) && shardListEnv.includes(0));
const rl = isPrimary ? require('readline').createInterface(stdin, stdout) : { on: () => {} }
const fs = require("fs");
const {getLocale, defaultLanguage} = require('./Language')
require("./database/ServerSettings");
const ServerStatsAPI = require("./api/ServerStatsAPI");
const topggAPI = require("./api/TopGG")
const MailSender = require("./mail/MailSender")
const messageCreate = require("./bot/messageCreate")
const sendVerifyMessage = require("./bot/sendVerifyMessage")
const rest = require("./api/DiscordRest")
const registerRemoveDomain = require("./bot/registerRemoveDomain")
const {PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle} = require("discord.js");
const UserTimeout = require("./UserTimeout");
const md5hash = require("./crypto/Crypto");
const EmailUser = require("./database/EmailUser");

const bot = new Discord.Client({intents: [Discord.GatewayIntentBits.DirectMessages, Discord.GatewayIntentBits.GuildMessageReactions, Discord.GatewayIntentBits.Guilds, Discord.GatewayIntentBits.GuildMessages, Discord.GatewayIntentBits.GuildMembers]});

const serverStatsAPI = new ServerStatsAPI(bot, isPrimary)

if (!shardListEnv) {
    topggAPI(bot)
}

let emailNotify = true

module.exports.userGuilds = userGuilds = new Map()

const userCodes = new Map()

let userTimeouts = new Map()

const mailSender = new MailSender(userGuilds, serverStatsAPI)

bot.commands = new Discord.Collection();
const commandFiles = fs.readdirSync('./src/commands').filter(file => file.endsWith('.js'));
const commands = []

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    bot.commands.set(command.data.name, command);
    commands.push(command.data.toJSON())
}

function registerCommands(guild, count = 0, total = 0) {
    rest.put(Discord.Routes.applicationGuildCommands(clientId, guild.id), {body: commands})
        .then(() => console.log(`Successfully registered application commands for ${guild.name}: ${count}/${total}`))
        .catch(async () => {
            const errorChannel = guild.channels.cache.find(channel => channel.type === 'GUILD_TEXT' && channel.permissionsFor(bot.user).has('SEND_MESSAGES'))
            if (errorChannel) {
                try {
                    await errorChannel.send("No permissions to create Commands. Please visit: https://emailbot.larskaesberg.de/")
                } catch (e) {

                }
            }
            await bot.guilds.cache.get(guild.id).leave()
        });
}

bot.once('ready', async () => {
    let guilds = await bot.guilds.cache
    let counter = 0
    guilds.forEach((guild) => {
        counter += 1
        registerCommands(guild, counter, guilds.size)
        registerRemoveDomain(guild.id)
        database.getServerSettings(guild.id, async serverSettings => {
            try {
                await bot.guilds.cache.get(guild.id).channels.cache.get(serverSettings.channelID).messages.fetch(serverSettings.messageID)
            } catch (e) {

            }

        })
    })
    bot.user.setActivity("/verify | Website", {
        type: "PLAYING", url: "https://emailbot.larskaesberg.de"
    })
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
    console.log(guild.name)
    registerCommands(guild)
})

bot.on("messageCreate", async (message) => {
        await messageCreate(message, bot, userGuilds, userCodes, userTimeouts, mailSender, emailNotify)
    }
)

bot.on('messageReactionAdd', async (reaction, user) => {
    await sendVerifyMessage(reaction.message.guild, user, reaction.message.channel.id, reaction.message.id, userGuilds)
});

bot.on('interactionCreate', async interaction => {
    // Button: open email modal or open code modal
    if (interaction.isButton()) {
        if (interaction.customId === 'verifyButton') {
            const guild = interaction.guild || userGuilds.get(interaction.user.id)
            if (!guild) {
                await interaction.reply({ content: 'Not linked to a guild. Try again using the button in the server.', ephemeral: true }).catch(() => {})
                return
            }
            userGuilds.set(interaction.user.id, guild)
            // Start with ephemeral message containing instructions and an action button
            await database.getServerSettings(guild.id, async serverSettings => {
                const domainsText = serverSettings.domains.toString().replaceAll(",", "|").replaceAll("*", "*")
                let instruction = serverSettings.verifyMessage !== "" ? serverSettings.verifyMessage : getLocale(serverSettings.language, "userEnterEmail", "(<name>" + domainsText + ")")
                if (serverSettings.logChannel !== "") {
                    instruction += " Caution: The admin can see the used email address"
                }
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('openEmailModal').setLabel('Enter Email').setStyle(ButtonStyle.Primary)
                )
                await interaction.reply({ content: instruction, components: [row], ephemeral: true }).catch(() => {})
                setTimeout(() => {
                    interaction.deleteReply().catch(() => {})
                }, 300000)
            })
            return
        }
        if (interaction.customId === 'openEmailModal') {
            const guild = interaction.guild || userGuilds.get(interaction.user.id)
            if (!guild) {
                await interaction.reply({ content: 'Not linked to a guild. Try again using the button in the server.', ephemeral: true }).catch(() => {})
                return
            }
            userGuilds.set(interaction.user.id, guild)
            await database.getServerSettings(guild.id, async serverSettings => {
                const domainsText = serverSettings.domains.toString().replaceAll(",", "|").replaceAll("*", "*")
                let instruction = serverSettings.verifyMessage !== "" ? serverSettings.verifyMessage : getLocale(serverSettings.language, "userEnterEmail", "(<name>" + domainsText + ")")
                if (serverSettings.logChannel !== "") {
                    instruction += " Caution: The admin can see the used email address"
                }
                const modal = new ModalBuilder().setCustomId('emailModal').setTitle('Email Verification')
                const emailInput = new TextInputBuilder()
                    .setCustomId('emailInput')
                    .setLabel('Enter your email address')
                    .setPlaceholder(instruction.substring(0, 100))
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                const emailRow = new ActionRowBuilder().addComponents(emailInput)
                modal.addComponents(emailRow)
                await interaction.showModal(modal).catch(() => {})
            })
            return
        }
        if (interaction.customId === 'openCodeModal') {
            // Open code modal, include instruction with email
            const userGuild = interaction.guild
            const key = interaction.user.id + userGuild.id
            const userCode = userCodes.get(key)
            await database.getServerSettings(userGuild.id, async serverSettings => {
                const modal = new ModalBuilder().setCustomId('codeModal').setTitle('Enter Verification Code')
                let placeholder = 'Enter the 6-digit code'
                if (userCode && userCode.logEmail) {
                    placeholder = getLocale(serverSettings.language, 'mailPositive', userCode.logEmail).substring(0, 100)
                }
                const codeInput = new TextInputBuilder()
                    .setCustomId('codeInput')
                    .setLabel('Verification code')
                    .setPlaceholder(placeholder)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                const firstActionRow = new ActionRowBuilder().addComponents(codeInput)
                modal.addComponents(firstActionRow)
                await interaction.showModal(modal).catch(() => {})
            })
            return
        }
        return
    }

    // Modal submissions
    if (interaction.isModalSubmit()) {
        // Email modal submit
        if (interaction.customId === 'emailModal') {
            await interaction.deferReply({ ephemeral: true }).catch(() => {})
            const emailText = interaction.fields.getTextInputValue('emailInput').trim()
            const userGuild = userGuilds.get(interaction.user.id)
            if (!userGuild) {
                await interaction.followUp({ content: 'Not linked to a guild. Try again using the button in the server.', ephemeral: true }).catch(() => {})
                return
            }
            await database.getServerSettings(userGuild.id, async serverSettings => {
                if (!serverSettings.status) {
                    await interaction.followUp({ content: getLocale(serverSettings.language, "userBotError"), ephemeral: true }).catch(() => {})
                    return
                }
                // Blacklist
                if (serverSettings.blacklist.some((element) => emailText.includes(element))) {
                    await interaction.followUp({ content: getLocale(serverSettings.language, "mailBlacklisted"), ephemeral: true }).catch(() => {})
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
                    await interaction.followUp({ content: getLocale(serverSettings.language, "mailInvalid"), ephemeral: true }).catch(() => {})
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
                    await interaction.followUp({ content: getLocale(serverSettings.language, "mailTimeout", (timeoutMs / 1000).toFixed(2)), ephemeral: true }).catch(() => {})
                    return
                }
                userTimeout.timestamp = Date.now()
                userTimeout.increaseWaitTime()

                const code = Math.floor((Math.random() + 1) * 100000).toString()
                // Send email and store code on success
                // suppressReply to reduce chat noise; we'll present the code modal button separately
                await mailSender.sendEmail(emailText.toLowerCase(), code, userGuild.name, interaction, emailNotify, (email) => {
                    userCodes.set(interaction.user.id + userGuild.id, {
                        code: code,
                        email: md5hash(email),
                        logEmail: email
                    })
                }, { suppressReply: true })

                // Provide a minimal ephemeral message including original info and a button to open the code modal
                const infoText = getLocale(serverSettings.language, 'mailPositive', emailText.toLowerCase())
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('openCodeModal').setLabel('Enter Code').setStyle(ButtonStyle.Success)
                )
                const follow = await interaction.followUp({ content: infoText, components: [row], ephemeral: true }).catch(() => null)
                if (follow && follow.id) {
                    setTimeout(() => {
                        interaction.webhook.deleteMessage(follow.id).catch(() => {})
                    }, 300000)
                }
            })
            return
        }
        // Code modal submit
        if (interaction.customId === 'codeModal') {
            const codeText = interaction.fields.getTextInputValue('codeInput').trim()
            const userGuild = userGuilds.get(interaction.user.id)
            if (!userGuild) {
                await interaction.reply({ content: 'Not linked to a guild. Try again using the button in the server.', ephemeral: true }).catch(() => {})
                return
            }
            await database.getServerSettings(userGuild.id, async serverSettings => {
                if (!serverSettings.status) {
                    await interaction.reply({ content: getLocale(serverSettings.language, "userBotError"), ephemeral: true }).catch(() => {})
                    return
                }
                const userCode = userCodes.get(interaction.user.id + userGuild.id)
                if (userCode && userCode.code === codeText) {
                    // Success: assign roles and update DB
                    const roleVerified = userGuild.roles.cache.find(role => role.id === serverSettings.verifiedRoleName);
                    const roleUnverified = userGuild.roles.cache.find(role => role.id === serverSettings.unverifiedRoleName);

                    database.getEmailUser(userCode.email, userGuild.id, async (currentUserEmail) => {
                        let member = await interaction.guild.members.fetch(currentUserEmail.userID).catch(() => null)
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
                        await interaction.reply({ content: getLocale(serverSettings.language, "userCantFindRole"), ephemeral: true }).catch(() => {})
                        return
                    }
                    try {
                        if (serverSettings.logChannel !== "") {
                            userGuild.channels.cache.get(serverSettings.logChannel).send(`Authorized: <@${interaction.user.id}>\t →\t ${userCode.logEmail}`).catch(() => {})
                        }
                    } catch {}
                    await interaction.reply({ content: getLocale(serverSettings.language, "roleAdded", roleVerified.name), ephemeral: true }).catch(() => {})
                    userCodes.delete(interaction.user.id + userGuild.id)
                } else {
                    await interaction.reply({ content: 'Invalid code. Please try again.', ephemeral: true }).catch(() => {})
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
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error(error);
            try {
                await interaction.reply({
                    content: getLocale(language, "commandFailed"),
                    ephemeral: true
                });
            } catch {
                try {
                    await interaction.editReply({
                        content: getLocale(language, "commandFailed"),
                        ephemeral: true
                    });
                } catch {
                    console.log("ERROR: Can't reply")
                }
            }

        }
    })
});

if (isPrimary) rl.on("line", async command => {
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

bot.login(token).catch((e) => {
    console.log("Failed to login: " + e.toString())
    process.exitCode = 1;
});
