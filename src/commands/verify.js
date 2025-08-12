const {SlashCommandBuilder} = require("@discordjs/builders");
const {ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder} = require('discord.js');
const database = require("../database/Database");
const {getLocale} = require("../Language");
const {userGuilds} = require("../EmailBot");

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('verify').setDescription('verify on the server'),
    async execute(interaction) {
        userGuilds.set(interaction.user.id, interaction.guild)
        await database.getServerSettings(interaction.guild.id, async serverSettings => {
            const domainsText = serverSettings.domains.toString().replaceAll(",", "|").replaceAll("*", "*")
            let instruction = serverSettings.verifyMessage !== "" ? serverSettings.verifyMessage : getLocale(serverSettings.language, "userEnterEmail", "(<name>" + domainsText + ")")
            if (serverSettings.logChannel !== "") {
                instruction += " Caution: The admin can see the used email address"
            }
            const row = new (require('discord.js').ActionRowBuilder)().addComponents(
                new (require('discord.js').ButtonBuilder)().setCustomId('openEmailModal').setLabel('Open Email Modal').setStyle(require('discord.js').ButtonStyle.Primary)
            )
            await interaction.reply({ content: instruction, components: [row], ephemeral: true }).catch(() => {})
            setTimeout(() => {
                interaction.deleteReply().catch(() => {})
            }, 300000)
        })
    }
}