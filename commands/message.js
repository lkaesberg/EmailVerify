const {SlashCommandBuilder} = require("@discordjs/builders");
const {serverSettingsMap} = require("../EmailBot");
const database = require("../database/Database.js");
module.exports = {
    data: new SlashCommandBuilder().setName('message').setDescription("write message to react to in channel").addChannelOption(option => option.setName("channel").setRequired(true).setDescription("channel")).addStringOption(option => option.setName("message").setRequired(true).setDescription("message")),
    async execute(interaction) {
        const messageText = interaction.options.getString("message", true)
        const channel = interaction.options.getChannel("channel", true)

        await interaction.deferReply({ephemeral: true})

        const message = await channel.send(messageText)
        await message.react("📝")
        const serverSettings = serverSettingsMap.get(interaction.guild.id);
        serverSettings.channelID = channel.id
        serverSettings.messageID = message.id
        serverSettingsMap.set(interaction.guild.id, serverSettings)
        database.updateServerSettings(interaction.guildId, serverSettings)
        await interaction.editReply({content: 'Message sent', ephemeral: true})
    }
}