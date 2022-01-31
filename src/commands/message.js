const {SlashCommandBuilder} = require("@discordjs/builders");
const {serverSettingsMap} = require("../EmailBot");
const database = require("../database/Database.js");
const ServerSettings = require("../database/ServerSettings");
module.exports = {
    data: new SlashCommandBuilder().setName('message').setDescription("write message to react to in channel").addChannelOption(option => option.setName("channel").setRequired(true).setDescription("channel")).addStringOption(option => option.setName("message").setRequired(true).setDescription("message")),
    async execute(interaction) {
        const messageText = interaction.options.getString("message", true)
        const channel = interaction.options.getChannel("channel", true)

        await interaction.deferReply({ephemeral: true})

        const message = await channel.send({content: messageText}).catch(async _ => {
            await interaction.user.send("No permissions to write in that channel!")
        })
        if (message === undefined) {
            return
        }
        await message.react("📝").catch(async _ => {
            await interaction.user.send("No permissions to add reactions in that channel!")
        })
        let serverSettings = serverSettingsMap.get(interaction.guildId);
        if (serverSettings === undefined) {
            serverSettings = new ServerSettings()
            serverSettingsMap.set(interaction.guildId, serverSettings)
        }
        serverSettings.channelID = channel.id
        serverSettings.messageID = message.id
        serverSettingsMap.set(interaction.guild.id, serverSettings)
        database.updateServerSettings(interaction.guildId, serverSettings)
        await interaction.editReply({content: 'Message sent', ephemeral: true})
    }
}