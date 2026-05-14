const { SlashCommandBuilder } = require("@discordjs/builders");
const database = require("../database/Database");
const { MessageFlags, EmbedBuilder } = require('discord.js');
const { getLocale } = require('../Language');

module.exports = {
    data: new SlashCommandBuilder()
        .setDefaultPermission(true)
        .setName('set_error_notify')
        .setDescription('Configure where bot error notifications are sent')
        .addSubcommand(subcommand =>
            subcommand
                .setName('channel')
                .setDescription('Send error notifications to a specific channel')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('The channel to send error notifications to')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('ping')
                        .setDescription('Optional ping prepended to channel messages')
                        .setRequired(false)
                        .addChoices(
                            { name: 'none', value: 'none' },
                            { name: '@here', value: 'here' },
                            { name: '@everyone', value: 'everyone' }
                        )
                )
                .addRoleOption(option =>
                    option
                        .setName('ping_role')
                        .setDescription('Ping a specific role on each error (overrides the ping option)')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Remove the configured error channel (falls back to log channel)')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('me')
                .setDescription('Subscribe or unsubscribe yourself for error DM notifications')
                .addStringOption(option =>
                    option
                        .setName('mode')
                        .setDescription('Turn DMs on or off for yourself')
                        .setRequired(true)
                        .addChoices(
                            { name: 'on', value: 'on' },
                            { name: 'off', value: 'off' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Show current error notification settings')
        )
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            const language = serverSettings.language || 'english';

            if (subcommand === 'status') {
                const embed = await this.createStatusEmbed(interaction, serverSettings, language);
                await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                return;
            }

            if (subcommand === 'channel') {
                const channel = interaction.options.getChannel('channel');
                if (!channel.isTextBased()) {
                    await interaction.reply({
                        content: getLocale(language, 'errorNotifyInvalidChannel'),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const role = interaction.options.getRole('ping_role');
                const pingChoice = interaction.options.getString('ping') || 'none';
                // ping_role wins over ping if both are supplied — admins clearly meant the role.
                const ping = role ? role.id : pingChoice;

                serverSettings.errorNotifyChannel = channel.id;
                serverSettings.errorNotifyPing = ping;
                database.updateServerSettings(interaction.guildId, serverSettings);

                const pingLabel = ping === 'none' ? 'none'
                    : ping === 'here' ? '@here'
                    : ping === 'everyone' ? '@everyone'
                    : `<@&${ping}>`;
                await interaction.reply({
                    content: getLocale(language, 'errorNotifySetChannelWithPing', channel.name, pingLabel),
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (subcommand === 'clear') {
                serverSettings.errorNotifyChannel = '';
                serverSettings.errorNotifyPing = 'none';
                database.updateServerSettings(interaction.guildId, serverSettings);
                await interaction.reply({
                    content: getLocale(language, 'errorNotifyChannelCleared'),
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (subcommand === 'me') {
                const mode = interaction.options.getString('mode');
                const userId = interaction.user.id;
                const owner = await interaction.guild.fetchOwner().catch(() => null);
                const isOwner = owner && owner.id === userId;

                if (!Array.isArray(serverSettings.errorNotifyUsers)) {
                    serverSettings.errorNotifyUsers = [];
                }

                if (mode === 'on') {
                    if (isOwner) {
                        serverSettings.errorNotifyOwnerOptedOut = 0;
                    } else if (!serverSettings.errorNotifyUsers.includes(userId)) {
                        serverSettings.errorNotifyUsers.push(userId);
                    }
                    database.updateServerSettings(interaction.guildId, serverSettings);
                    await interaction.reply({
                        content: getLocale(language, 'errorNotifyMeOn'),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                if (mode === 'off') {
                    if (isOwner) {
                        serverSettings.errorNotifyOwnerOptedOut = 1;
                    }
                    serverSettings.errorNotifyUsers = serverSettings.errorNotifyUsers.filter(id => id !== userId);
                    database.updateServerSettings(interaction.guildId, serverSettings);
                    await interaction.reply({
                        content: getLocale(language, 'errorNotifyMeOff'),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
            }
        });
    },

    async createStatusEmbed(interaction, serverSettings, language) {
        const embed = new EmbedBuilder()
            .setTitle(getLocale(language, 'errorNotifyStatusTitle'))
            .setColor(0x5865F2)
            .setTimestamp();

        // Channel destination (with fallback)
        const explicitChannelId = serverSettings.errorNotifyChannel;
        const fallbackChannelId = !explicitChannelId ? serverSettings.logChannel : '';
        let channelLine;
        if (explicitChannelId) {
            const ch = interaction.guild.channels.cache.get(explicitChannelId);
            channelLine = ch
                ? getLocale(language, 'errorNotifyStatusChannelLine', `<#${ch.id}>`)
                : getLocale(language, 'errorNotifyStatusChannelMissing');
        } else if (fallbackChannelId) {
            const ch = interaction.guild.channels.cache.get(fallbackChannelId);
            channelLine = ch
                ? getLocale(language, 'errorNotifyStatusChannelFallback', `<#${ch.id}>`)
                : getLocale(language, 'errorNotifyStatusChannelNone');
        } else {
            channelLine = getLocale(language, 'errorNotifyStatusChannelNone');
        }

        // Ping mode (only relevant when a channel is in use)
        const ping = serverSettings.errorNotifyPing || 'none';
        let pingLine = '';
        if (explicitChannelId || fallbackChannelId) {
            const pingLabel = ping === 'none' ? getLocale(language, 'errorNotifyStatusPingNone')
                : ping === 'here' ? '@here'
                : ping === 'everyone' ? '@everyone'
                : `<@&${ping}>`;
            pingLine = '\n' + getLocale(language, 'errorNotifyStatusPing', pingLabel);
        }

        // DM subscribers
        const subscribers = Array.isArray(serverSettings.errorNotifyUsers) ? serverSettings.errorNotifyUsers.slice() : [];
        const owner = await interaction.guild.fetchOwner().catch(() => null);
        const ownerOptedIn = !serverSettings.errorNotifyOwnerOptedOut;
        if (owner && ownerOptedIn && !subscribers.includes(owner.id)) {
            subscribers.unshift(owner.id);
        }
        const subscriberLine = subscribers.length > 0
            ? getLocale(language, 'errorNotifyStatusSubscribers', subscribers.map(id => `<@${id}>`).join(', '))
            : getLocale(language, 'errorNotifyStatusNoSubscribers');

        embed.setDescription(`${channelLine}${pingLine}\n${subscriberLine}`);
        embed.addFields({
            name: getLocale(language, 'errorNotifyStatusNote'),
            value: getLocale(language, 'errorNotifyStatusNoteValue'),
            inline: false
        });

        return embed;
    }
};
