const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");
const {serverSettingsMap} = require("../EmailBot");
const ServerSettings = require("../database/ServerSettings");
module.exports = {
    data: new SlashCommandBuilder().setName('removedomain').setDescription('remove registered domain').addStringOption(option => option.setName('removedomain').setDescription('remove registered domain').setRequired(true)),
    async execute(interaction) {
        const removeDomain = interaction.options.getString('removedomain', true);

        let serverSettings = serverSettingsMap.get(interaction.guildId);
        if (serverSettings === undefined) {
            serverSettings = new ServerSettings()
            serverSettingsMap.set(interaction.guildId, serverSettings)
        }
        serverSettings.domains = serverSettings.domains.filter(function (value) {
            return value !== removeDomain;
        });
        serverSettingsMap.set(interaction.guild.id, serverSettings)
        await interaction.reply("Removed " + removeDomain)
        database.updateServerSettings(interaction.guildId, serverSettings)
    }
}