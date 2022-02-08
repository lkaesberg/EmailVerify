const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");
const registerRemoveDomain = require("../bot/registerRemoveDomain")

module.exports = {
    data: new SlashCommandBuilder().setName('removedomain').setDescription('remove registered domain').addStringOption(option => option.setName('removedomain').setDescription('remove registered domain').setRequired(true)),
    async execute(interaction) {
        const removeDomain = interaction.options.getString('removedomain', true);

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            serverSettings.domains = serverSettings.domains.filter(function (value) {
                return value !== removeDomain;
            });
            await interaction.reply("Removed " + removeDomain)
            database.updateServerSettings(interaction.guildId, serverSettings)
            await registerRemoveDomain(interaction.guildId, {data: this.data})
        })
    }
}