const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database");
const { MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('set_log_channel').setDescription('Change log channel. (No arguments resets to default)').addChannelOption(option => option.setName("logchannel").setDescription("Set log channel")).setDefaultMemberPermissions(0),
    async execute(interaction) {
        const logChannel = interaction.options.getChannel("logchannel")
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (!logChannel) {
                serverSettings.logChannel = ""
            } else {
                serverSettings.logChannel = logChannel.id
            }
            await interaction.reply({content: "Modified log channel", flags: MessageFlags.Ephemeral})
            database.updateServerSettings(interaction.guildId, serverSettings)
        })

    }
}