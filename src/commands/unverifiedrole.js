const database = require("../database/Database.js");
const {SlashCommandBuilder} = require("@discordjs/builders");
const {serverSettingsMap} = require("../EmailBot");
module.exports = {
    data: new SlashCommandBuilder().setName('unverifiedrole').setDescription('returns the name of the unverified role')
        .addRoleOption(option => option.setName('unverifiedrole').setDescription('set the role name for the unverified role ( (current unverified role) -> deactivate unverified role)')),
    async execute(interaction) {
        const unverifiedRole = interaction.options.getRole('unverifiedrole');
        if (unverifiedRole == null) {
            let role = interaction.guild.roles.cache.find(r => r.id === serverSettingsMap.get(interaction.guild.id).unverifiedRoleName)
            if (role === undefined) {
                await interaction.reply("Unverified role is disabled")
                return
            }
            await interaction.reply("Unverified role: " + role.name)
        } else {
            const serverSettings = serverSettingsMap.get(interaction.guild.id);
            if (unverifiedRole.id === serverSettings.unverifiedRoleName) {
                serverSettings.unverifiedRoleName = ""
                await interaction.reply("Unverified role deactivated")
            } else {
                if (unverifiedRole.name === "@everyone") {
                    await interaction.reply("@Everyone is no permitted role!")
                    return
                }
                serverSettings.unverifiedRoleName = unverifiedRole.id
                await interaction.reply("Unverified role changed to " + unverifiedRole.name)
            }
            serverSettingsMap.set(interaction.guild.id, serverSettings)

            database.updateServerSettings(interaction.guildId, serverSettings)
        }
    }
}