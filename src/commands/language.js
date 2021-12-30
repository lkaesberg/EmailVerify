const {SlashCommandBuilder} = require("@discordjs/builders");
const {languages} = require("../Language")
const {serverSettingsMap} = require("../EmailBot");
const database = require("../database/Database.js");

module.exports = {
    data: new SlashCommandBuilder().setName('language').setDescription('Set language of bot')
        .addStringOption(option => option.setName("language").setDescription("Language").setRequired(true).addChoices([...languages.keys()].map(value => {
            return [value, value]
        }))),
    async execute(interaction) {
        const language = interaction.options.getString('language', true);

        const serverSettings = serverSettingsMap.get(interaction.guild.id);
        serverSettings.language = language
        serverSettingsMap.set(interaction.guild.id, serverSettings)
        await interaction.reply("Language: " + language)
        database.updateServerSettings(interaction.guildId, serverSettings)
    }
}