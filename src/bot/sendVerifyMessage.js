const database = require("../database/Database");
const {getLocale} = require("../Language");
const {ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder} = require('discord.js');
const ErrorNotifier = require("../utils/ErrorNotifier");

module.exports = async function sendVerifyMessage(guild, user, channelId, messageId, userGuilds, interaction = false) {
    await database.getServerSettings(guild.id, (async serverSettings => {
        if ((channelId !== serverSettings.channelID || messageId !== serverSettings.messageID) && !interaction) {
            return
        }
        if (!serverSettings.status) {
            // Send generic error to user
            try {
                const embed = new EmbedBuilder()
                    .setTitle(getLocale(serverSettings.language, 'errorGenericTitle'))
                    .setDescription(getLocale(serverSettings.language, 'errorGenericDescription'))
                    .setColor(0xED4245);
                await user.send({ embeds: [embed] });
            } catch {}
            // Notify admin about configuration issue
            await ErrorNotifier.notify({
                guild: guild,
                errorTitle: getLocale(serverSettings.language, 'errorBotNotConfiguredTitle'),
                errorMessage: getLocale(serverSettings.language, 'errorBotNotConfiguredMessage'),
                user: user,
                language: serverSettings.language
            });
            return
        }
        if (serverSettings.status) {
            userGuilds.set(user.id, guild)
            const domainsText = serverSettings.domains.toString().replaceAll(",", "|").replaceAll("*", "\\*")
            let message = serverSettings.verifyMessage !== "" ? serverSettings.verifyMessage : getLocale(serverSettings.language, "userEnterEmail", ("(<name>" + domainsText + ")"))
            if (serverSettings.logChannel !== "") {
                message += "\n-# Caution: The admin can see the used email address"
            }
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('openEmailModal').setLabel('Start Verification').setStyle(ButtonStyle.Primary)
            )
            await user.send({ content: message, components: [row] }).catch(() => {})
        }
    }))
}
