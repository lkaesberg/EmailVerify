const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database");
const { MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('verifymessage').setDescription('Change verify message. (No arguments resets to default)').addStringOption(option => option.setName("verifymessage").setDescription("Set custom verify message")).setDefaultMemberPermissions(0),
    async execute(interaction) {
        const verifyMessage = interaction.options.getString("verifymessage")
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (!verifyMessage) {
                serverSettings.verifyMessage = ""
            } else {
                serverSettings.verifyMessage = verifyMessage
            }
            await interaction.reply({content: "Modified verify message", flags: MessageFlags.Ephemeral})
            database.updateServerSettings(interaction.guildId, serverSettings)
        })

    }
}