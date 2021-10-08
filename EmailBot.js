const Discord = require('discord.js');
const nodemailer = require('nodemailer');
const smtpTransport = require('nodemailer-smtp-transport');
const {token, clientId, email, password} = require('./config.json');
const {REST} = require('@discordjs/rest');
const {Routes} = require('discord-api-types/v9');
const database = require('./database/Database.js')
const fs = require("fs");

const rest = new REST().setToken(token);

const bot = new Discord.Client({intents: [Discord.Intents.FLAGS.DIRECT_MESSAGES, Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS, Discord.Intents.FLAGS.GUILDS, Discord.Intents.FLAGS.GUILD_MESSAGES]});

function loadServerSettings(guildID) {
    database.getServerSettings(guildID, async (serverSettings) => {
        serverSettingsMap.set(guildID, serverSettings)
        try {
            await bot.channels.cache.get(serverSettings.channelID)?.messages.fetch(serverSettings.messageID)
        } catch (e) {
        }
    }).then()
}

const transporter = nodemailer.createTransport(smtpTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    auth: {
        user: email,
        pass: password
    }
}));

module.exports.serverSettingsMap = serverSettingsMap = new Map()

module.exports.userGuilds = userGuilds = new Map()

module.exports.userCodes = userCodes = new Map()

function sendEmail(email, code, name) {
    const mailOptions = {
        from: 'informatik.goettingen@gmail.com',
        to: email,
        subject: name + ' Discord Password',
        text: code
    };

    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    });
}

bot.commands = new Discord.Collection();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
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

    if (!serverSettings.status) {
        await user.send("Bot not properly configured. Please contact admin!").catch(() => {
        })
    }

    if (reaction.message.channel.id === serverSettings.channelID && serverSettings.status) {
        userGuilds.set(user.id, reaction.message.guild)
        await user.send("Please enter your email address to verify (<name>" + serverSettings.domains.toString().replace(",", "|") + ").").catch(() => {
        })
    }
});

bot.on('messageCreate', async (message) => {
    if (message.channel.type !== 'DM' || message.author.id === bot.user.id) {
        return
    }
    const userGuild = userGuilds.get(message.author.id)
    if (userGuild === null) {
        return
    }
    const serverSettings = serverSettingsMap.get(userGuild.id)
    if (!serverSettings.status) {
        return
    }
    let text = message.content
    if (userCodes.get(message.author.id + userGuilds.get(message.author.id).id) === text) {

        const roleVerified = userGuilds.get(message.author.id).roles.cache.find(role => role.name === serverSettings.verifiedRoleName);
        const roleUnverified = userGuilds.get(message.author.id).roles.cache.find(role => role.name === serverSettings.unverifiedRoleName);
        try {
            await userGuilds.get(message.author.id).members.cache.get(message.author.id).roles.add(roleVerified);
        } catch (e) {
            await message.author.send("Cant find roles. Please contact the admin!")
            return
        }
        try {
            if (serverSettings.unverifiedRoleName !== "") {
                await userGuilds.get(message.author.id).members.cache.get(message.author.id).roles.remove(roleUnverified);
            }
        } catch {
        }
        await message.reply("Added role " + roleVerified.name)
        userCodes.delete(message.author.id)
    } else {
        for (const domain of serverSettings.domains) {
            if (!text.endsWith(domain)) {
                await message.reply("Please enter only valid email addresses")
                return
            }
        }
        if (text.includes(' ')) {
            await message.reply("Please enter only valid email addresses")
        } else {
            let code = Math.floor((Math.random() + 1) * 100000).toString()
            userCodes.set(message.author.id + userGuilds.get(message.author.id).id, code)
            sendEmail(text, code, userGuilds.get(message.author.id).name)
            await message.reply("Please enter the code")
        }
    }
});

bot.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = bot.commands.get(interaction.commandName);

    if (!command) return;

    if (interaction.user.id === bot.user.id) return;

    try {
        if (interaction.member.permissions.has("ADMINISTRATOR")) {
            await command.execute(interaction);
        } else {
            await interaction.reply({content: 'You are not allowed to execute this command!', ephemeral: true});
        }
    } catch (error) {
        console.error(error);
        try {
            await interaction.reply({content: 'There was an error while executing this command!', ephemeral: true});
        } catch {
            await interaction.editReply({content: 'There was an error while executing this command!', ephemeral: true});
        }

    }

});

bot.login(token);