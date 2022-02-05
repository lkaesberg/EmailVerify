const Discord = require('discord.js');
const {token, clientId} = require('../config.json');
const {REST} = require('@discordjs/rest');
const {Routes} = require('discord-api-types/v9');
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

const rest = new REST().setToken(token);

const bot = new Discord.Client({intents: [Discord.Intents.FLAGS.DIRECT_MESSAGES, Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS, Discord.Intents.FLAGS.GUILDS, Discord.Intents.FLAGS.GUILD_MESSAGES]});

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

bot.once('ready', async () => {
    (await bot.guilds.fetch()).forEach(guild => {
        console.log(guild.name)
        rest.put(Routes.applicationGuildCommands(clientId, guild.id), {body: commands})
            .then(() => console.log('Successfully registered application commands.'))
            .catch(console.error);
    })
    bot.user.setActivity("Bot Website", {
        type: "PLAYING", url: "https://emailbot.larskaesberg.de"
    })
});

bot.on("guildDelete", guild => {
    console.log("Removed: " + guild.name)
    database.deleteServerData(guild.id)
})

bot.on('guildCreate', guild => {
    console.log(guild.name)
    rest.put(Routes.applicationGuildCommands(clientId, guild.id), {body: commands})
        .then(() => console.log('Successfully registered application commands.'))
        .catch(console.error);
})

bot.on("messageCreate", async (message) => {
        await messageCreate(message, bot, userGuilds, userCodes, userTimeouts, mailSender, emailNotify)
    }
)

bot.on('messageReactionAdd', async (reaction, user) => {
    await database.getServerSettings(reaction.message.guildId, (async serverSettings => {
        if (!serverSettings.status) {
            await user.send(getLocale(serverSettings.language, "userBotError")).catch(() => {
            })
            return
        }
        try {
            if (reaction.message.channel.id === serverSettings.channelID && reaction.message.id === serverSettings.messageID && serverSettings.status) {
                userGuilds.set(user.id, reaction.message.guild)

                await user.send(getLocale(serverSettings.language, "userEnterEmail", ("(<name>" + serverSettings.domains.toString().replaceAll(",", "|") + ")"))).catch(() => {
                })
            }
        } catch {
            await user.send(getLocale(serverSettings.language, "userRetry"))
        }
    }))
});

bot.on('interactionCreate', async interaction => {
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
            if (interaction.member.permissions.has("ADMINISTRATOR") || interaction.commandName === "delete_user_data") {
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
});