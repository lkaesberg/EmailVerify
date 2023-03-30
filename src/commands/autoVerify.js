const database = require("../database/Database.js");
const {SlashCommandBuilder} = require("@discordjs/builders");

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('verify_on_join').setDescription("automatically verify every new member of the server").addBooleanOption(option => option.setName('enable').setDescription('enable/disable').setRequired(true)).setDefaultMemberPermissions(0),
    async execute(interaction) {
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            serverSettings.autoVerify = +interaction.options.getBoolean("enable", true)
            database.updateServerSettings(interaction.guildId, serverSettings)
            await interaction.reply((interaction.options.getBoolean("enable", true) ? "Enabled" : "Disabled") + " auto verify!")
        })
    }
}
