const database = require("../database/Database.js");
const {SlashCommandBuilder} = require("@discordjs/builders");
const {serverSettingsMap} = require("../EmailBot");

module.exports = {
    data: new SlashCommandBuilder().setName('delete_server_data').setDescription("delete the stored data and disconnect from the server").addStringOption(option => option.setName('verify').setDescription('type "delete" to remove the data').setRequired(true)),
    async execute(interaction) {
        if (interaction.options.getString("verify") === "delete") {
            database.deleteServerData(interaction.guildId)
            serverSettingsMap.delete(interaction.guildId)
            await interaction.reply("Data deleted!")
            await interaction.guild.leave()
            return
        }
        await interaction.reply("Failed to verify!")
    }
}