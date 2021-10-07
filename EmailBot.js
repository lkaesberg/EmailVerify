const Discord = require('discord.js');
const nodemailer = require('nodemailer');
const smtpTransport = require('nodemailer-smtp-transport');
const {token, clientId, email, password} = require('./config.json');
const {SlashCommandBuilder} = require('@discordjs/builders');
const {REST} = require('@discordjs/rest');
const {Routes} = require('discord-api-types/v9');
const ServerSetting = require('./ServerSetting.js')
const sqlite3 = require('sqlite3').verbose()

const db = new sqlite3.Database('bot.db');
db.run("CREATE TABLE IF NOT EXISTS guilds(guildid INT PRIMARY KEY,domains TEXT,verifiedrole TEXT,unverifiedrole Text, channelid TEXT, messageid TEXT);")

function updateServerSettings(guildID, serverSettings) {
    db.run(
        "INSERT OR REPLACE INTO guilds (guildid, domains, verifiedrole, unverifiedrole, channelid, messageid) VALUES (?, ?, ?, ?, ?, ?)",
        [guildID, serverSettings.domains.toString(), serverSettings.verifiedRoleName, serverSettings.unverifiedRoleName, serverSettings.channelID, serverSettings.messageID])
}

async function loadServerSettings(guildID) {
    const serverSetting = new ServerSetting()
    await db.get("SELECT * FROM guilds WHERE guildid = ?", [guildID], (err, result) => {
            if (err) {
                throw err;
            }
            if (result !== undefined) {
                serverSetting.channelID = result.channelid
                serverSetting.messageID = result.messageid
                serverSetting.verifiedRoleName = result.verifiedrole
                serverSetting.unverifiedRoleName = result.unverifiedrole
                serverSetting.domains = result.domains.split(",")
            }
            serverSettingsMap.set(guildID, serverSetting)
            try {
                bot.channels.cache.get(serverSetting.channelID)?.messages.fetch(serverSetting.messageID)
            } catch {
            }
        }
    )
}

const rest = new REST().setToken(token);

const bot = new Discord.Client({intents: [Discord.Intents.FLAGS.DIRECT_MESSAGES, Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS, Discord.Intents.FLAGS.GUILDS, Discord.Intents.FLAGS.GUILD_MESSAGES]});

const transporter = nodemailer.createTransport(smtpTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    auth: {
        user: email,
        pass: password
    }
}));

const commands = [
    new SlashCommandBuilder().setName('help').setDescription('HELP!'),
    new SlashCommandBuilder().setName('status').setDescription('returns whether the bot is properly configured or not'),
    new SlashCommandBuilder().setName('domains').setDescription('returns registered domains').addStringOption(option => option.setName('domain').setDescription('register given domain')),
    new SlashCommandBuilder().setName('removedomain').setDescription('remove registered domain').addStringOption(option => option.setName('removedomain').setDescription('remove registered domain')),
    new SlashCommandBuilder().setName('channelid').setDescription('returns the channel id').addStringOption(option => option.setName('channelid').setDescription('set channelID in which the message is located')),
    new SlashCommandBuilder().setName('messageid').setDescription('returns the message id').addStringOption(option => option.setName('messageid').setDescription('set messageID of the message to which the user must react to start the verification process')),
    new SlashCommandBuilder().setName('verifiedrole').setDescription('returns the name of the verified role').addStringOption(option => option.setName('verifiedrole').setDescription('set the role name for the verified role')),
    new SlashCommandBuilder().setName('unverifiedrole').setDescription('returns the name of the unverified role').addStringOption(option => option.setName('unverifiedrole').setDescription('set the role name for the unverified role (false -> deactivate unverified role)'))
]

const serverSettingsMap = new Map()

const userGuilds = new Map()

