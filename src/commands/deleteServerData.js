const database = require("../database/Database.js");
const {SlashCommandBuilder} = require("@discordjs/builders");
const { MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('delete_server_data').setDescription("delete the stored data and disconnect from the server").addStringOption(option => option.setName('verify').setDescription('type "delete" to remove the data').setRequired(true)).setDefaultMemberPermissions(0),
    async execute(interaction) {
        if (interaction.options.getString("verify") === "delete") {
            database.deleteServerData(interaction.guildId)
            await interaction.reply({content: "Data deleted!", flags: MessageFlags.Ephemeral})
            await interaction.guild.leave()
            return
        }
        await interaction.reply({content: "Failed to verify!", flags: MessageFlags.Ephemeral})
    }
}