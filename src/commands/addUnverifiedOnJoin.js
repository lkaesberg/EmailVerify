const database = require("../database/Database.js");
const {SlashCommandBuilder} = require("@discordjs/builders");
const { MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('add_unverified_on_join').setDescription("automatically add the unverified role to every new member of the server").addBooleanOption(option => option.setName('enable').setDescription('enable/disable').setRequired(true)).setDefaultMemberPermissions(0),
    async execute(interaction) {
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            serverSettings.autoAddUnverified = +interaction.options.getBoolean("enable", true)
            database.updateServerSettings(interaction.guildId, serverSettings)
            await interaction.reply({content: (interaction.options.getBoolean("enable", true) ? "Enabled" : "Disabled") + " auto add unverified role!", flags: MessageFlags.Ephemeral})
        })
    }
}
