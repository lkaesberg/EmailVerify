const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");
const {serverSettingsMap} = require("../EmailBot");
module.exports = {
    data: new SlashCommandBuilder().setName('removedomain').setDescription('remove registered domain').addStringOption(option => option.setName('removedomain').setDescription('remove registered domain').setRequired(true)),
    async execute(interaction) {
        const removeDomain = interaction.options.getString('removedomain', true);

        const serverSettings = serverSettingsMap.get(interaction.guild.id);
        serverSettings.domains = serverSettings.domains.filter(function (value) {
            return value !== removeDomain;
        });
        serverSettingsMap.set(interaction.guild.id, serverSettings)
        await interaction.reply("Removed " + removeDomain)
        database.updateServerSettings(interaction.guildId, serverSettings)
    }
}