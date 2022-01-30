const {SlashCommandBuilder} = require("@discordjs/builders");
const {languages} = require("../Language")
const {serverSettingsMap} = require("../EmailBot");
const database = require("../database/Database.js");
const ServerSettings = require("../database/ServerSettings");

module.exports = {
    data: new SlashCommandBuilder().setName('language').setDescription('Set language of bot')
        .addStringOption(option => option.setName("language").setDescription("Language").setRequired(true).addChoices([...languages.keys()].map(value => {
            return [value, value]
        }))),
    async execute(interaction) {
        const language = interaction.options.getString('language', true);

        let serverSettings = serverSettingsMap.get(interaction.guildId);
        if (serverSettings === undefined) {
            serverSettings = new ServerSettings()
            serverSettingsMap.set(interaction.guildId, serverSettings)
        }
        serverSettings.language = language
        serverSettingsMap.set(interaction.guild.id, serverSettings)
        await interaction.reply("Language: " + language)
        database.updateServerSettings(interaction.guildId, serverSettings)
    }
}