const {ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, TextDisplayBuilder} = require('discord.js');
const database = require("../database/Database");
const {getLocale} = require("../Language");

/**
 * Shows the email verification modal in response to an interaction
 * @param {Interaction} interaction - The Discord interaction to respond to
 * @param {Guild} guild - The guild context for verification
 * @param {Map} userGuilds - Map to store user-guild associations
 */
async function showEmailModal(interaction, guild, userGuilds) {
    if (!guild) {
        await interaction.reply({ content: 'Not linked to a guild. Try again using the button in the server.', flags: require('discord.js').MessageFlags.Ephemeral }).catch(() => {})
        return false
    }
    userGuilds.set(interaction.user.id, guild)
    
    await database.getServerSettings(guild.id, async serverSettings => {
        const domainsText = serverSettings.domains.toString().replaceAll(",", "|").replaceAll("*", "*")
        let description = serverSettings.verifyMessage !== "" ? serverSettings.verifyMessage : getLocale(serverSettings.language, "userEnterEmail", "(<name>" + domainsText + ")")
        if (serverSettings.logChannel !== "") {
            description += "\n-# Caution: The admin can see the used email address"
        }
        const modal = new ModalBuilder().setCustomId('emailModal').setTitle('Email Verification')
        const emailInput = new TextInputBuilder()
            .setCustomId('emailInput')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('your.name' + (serverSettings.domains[0] || 'example.com').replace('*', 'domain'))
            .setRequired(true)
        const emailLabel = new LabelBuilder()
            .setLabel('Enter your email address')
            .setTextInputComponent(emailInput)
        const instructionText = new TextDisplayBuilder().setContent(description)
        modal.addTextDisplayComponents(instructionText).addLabelComponents(emailLabel)
        await interaction.showModal(modal).catch(() => {})
    })
    return true
}

module.exports = { showEmailModal }

