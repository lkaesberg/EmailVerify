const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");
const {serverSettingsMap} = require("../EmailBot");

module.exports = {
    data: new SlashCommandBuilder().setName('domains').setDescription('returns registered domains').addStringOption(option => option.setName('domain').setDescription('register given domain')),
    async execute(interaction) {
        const domain = interaction.options.getString('domain');
        if (domain == null) {
            await interaction.reply("Allowed domains: " + serverSettingsMap.get(interaction.guild.id).domains.toString())
        } else {
            if (domain.startsWith("@") && domain.includes(".")) {
                const serverSettings = serverSettingsMap.get(interaction.guild.id);
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