const database = require("../database/Database");
const {getLocale} = require("../Language");
const {ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder} = require('discord.js');
const ErrorNotifier = require("../utils/ErrorNotifier");

/**
 * Send verification DM to user (used for autoVerify on member join)
 */
module.exports = async function sendVerifyMessage(guild, user, userGuilds) {
    await database.getServerSettings(guild.id, (async serverSettings => {
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
        
        userGuilds.set(user.id, guild)
        
        // Build verification DM message
        const embed = new EmbedBuilder()
            .setTitle(getLocale(serverSettings.language, 'verifyEmbedTitle'))
            .setDescription(getLocale(serverSettings.language, 'verifyDmDescription', guild.name))
            .setColor(0x5865F2)
            .setThumbnail(guild.iconURL({ dynamic: true }))
        
        if (serverSettings.logChannel !== "") {
            embed.setFooter({ text: getLocale(serverSettings.language, 'verifyDmAdminWarning') })
        }
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('openEmailModal')
                .setLabel(getLocale(serverSettings.language, 'verifyDmButton'))
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📧'),
            new ButtonBuilder()
                .setCustomId('openCodeModal')
                .setLabel(getLocale(serverSettings.language, 'enterCodeButton'))
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔑')
        )
        
        await user.send({ embeds: [embed], components: [row] }).catch(() => {})
    }))
}
