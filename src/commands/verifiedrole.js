const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('verifiedrole').setDescription('returns the name of the verified role').addRoleOption(option => option.setName('verifiedrole').setDescription('set the role name for the verified role')).setDefaultMemberPermissions(0),
    async execute(interaction) {
        const verifiedRole = interaction.options.getRole('verifiedrole');
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (verifiedRole == null) {
                let role = interaction.guild.roles.cache.find(r => r.id === serverSettings.verifiedRoleName)
                if (role === undefined) {
                    await interaction.reply("Verified role can not be found!")
                    return
                }
                await interaction.reply("Verified role: " + role.name)
            } else {
                if (verifiedRole.name === "@everyone") {
                    await interaction.reply("@Everyone is no permitted role!")
                    return
                }
                serverSettings.verifiedRoleName = verifiedRole.id
                await interaction.reply("Verified role changed to " + verifiedRole.name)
                database.updateServerSettings(interaction.guildId, serverSettings)
            }
        })

    }
}