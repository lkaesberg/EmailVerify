const {SlashCommandBuilder} = require("@discordjs/builders");
const {languages} = require("../Language")
const database = require("../database/Database.js");

module.exports = {
    data: new SlashCommandBuilder().setName('language').setDescription('Set language of bot')
        .addStringOption(option => option.setName("language").setDescription("Language").setRequired(true).addChoices([...languages.keys()].map(value => {
            return [value, value]
        }))),
    async execute(interaction) {
        const language = interaction.options.getString('language', true);

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            serverSettings.language = language
            await interaction.reply("Language: " + language)
            database.updateServerSettings(interaction.guildId, serverSettings)
        })
    }
}