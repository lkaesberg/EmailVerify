const {SlashCommandBuilder} = require('@discordjs/builders');
const {serverSettingsMap} = require('../EmailBot.js')

module.exports = {
    data: new SlashCommandBuilder().setName('status').setDescription('returns whether the bot is properly configured or not'),
    async execute(interaction) {
        const serverSettings = serverSettingsMap.get(interaction.guild.id);
        let response = "Configuration: " + (serverSettings.status ? "\:white_check_mark:\n" : "\:x: \n");
        response += "ChannelID: " + serverSettings.channelID + "\n"
        response += "MessageID: " + serverSettings.messageID + "\n"
        try {
            await interaction.client.channels.cache.get(serverSettings.channelID)?.messages.fetch(serverSettings.messageID)
            response += "Message Found: \:white_check_mark:\n"
        } catch {
            response += "Message Found: \:x: \n"
        }
        response += "Domains: " + serverSettings.domains.toString().replaceAll(",", "|") + "\n"
        response += "Verified Role: " + serverSettings.verifiedRoleName + "\n"
        response += "Unverified Role: " + serverSettings.unverifiedRoleName + "\n"
        response += "Language: " + serverSettings.language + "\n"
        await interaction.reply({content: response, ephemeral: true})
    }
}