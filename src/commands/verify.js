const {SlashCommandBuilder} = require("@discordjs/builders");
const sendVerifyMessage = require("./../bot/sendVerifyMessage")
const {userGuilds} = require("../EmailBot");

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('verify').setDescription('verify on the server'),
    async execute(interaction) {
        await sendVerifyMessage(interaction.guild, interaction.user, null, null, userGuilds, true)
        await interaction.reply({ content: '📝', ephemeral: true })
    }
}