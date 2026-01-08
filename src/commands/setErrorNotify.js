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
                .setName('owner')
                .setDescription('Send error notifications to the server owner (default)')
        )
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
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription('Send error notifications to a specific user via DM')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The user to send error notifications to')
                        .setRequired(true)
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

            if (subcommand === 'owner') {
                serverSettings.errorNotifyType = 'owner';
                serverSettings.errorNotifyTarget = '';
                database.updateServerSettings(interaction.guildId, serverSettings);
                await interaction.reply({
                    content: getLocale(language, 'errorNotifySetOwner'),
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (subcommand === 'channel') {
                const channel = interaction.options.getChannel('channel');
                
                // Verify the channel is a text channel
                if (!channel.isTextBased()) {
                    await interaction.reply({
                        content: getLocale(language, 'errorNotifyInvalidChannel'),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                serverSettings.errorNotifyType = 'channel';
                serverSettings.errorNotifyTarget = channel.id;
                database.updateServerSettings(interaction.guildId, serverSettings);
                await interaction.reply({
                    content: getLocale(language, 'errorNotifySetChannel', channel.name),
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (subcommand === 'user') {
                const user = interaction.options.getUser('user');
                
                // Verify the user is a member of the guild
                const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                if (!member) {
                    await interaction.reply({
                        content: getLocale(language, 'errorNotifyUserNotInGuild'),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                serverSettings.errorNotifyType = 'user';
                serverSettings.errorNotifyTarget = user.id;
                database.updateServerSettings(interaction.guildId, serverSettings);
                await interaction.reply({
                    content: getLocale(language, 'errorNotifySetUser', user.tag || user.username),
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
        });
    },

    async createStatusEmbed(interaction, serverSettings, language) {
        const embed = new EmbedBuilder()
            .setTitle(getLocale(language, 'errorNotifyStatusTitle'))
            .setColor(0x5865F2)
            .setTimestamp();

        const notifyType = serverSettings.errorNotifyType || 'owner';
        const notifyTarget = serverSettings.errorNotifyTarget || '';

        let statusText = '';
        if (notifyType === 'owner') {
            const owner = await interaction.guild.fetchOwner().catch(() => null);
            statusText = getLocale(language, 'errorNotifyStatusOwner', owner ? (owner.user.tag || owner.user.username) : 'Unknown');
        } else if (notifyType === 'channel') {
            const channel = interaction.guild.channels.cache.get(notifyTarget);
            if (channel) {
                statusText = getLocale(language, 'errorNotifyStatusChannel', channel.name);
            } else {
                statusText = getLocale(language, 'errorNotifyStatusChannelInvalid');
            }
        } else if (notifyType === 'user') {
            const member = await interaction.guild.members.fetch(notifyTarget).catch(() => null);
            if (member) {
                statusText = getLocale(language, 'errorNotifyStatusUser', member.user.tag || member.user.username);
            } else {
                statusText = getLocale(language, 'errorNotifyStatusUserInvalid');
            }
        }

        embed.setDescription(statusText);
        embed.addFields({
            name: getLocale(language, 'errorNotifyStatusNote'),
            value: getLocale(language, 'errorNotifyStatusNoteValue'),
            inline: false
        });

        return embed;
    }
};

