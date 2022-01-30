const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");
const {serverSettingsMap} = require("../EmailBot");
const ServerSettings = require("../database/ServerSettings");

module.exports = {
    data: new SlashCommandBuilder().setName('domains').setDescription('returns registered domains').addStringOption(option => option.setName('domain').setDescription('register given domain')),
    async execute(interaction) {
        const domain = interaction.options.getString('domain');
        let serverSettings = serverSettingsMap.get(interaction.guildId);
        if (serverSettings === undefined) {
            serverSettings = new ServerSettings()
            serverSettingsMap.set(interaction.guildId, serverSettings)
        }
        if (domain === null) {
            await interaction.reply("Allowed domains: " + serverSettings.domains.toString())
        } else {
            if (domain.startsWith("@") && domain.includes(".")) {
                serverSettings.domains.push(domain)
                serverSettingsMap.set(interaction.guild.id, serverSettings)
                await interaction.reply("Added " + domain)
                database.updateServerSettings(interaction.guildId, serverSettings)
            } else {
                await interaction.reply("Please enter a valid domain")
            }

        }
    }
}