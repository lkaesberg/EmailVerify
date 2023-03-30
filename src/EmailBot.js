const Discord = require('discord.js');
const {token, clientId} = require('../config.json');
const database = require('./database/Database.js')
const {stdin, stdout} = require('process')
const rl = require('readline').createInterface(stdin, stdout)
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
const {PermissionsBitField} = require("discord.js");

const bot = new Discord.Client({intents: [Discord.GatewayIntentBits.DirectMessages, Discord.GatewayIntentBits.GuildMessageReactions, Discord.GatewayIntentBits.Guilds, Discord.GatewayIntentBits.GuildMessages, Discord.GatewayIntentBits.GuildMembers]});

const serverStatsAPI = new ServerStatsAPI(bot)

topggAPI(bot)

let emailNotify = false

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
    if (interaction.isButton()) {
        await sendVerifyMessage(interaction.guild, interaction.user, null, null, userGuilds, true)
        interaction.deferUpdate().catch(() => {
            console.log("Can't defer button interaction!")
        })
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

bot.login(token).catch((e) => {
    console.log("Failed to login: " + e.toString())
    process.exitCode = 1;
});
