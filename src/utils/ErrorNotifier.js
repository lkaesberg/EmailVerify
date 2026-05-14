const { EmbedBuilder } = require('discord.js');
const { getLocale } = require('../Language');
const database = require('../database/Database');

/**
 * Centralized error notification system for the bot.
 *
 * Each error notification has two parallel destinations:
 *  - A single admin channel, resolved via fallback chain: errorNotifyChannel → logChannel.
 *    The verify channel (channelID) is intentionally NOT in the chain because it's user-visible.
 *  - DMs to every opted-in user (errorNotifyUsers) plus the guild owner unless they explicitly
 *    opted out via errorNotifyOwnerOptedOut.
 *
 * Channel sends can optionally include a content ping (none / @everyone / @here / <roleId>).
 */
class ErrorNotifier {
    /**
     * Send an error notification to all configured destinations.
     *
     * @param {Object} options
     * @param {import('discord.js').Guild} options.guild
     * @param {string} options.errorTitle
     * @param {string} options.errorMessage
     * @param {import('discord.js').User} [options.user]
     * @param {import('discord.js').Interaction} [options.interaction] - if provided, also replies to the user with a generic error
     * @param {string} [options.language]
     * @param {import('discord.js').ActionRowBuilder[]} [options.components] - optional rows of buttons attached to admin message
     * @returns {Promise<boolean>} true if at least one destination received the message
     */
    static async notify({ guild, errorTitle, errorMessage, user = null, interaction = null, language = 'english', components = null }) {
        if (!guild) {
            console.error('[ErrorNotifier] No guild provided for error notification');
            return false;
        }

        if (interaction) {
            await this.sendGenericUserError(interaction, language);
        }

        return new Promise((resolve) => {
            database.getServerSettings(guild.id, async (serverSettings) => {
                const lang = serverSettings.language || language;
                const errorEmbed = this.createAdminErrorEmbed(guild, errorTitle, errorMessage, user, lang);

                let anySent = false;
                const channelSent = await this.#sendChannelDestination(guild, serverSettings, errorEmbed, components, lang);
                if (channelSent) anySent = true;

                const dmRecipients = await this.#resolveDMRecipients(guild, serverSettings);
                for (const member of dmRecipients) {
                    const dmSent = await this.#sendDM(member, errorEmbed, components);
                    if (dmSent) anySent = true;
                }

                resolve(anySent);
            });
        });
    }

    /**
     * Resolve the admin channel via fallback chain and send the embed there.
     */
    static async #sendChannelDestination(guild, serverSettings, embed, components, language) {
        const channelId = serverSettings.errorNotifyChannel || serverSettings.logChannel;
        if (!channelId) return false;

        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isTextBased?.()) return false;

        const pingContent = this.#resolvePing(serverSettings.errorNotifyPing);
        const payload = { embeds: [embed] };
        if (pingContent) payload.content = pingContent;
        if (components && components.length > 0) payload.components = components;

        try {
            await channel.send(payload);
            return true;
        } catch (e) {
            console.error(`[ErrorNotifier] Failed to send to channel ${channelId}:`, e.message);
            return false;
        }
    }

    /**
     * Translate the stored ping setting into the message `content` string.
     * Returns null when no ping should be prepended.
     */
    static #resolvePing(ping) {
        if (!ping || ping === 'none') return null;
        if (ping === 'everyone') return '@everyone';
        if (ping === 'here') return '@here';
        return `<@&${ping}>`;
    }

    /**
     * Collect the GuildMembers who should receive a DM: explicit opt-ins plus the owner
     * unless they've opted out. Members are fetched fresh so we don't DM users who left.
     */
    static async #resolveDMRecipients(guild, serverSettings) {
        const ids = new Set();
        for (const id of serverSettings.errorNotifyUsers || []) {
            if (id) ids.add(id);
        }
        if (!serverSettings.errorNotifyOwnerOptedOut) {
            try {
                const owner = await guild.fetchOwner();
                if (owner) ids.add(owner.id);
            } catch (e) {
                console.error(`[ErrorNotifier] Could not fetch owner for guild ${guild.id}:`, e.message);
            }
        }

        const members = [];
        for (const id of ids) {
            const member = await guild.members.fetch(id).catch(() => null);
            if (member) members.push(member);
        }
        return members;
    }

    static async #sendDM(member, embed, components) {
        try {
            const payload = { embeds: [embed] };
            if (components && components.length > 0) payload.components = components;
            await member.send(payload);
            return true;
        } catch (e) {
            console.error(`[ErrorNotifier] Failed to DM ${member.id}:`, e.message);
            return false;
        }
    }

    /**
     * Send generic error message to the user via their interaction.
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
}

module.exports = ErrorNotifier;
