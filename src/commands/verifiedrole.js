const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");
const {serverSettingsMap} = require("../EmailBot");
const ServerSettings = require("../database/ServerSettings");
module.exports = {
    data: new SlashCommandBuilder().setName('verifiedrole').setDescription('returns the name of the verified role').addRoleOption(option => option.setName('verifiedrole').setDescription('set the role name for the verified role')),
    async execute(interaction) {
        const verifiedRole = interaction.options.getRole('verifiedrole');
        let serverSettings = serverSettingsMap.get(interaction.guildId);
        if (serverSettings === undefined) {
            serverSettings = new ServerSettings()
            serverSettingsMap.set(interaction.guildId, serverSettings)
        }
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
            serverSettingsMap.set(interaction.guild.id, serverSettings)
            await interaction.reply("Verified role changed to " + verifiedRole.name)
            database.updateServerSettings(interaction.guildId, serverSettings)
        }
    }
}