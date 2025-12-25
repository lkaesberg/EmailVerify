const {SlashCommandBuilder} = require("@discordjs/builders");
const {userGuilds} = require("../EmailBot");
const {showEmailModal} = require("../bot/showEmailModal");

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('verify').setDescription('verify on the server'),
    async execute(interaction) {
        await showEmailModal(interaction, interaction.guild, userGuilds)
    }
}