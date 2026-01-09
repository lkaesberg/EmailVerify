const {SlashCommandBuilder} = require("@discordjs/builders");
const {userGuilds} = require("../EmailBot");
const {showEmailModal} = require("../bot/showEmailModal");

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('verify').setDescription('Start the email verification process to get access to this server'),
    async execute(interaction) {
        await showEmailModal(interaction, interaction.guild, userGuilds)
    }
}