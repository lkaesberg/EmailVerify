const {SlashCommandBuilder} = require("@discordjs/builders");
module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('help').setDescription('show instructions on how to use the bot').setDefaultMemberPermissions(0),
    async execute(interaction) {
        await interaction.reply({
            content:
                "1)    Use `/button` or `/message` to create the verify message\n" +
                "2)   Use `/domains` to add the verified domains\n" +
                "3)   Use `/verifiedrole` to add the verified role\n" +
                "3.1) Use `/unverifiedrole` to add the unverified role if needed\n" +
                "4)   Check the settings with `/status`\n" +
                "5)   The bot is ready to use!",
            ephemeral: true
        })
    }
}