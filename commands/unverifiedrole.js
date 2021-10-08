const database = require("../database/Database.js");
const {SlashCommandBuilder} = require("@discordjs/builders");
const {serverSettingsMap} = require("../EmailBot");
module.exports = {
    data: new SlashCommandBuilder().setName('unverifiedrole').setDescription('returns the name of the unverified role')
        .addRoleOption(option => option.setName('unverifiedrole').setDescription('set the role name for the unverified role (false -> deactivate unverified role)')),
    async execute(interaction) {
        const unverifiedRole = interaction.options.getRole('unverifiedrole');
        if (unverifiedRole == null) {
            await interaction.reply("Unverified role: " + serverSettingsMap.get(interaction.guild.id).unverifiedRoleName)
        } else {
            const serverSettings = serverSettingsMap.get(interaction.guild.id);
            if (unverifiedRole.name === serverSettings.unverifiedRoleName) {
                serverSettings.unverifiedRoleName = ""
                await interaction.reply("Unverified role deactivated")
            } else {
                serverSettings.unverifiedRoleName = unverifiedRole.name
                await interaction.reply("Unverified role changed to " + unverifiedRole.name)
            }
            serverSettingsMap.set(interaction.guild.id, serverSettings)

            database.updateServerSettings(interaction.guildId, serverSettings)
        }
    }
}