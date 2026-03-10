const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const database = require("../database/Database.js");
const { getLocale } = require("../Language");
const premiumManager = require("../premium/PremiumManager");
const { createCSVPremiumRequiredEmbed } = require("../utils/embeds");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('emaillist')
        .setDescription('Manage allowed email addresses via CSV upload')
        .addSubcommand(subcommand =>
            subcommand
                .setName('upload')
                .setDescription('Upload a CSV file with allowed email addresses (one per row)')
                .addAttachmentOption(option =>
                    option
                        .setName('file')
                        .setDescription('CSV file with one email address per row')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View all currently allowed email addresses')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Remove all allowed email addresses from the list')
        )
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            const language = serverSettings.language || 'english';

            if (subcommand === 'list') {
                const emails = serverSettings.allowedEmails || [];
                if (emails.length === 0) {
                    await interaction.reply({
                        content: getLocale(language, "emaillistEmpty"),
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    const displayLimit = 20;
                    const shown = emails.slice(0, displayLimit).map(e => `\`${e}\``).join('\n• ');
                    const remaining = emails.length - displayLimit;
                    let content = getLocale(language, "emaillistListHeader", emails.length.toString()) + `\n• ${shown}`;
                    if (remaining > 0) {
                        content += `\n\n... ${getLocale(language, "emaillistListMore", remaining.toString())}`;
                    }
                    await interaction.reply({
                        content: content,
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }

            if (subcommand === 'clear') {
                const count = (serverSettings.allowedEmails || []).length;
                if (count === 0) {
                    await interaction.reply({
                        content: getLocale(language, "emaillistAlreadyEmpty"),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                serverSettings.allowedEmails = [];
                database.updateServerSettings(interaction.guildId, serverSettings);
                await interaction.reply({
                    content: getLocale(language, "emaillistCleared", count.toString()),
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (subcommand === 'upload') {
                // Premium gate: CSV upload requires tier 2 subscription or CSV unlock
                const csvCheck = await premiumManager.canUseCSVFeature(interaction.guildId, interaction.entitlements)
                if (!csvCheck.allowed) {
                    const { monetization } = require('../../config/config.json')
                    const skus = monetization?.skus || {}
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setStyle(ButtonStyle.Premium)
                            .setSKUId(skus.subscriptionTier2)
                    )
                    try {
                        await interaction.reply({ embeds: [createCSVPremiumRequiredEmbed(language)], components: [row], flags: MessageFlags.Ephemeral })
                    } catch (err) {
                        if (err.code === 50035) {
                            await interaction.reply({ embeds: [createCSVPremiumRequiredEmbed(language)], components: [], flags: MessageFlags.Ephemeral })
                        } else {
                            throw err
                        }
                    }
                    return
                }

                const attachment = interaction.options.getAttachment('file', true);

                // Validate file type
                if (!attachment.name.endsWith('.csv') && !attachment.name.endsWith('.txt')) {
                    await interaction.reply({
                        content: getLocale(language, "emaillistInvalidFile"),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                // Limit file size (1MB max)
                if (attachment.size > 1024 * 1024) {
                    await interaction.reply({
                        content: getLocale(language, "emaillistFileTooLarge"),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                try {
                    const response = await fetch(attachment.url);
                    const text = await response.text();

                    // Parse emails: one per row, handle CSV with commas, trim whitespace
                    const emails = [];
                    const lines = text.split(/\r?\n/);
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

                    for (const line of lines) {
                        // Split by comma to handle CSV with multiple columns
                        const parts = line.split(',');
                        for (const part of parts) {
                            const trimmed = part.trim().toLowerCase().replace(/^["']|["']$/g, '');
                            if (trimmed && emailRegex.test(trimmed)) {
                                emails.push(trimmed);
                            }
                        }
                    }

                    if (emails.length === 0) {
                        await interaction.editReply({
                            content: getLocale(language, "emaillistNoValidEmails")
                        });
                        return;
                    }

                    // Deduplicate
                    const uniqueEmails = [...new Set(emails)];

                    serverSettings.allowedEmails = uniqueEmails;
                    database.updateServerSettings(interaction.guildId, serverSettings);

                    await interaction.editReply({
                        content: getLocale(language, "emaillistUploaded", uniqueEmails.length.toString())
                    });
                } catch (error) {
                    console.error('Error processing email list:', error);
                    await interaction.editReply({
                        content: getLocale(language, "emaillistUploadError")
                    });
                }
            }
        });
    }
};
