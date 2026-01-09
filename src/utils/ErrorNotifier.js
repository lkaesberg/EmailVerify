const { EmbedBuilder } = require('discord.js');
const { getLocale } = require('../Language');
const database = require('../database/Database');

/**
 * Centralized error notification system for the bot
 * Sends error messages to configured destination (owner, user, or channel)
 * Falls back to guild owner if configured destination fails
 */
class ErrorNotifier {
    /**
     * Send an error notification to the appropriate destination
     * @param {Object} options - Error notification options
     * @param {Guild} options.guild - The Discord guild where the error occurred
     * @param {string} options.errorTitle - Short title for the error
     * @param {string} options.errorMessage - Detailed error message for admins
     * @param {User} [options.user] - The user who triggered the error (optional)
     * @param {Interaction} [options.interaction] - The interaction to reply to with generic message (optional)
     * @param {string} [options.language] - Language code for localization (optional)
     * @returns {Promise<boolean>} - Whether the notification was sent successfully
     */
    static async notify({ guild, errorTitle, errorMessage, user = null, interaction = null, language = 'english' }) {
        if (!guild) {
            console.error('[ErrorNotifier] No guild provided for error notification');
            return false;
        }

        // Send generic error message to user if interaction provided
        if (interaction) {
            await this.sendGenericUserError(interaction, language);
        }

        // Get server settings to determine where to send error
        return new Promise((resolve) => {
            database.getServerSettings(guild.id, async (serverSettings) => {
                const lang = serverSettings.language || language;
                const notifyType = serverSettings.errorNotifyType || 'owner';
                const notifyTarget = serverSettings.errorNotifyTarget || '';

                const errorEmbed = this.createAdminErrorEmbed(guild, errorTitle, errorMessage, user, lang);

                let sent = false;
                let fallbackReason = null;

                // Try to send to configured destination
                if (notifyType === 'channel' && notifyTarget) {
                    sent = await this.sendToChannel(guild, notifyTarget, errorEmbed);
                    if (!sent) {
                        fallbackReason = getLocale(lang, 'errorNotifyChannelFailed');
                    }
                } else if (notifyType === 'user' && notifyTarget) {
                    sent = await this.sendToUser(guild, notifyTarget, errorEmbed);
                    if (!sent) {
                        fallbackReason = getLocale(lang, 'errorNotifyUserFailed');
                    }
                }

                // If not sent yet (either owner type or fallback), send to owner
                if (!sent) {
                    const ownerSent = await this.sendToOwner(guild, errorEmbed, fallbackReason, lang);
                    resolve(ownerSent);
                } else {
                    resolve(true);
                }
            });
        });
    }

    /**
     * Send generic error message to the user
     */
    static async sendGenericUserError(interaction, language) {
        const embed = new EmbedBuilder()
            .setTitle(getLocale(language, 'errorGenericTitle'))
            .setDescription(getLocale(language, 'errorGenericDescription'))
            .setColor(0xED4245)
            .setTimestamp();

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ embeds: [embed], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        } catch (e) {
            // Can't send to user, that's fine
        }
    }

    /**
     * Create the detailed error embed for admins
     */
    static createAdminErrorEmbed(guild, errorTitle, errorMessage, user, language) {
        const embed = new EmbedBuilder()
            .setTitle(`⚠️ ${errorTitle}`)
            .setDescription(errorMessage)
            .setColor(0xFFA500)
            .addFields(
                { name: getLocale(language, 'errorFieldGuild'), value: `${guild.name} (${guild.id})`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'EmailBot Error Notification' });

        if (user) {
            embed.addFields(
                { name: getLocale(language, 'errorFieldUser'), value: `${user.tag || user.username} (<@${user.id}>)`, inline: true }
            );
        }

        return embed;
    }

    /**
     * Send error to a specific channel
     */
    static async sendToChannel(guild, channelId, embed) {
        try {
            const channel = guild.channels.cache.get(channelId);
            if (!channel) {
                return false;
            }
            await channel.send({ embeds: [embed] });
            return true;
        } catch (e) {
            console.error(`[ErrorNotifier] Failed to send to channel ${channelId}:`, e.message);
            return false;
        }
    }

    /**
     * Send error to a specific user via DM
     */
    static async sendToUser(guild, userId, embed) {
        try {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                return false;
            }
            await member.send({ embeds: [embed] });
            return true;
        } catch (e) {
            console.error(`[ErrorNotifier] Failed to send to user ${userId}:`, e.message);
            return false;
        }
    }

    /**
     * Send error to guild owner via DM
     * @param {Guild} guild - The Discord guild
     * @param {EmbedBuilder} embed - The error embed
     * @param {string|null} fallbackReason - Reason why fallback was triggered (if any)
     * @param {string} language - Language code
     */
    static async sendToOwner(guild, embed, fallbackReason, language) {
        try {
            const owner = await guild.fetchOwner();
            if (!owner) {
                console.error(`[ErrorNotifier] Could not fetch owner for guild ${guild.id}`);
                return false;
            }

            // If this is a fallback, add warning about the failed notification method
            if (fallbackReason) {
                embed.addFields({
                    name: getLocale(language, 'errorFallbackWarning'),
                    value: fallbackReason,
                    inline: false
                });
            }

            await owner.send({ embeds: [embed] });
            return true;
        } catch (e) {
            console.error(`[ErrorNotifier] Failed to send to owner of guild ${guild.id}:`, e.message);
            return false;
        }
    }
}

module.exports = ErrorNotifier;

