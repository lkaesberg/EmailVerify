const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");
const {serverSettingsMap} = require("../EmailBot");
module.exports = {
    data: new SlashCommandBuilder().setName('verifiedrole').setDescription('returns the name of the verified role').addRoleOption(option => option.setName('verifiedrole').setDescription('set the role name for the verified role')),
    async execute(interaction) {
        const verifiedRole = interaction.options.getRole('verifiedrole');
        if (verifiedRole == null) {
            let role = interaction.guild.roles.cache.find(r => r.id === serverSettingsMap.get(interaction.guild.id).verifiedRoleName)
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
            const serverSettings = serverSettingsMap.get(interaction.guild.id);
            serverSettings.verifiedRoleName = verifiedRole.id
            serverSettingsMap.set(interaction.guild.id, serverSettings)
            await interaction.reply("Verified role changed to " + verifiedRole.name)
            database.updateServerSettings(interaction.guildId, serverSettings)
        }
    }
}