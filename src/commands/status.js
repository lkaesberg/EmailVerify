const {SlashCommandBuilder} = require('@discordjs/builders');
const database = require("../database/Database");

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('status').setDescription('returns whether the bot is properly configured or not').setDefaultMemberPermissions(0),
    async execute(interaction) {
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            let response = "Configuration: " + (serverSettings.status ? "\:white_check_mark:\n" : "\:x: \n");
            response += "ChannelID: " + serverSettings.channelID + "\n"
            response += "MessageID: " + serverSettings.messageID + "\n"
            try {
                await interaction.client.channels.cache.get(serverSettings.channelID)?.messages.fetch(serverSettings.messageID)
                response += "Message Found: \:white_check_mark:\n"
            } catch {
                response += "Message Found: \:x: \n"
            }
            response += "Domains: " + serverSettings.domains.toString().replaceAll(",", "|").replaceAll("*", "\\*") + "\n"
            response += "Blacklisted: " + serverSettings.blacklist.toString().replaceAll(",", "|") + "\n"
            let roleVerified = interaction.guild.roles.cache.find(r => r.id === serverSettings.verifiedRoleName)
            if (roleVerified === undefined) {
                response += "Verified role can not be found!\n"
            } else {
                response += "Verified role: " + roleVerified.name + "\n"
            }
            let roleUnverified = interaction.guild.roles.cache.find(r => r.id === serverSettings.unverifiedRoleName)
            if (roleUnverified === undefined) {
                response += "Unverified role is disabled\n"
            } else {
                response += "Unverified role: " + roleUnverified.name + "\n"
            }
            response += "Verify message: " + (serverSettings.verifyMessage ? serverSettings.verifyMessage : "Default") + "\n"
            response += "Language: " + serverSettings.language + "\n"
            response += "Auto add unverified role: " + (serverSettings.autoAddUnverified ? "Enabled" : "Disabled") + "\n"
            response += "Auto verify: " + (serverSettings.autoVerify ? "Enabled" : "Disabled") + "\n"
            await interaction.reply({content: response, ephemeral: true})
        })
    }
}