const userCodes = new Map()

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
    if (reaction.message.channel.id === serverSettings.channelID && serverSettings.status) {
        userGuilds.set(user.id, reaction.message.guild)
        await user.send("Please enter your E-Mail address to verify (<name>" + serverSettings.domains.toString().replace(",", "|") + ").")
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
    const serverSetting = serverSettingsMap.get(userGuild.id)
    if (!serverSetting.status) {
        return
    }
    let text = message.content
    if (userCodes.get(message.author.id + userGuilds.get(message.author.id).id) === text) {

        const roleVerified = userGuilds.get(message.author.id).roles.cache.find(role => role.name === serverSetting.verifiedRoleName);
        const roleUnverified = userGuilds.get(message.author.id).roles.cache.find(role => role.name === serverSetting.unverifiedRoleName);
        try {
            await userGuilds.get(message.author.id).members.cache.get(message.author.id).roles.add(roleVerified);
        } catch (e) {
            await message.author.send("Cant find roles. Please contact the admin!")
            return
        }
        try {
            if (serverSetting.unverifiedRoleName !== "") {
                await userGuilds.get(message.author.id).members.cache.get(message.author.id).roles.remove(roleUnverified);
            }
        } catch {
        }
        await message.reply("Added role " + roleVerified.name)
        userCodes.delete(message.author.id)
    } else {
        for (const domain of serverSetting.domains) {
            if (!text.endsWith(domain)) {
                await message.reply("Please enter only valid E-Mail addresses")
                return
            }
        }
        if (text.includes(' ')) {
            await message.reply("Please enter only valid E-Mail addresses")
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

    if (interaction.member.permissions.has("ADMINISTRATOR")) {
        const {commandName} = interaction;

        if (commandName === 'help') {
            await interaction.reply("No Help!");
        } else if (commandName === 'status') {
            const serverSetting = serverSettingsMap.get(interaction.guild.id);
            await interaction.reply("Status: " + serverSetting.status)
        } else if (commandName === 'domains') {
            const domain = interaction.options.getString('domain');
            if (domain == null) {
                await interaction.reply("Allowed domains: " + serverSettingsMap.get(interaction.guild.id).domains.toString())
            } else {
                if (domain.includes("@") && domain.includes(".")) {
                    const serverSetting = serverSettingsMap.get(interaction.guild.id);
                    serverSetting.domains.push(domain)
                    serverSettingsMap.set(interaction.guild.id, serverSetting)
                    await interaction.reply("Added " + domain)
                    updateServerSettings(interaction.guildId, serverSetting)
                } else {
                    await interaction.reply("Please enter a valid domain")
                }

            }
        } else if (commandName === 'removedomain') {
            const removeDomain = interaction.options.getString('removedomain');
            if (removeDomain == null) {
                await interaction.reply("Please enter a domain")
            } else {
                const serverSetting = serverSettingsMap.get(interaction.guild.id);
                serverSetting.domains = serverSetting.domains.filter(function (value) {
                    return value !== removeDomain;
                });
                serverSettingsMap.set(interaction.guild.id, serverSetting)
                await interaction.reply("Removed " + removeDomain)
                updateServerSettings(interaction.guildId, serverSetting)
            }
        } else if (commandName === 'channelid') {
            const channelID = interaction.options.getString('channelid');
            if (channelID == null) {
                await interaction.reply("ChannelID: " + serverSettingsMap.get(interaction.guild.id).channelID)
            } else {
                const serverSetting = serverSettingsMap.get(interaction.guild.id);
                serverSetting.channelID = channelID
                serverSettingsMap.set(interaction.guild.id, serverSetting)
                updateServerSettings(interaction.guildId, serverSetting)
                try {
                    await bot.channels.cache.get(serverSetting.channelID)?.messages.fetch(serverSetting.messageID)
                    await interaction.reply("ChannelID changed to " + channelID)
                } catch (e) {
                    await interaction.reply("ChannelID changed to " + channelID + " (Not valid)")
                }
            }
        } else if (commandName === 'messageid') {
            const messageID = interaction.options.getString('messageid');
            if (messageID == null) {
                await interaction.reply("MessageID: " + serverSettingsMap.get(interaction.guild.id).messageID)
            } else {
                const serverSetting = serverSettingsMap.get(interaction.guild.id);
                serverSetting.messageID = messageID
                serverSettingsMap.set(interaction.guild.id, serverSetting)
                updateServerSettings(interaction.guildId, serverSetting)
                try {
                    await bot.channels.cache.get(serverSetting.channelID)?.messages.fetch(serverSetting.messageID)
                    await interaction.reply("MessageID changed to " + messageID)
                } catch (e) {
                    await interaction.reply("MessageID changed to " + messageID + " (Not valid)")
                }
            }
        } else if (commandName === 'verifiedrole') {
            const verifiedRole = interaction.options.getString('verifiedrole');
            if (verifiedRole == null) {
                await interaction.reply("Verified role: " + serverSettingsMap.get(interaction.guild.id).verifiedRoleName)
            } else {
                const serverSetting = serverSettingsMap.get(interaction.guild.id);
                serverSetting.verifiedRoleName = verifiedRole
                serverSettingsMap.set(interaction.guild.id, serverSetting)
                await interaction.reply("Verified role changed to " + verifiedRole)
                updateServerSettings(interaction.guildId, serverSetting)
            }
        } else if (commandName === 'unverifiedrole') {
            const unverifiedRole = interaction.options.getString('unverifiedrole');
            if (unverifiedRole == null) {
                await interaction.reply("Unverified role: " + serverSettingsMap.get(interaction.guild.id).unverifiedRoleName)
            } else {
                const serverSetting = serverSettingsMap.get(interaction.guild.id);
                if (unverifiedRole === false) {
                    serverSetting.unverifiedRoleName = ""
                } else {
                    serverSetting.unverifiedRoleName = unverifiedRole
                }
                serverSettingsMap.set(interaction.guild.id, serverSetting)
                await interaction.reply("Unverified role changed to " + unverifiedRole)
                updateServerSettings(interaction.guildId, serverSetting)
            }
        }
    }
});

bot.login(token);