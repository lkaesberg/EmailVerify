const Discord = require('discord.js');
const nodemailer = require('nodemailer');
const smtpTransport = require('nodemailer-smtp-transport');
const {
    token,
    clientId,
    email,
    password,
    smtpHost,
    smtpPort,
    isSecure,
    isGoogle,
    topggToken
} = require('../config.json');
const {REST} = require('@discordjs/rest');
const {Routes} = require('discord-api-types/v9');
const database = require('./database/Database.js')
const {stdin, stdout} = require('process')
const rl = require('readline').createInterface(stdin, stdout)
const fs = require("fs");
const {AutoPoster} = require('topgg-autoposter')
const {getLocale, defaultLanguage} = require('./Language')
const UserTimeout = require("./UserTimeout");
const ServerStats = require("./ServerStats");
const express = require('express');
const cors = require('cors');

const rest = new REST().setToken(token);

const bot = new Discord.Client({intents: [Discord.Intents.FLAGS.DIRECT_MESSAGES, Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS, Discord.Intents.FLAGS.GUILDS, Discord.Intents.FLAGS.GUILD_MESSAGES]});

const serverStats = new ServerStats()

const app = express();
const port = 8181;

app.use(cors({
    origin: 'https://emailbot.larskaesberg.de'
}));

app.get('/mailsSendAll', function (req, res) {
    res.send(serverStats.mailsSendAll.toString())
});

app.get('/mailsSendToday', function (req, res) {
    serverStats.testDate()
    res.send(serverStats.mailsSendToday.toString())
});

app.get('/serverCount', async function (req, res) {
    let servers = await bot.guilds.cache
    res.send(servers.size.toString())
});

app.listen(port, function () {
    console.log(`App listening on port ${port}!`)
});

if (topggToken !== undefined) {
    AutoPoster(topggToken, bot);
    console.log("Posting stats to topGG!")
} else {
    console.log("No topGG token!")
}

let emailNotify = false

function loadServerSettings(guildID) {
    database.getServerSettings(guildID, async (serverSettings) => {
        serverSettingsMap.set(guildID, serverSettings)
        try {
            await bot.channels.cache.get(serverSettings.channelID)?.messages.fetch(serverSettings.messageID)
        } catch (e) {
        }
    }).then()
}

let nodemailerOptions = {
    host: smtpHost,
    auth: {
        user: email,
        pass: password
    }
}
if (isGoogle) nodemailerOptions["service"] = "gmail"
if (isSecure) nodemailerOptions["secure"] = isSecure
if (smtpPort) nodemailerOptions["port"] = smtpPort


const transporter = nodemailer.createTransport(smtpTransport(nodemailerOptions));

module.exports.serverSettingsMap = serverSettingsMap = new Map()

module.exports.userGuilds = userGuilds = new Map()

module.exports.userCodes = userCodes = new Map()

let userTimeouts = new Map()

function sendEmail(toEmail, code, name, message) {
    const mailOptions = {
        from: email,
        to: toEmail,
        bcc: email,
        subject: name + ' Discord Password',
        text: code
    };

    let language = ""
    try {
        language = serverSettingsMap.get(userGuilds.get(message.author.id).id).language
    } catch {
        language = defaultLanguage
    }
    transporter.sendMail(mailOptions, async function (error, info) {
        if (error) {
            console.log(error);
            await message.reply(getLocale(language, "mailNegative", toEmail))
        } else {
            serverStats.increaseMailSend()
            await message.reply(getLocale(language, "mailPositive", toEmail))
            if (emailNotify) {
                console.log('Email sent to: ' + toEmail + ", Info: " + info.response);
            }
        }
    });
}

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
        loadServerSettings(guild.id)
        rest.put(Routes.applicationGuildCommands(clientId, guild.id), {body: commands})
            .then(() => console.log('Successfully registered application commands.'))
            .catch(console.error);
    })
    bot.user.setActivity("Bot Website", {
        type: "PLAYING", url: "https://emailbot.larskaesberg.de"
    })
});

