const {SlashCommandBuilder} = require("@discordjs/builders");
const { MessageFlags } = require('discord.js');
module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('help').setDescription('show instructions on how to use the bot').setDefaultMemberPermissions(0),
    async execute(interaction) {
        await interaction.reply({
            content:
                "1)   Use `/button` to create the verification button message in a channel\n" +
                "2)   Use `/domains` to add the allowed email domains\n" +
                "3)   Use `/verifiedrole` to set the verified role\n" +
                "3.1) Use `/unverifiedrole` to set the unverified role if needed\n" +
                "4)   Check the settings with `/status`\n" +
                "5)   The bot is ready to use!\n\n" +
                "Note: Reaction-based verification and the `/message` command are deprecated. Please create a new verification flow with `/button`.",
            flags: MessageFlags.Ephemeral
        })
    }
}