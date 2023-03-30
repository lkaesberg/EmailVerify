const database = require("../database/Database.js");
const {SlashCommandBuilder} = require("@discordjs/builders");

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('unverifiedrole').setDescription('returns the name of the unverified role')
        .addRoleOption(option => option.setName('unverifiedrole').setDescription('set the role name for the unverified role ( (current unverified role) -> deactivate unverified role)')).setDefaultMemberPermissions(0),
    async execute(interaction) {
        const unverifiedRole = interaction.options.getRole('unverifiedrole');
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (unverifiedRole == null) {
                let role = interaction.guild.roles.cache.find(r => r.id === serverSettings.unverifiedRoleName)
                if (role === undefined) {
                    await interaction.reply("Unverified role is disabled")
                    return
                }
                await interaction.reply("Unverified role: " + role.name)
            } else {
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

                database.updateServerSettings(interaction.guildId, serverSettings)
            }
        })
    }
}