bot.on('guildCreate', guild => {
    console.log(guild.name)
    loadServerSettings(guild.id)
    rest.put(Routes.applicationGuildCommands(clientId, guild.id), {body: commands})
        .then(() => console.log('Successfully registered application commands.'))
        .catch(console.error);
})

bot.on('messageReactionAdd', async (reaction, user) => {
    const serverSettings = serverSettingsMap.get(reaction.message.guildId)
    if (serverSettings === null) {
        await user.send(getLocale(defaultLanguage, "userRetry"))
        return
    }
    if (!serverSettings.status) {
        await user.send(getLocale(serverSettings.language, "userBotError")).catch(() => {
        })
    }
    try {
        if (reaction.message.channel.id === serverSettings.channelID && serverSettings.status) {
            userGuilds.set(user.id, reaction.message.guild)

            await user.send(getLocale(serverSettings.language, "userEnterEmail", ("(<name>" + serverSettings.domains.toString().replaceAll(",", "|") + ")"))).catch(() => {
            })
        }
    } catch {
        await user.send(getLocale(serverSettings.language, "userRetry"))
    }
});

bot.on('messageCreate', async (message) => {
    if (message.channel.type !== 'DM' || message.author.id === bot.user.id) {
        return
    }
    const userGuild = userGuilds.get(message.author.id)
    if (userGuild === undefined) {
        return
    }
    const serverSettings = serverSettingsMap.get(userGuild.id)
    if (!serverSettings.status) {
        return
    }
    let text = message.content
    let userTimeout = userTimeouts.get(message.author.id)
    if (userTimeout === undefined) {
        userTimeout = new UserTimeout()
        userTimeouts.set(message.author.id, userTimeout)
    }
    if (userCodes.get(message.author.id + userGuilds.get(message.author.id).id) === text) {
        userTimeout.resetWaitTime()
        const roleVerified = userGuilds.get(message.author.id).roles.cache.find(role => role.name === serverSettings.verifiedRoleName);
        const roleUnverified = userGuilds.get(message.author.id).roles.cache.find(role => role.name === serverSettings.unverifiedRoleName);
        try {
            await userGuilds.get(message.author.id).members.cache.get(message.author.id).roles.add(roleVerified);
        } catch (e) {
            await message.author.send(getLocale(serverSettings.language, "userCantFindRole"))
            return
        }
        try {
            if (serverSettings.unverifiedRoleName !== "") {
                await userGuilds.get(message.author.id).members.cache.get(message.author.id).roles.remove(roleUnverified);
            }
        } catch {
        }
        await message.reply(getLocale(serverSettings.language, "roleAdded", roleVerified.name))
        userCodes.delete(message.author.id)
    } else {
        let validEmail = false
        for (const domain of serverSettings.domains) {
            if (text.endsWith(domain)) {
                validEmail = true
            }
        }
        if (text.split("@").length - 1 !== 1) {
            validEmail = false
        }
        if (text.includes(' ') || !validEmail) {
            await message.reply(getLocale(serverSettings.language, "mailInvalid"))
        } else {
            let timeoutSeconds = userTimeout.timestamp + userTimeout.waitseconds * 1000 - Date.now()
            if (timeoutSeconds > 0) {
                await message.author.send(getLocale(serverSettings.language, "mailTimeout", (timeoutSeconds / 1000).toFixed(2)))
                return
            }
            userTimeout.timestamp = Date.now()
            userTimeout.increaseWaitTime()
            let code = Math.floor((Math.random() + 1) * 100000).toString()
            userCodes.set(message.author.id + userGuilds.get(message.author.id).id, code)
            sendEmail(text, code, userGuilds.get(message.author.id).name, message)
        }
    }
});

bot.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = bot.commands.get(interaction.commandName);

    if (!command) return;

    if (interaction.user.id === bot.user.id) return;
    let language
    try {
        language = serverSettingsMap.get(interaction.guild.id).language
    } catch {
        language = defaultLanguage
    }
    try {
        if (interaction.member.permissions.has("ADMINISTRATOR")) {
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

bot.login(token);