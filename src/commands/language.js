const {SlashCommandBuilder} = require("@discordjs/builders");
const {languages} = require("../Language")
const database = require("../database/Database.js");

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('language').setDescription('Set language of bot')
        .addStringOption(option => option.setName("language").setDescription("Language").setRequired(true).addChoices(...[...languages.keys()].map(value => {
            return {name: value, value: value}
        }))).setDefaultMemberPermissions(0),
    async execute(interaction) {
        const language = interaction.options.getString('language', true);

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            serverSettings.language = language
            await interaction.reply("Language: " + language)
            database.updateServerSettings(interaction.guildId, serverSettings)
        })
    }
}