const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags, AttachmentBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const database = require("../database/Database.js");
const premiumManager = require("../premium/PremiumManager");
const { createCSVPremiumRequiredEmbed } = require("../utils/embeds");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("export")
        .setDescription("Export verification logs as CSV")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('logs')
                .setDescription('Export verification log channel messages as CSV')
                .addIntegerOption(option =>
                    option
                        .setName('limit')
                        .setDescription('Maximum number of messages to fetch (default: 1000, max: 10000)')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(10000)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'logs') {
            // Premium gate: CSV export requires tier 2 subscription or CSV unlock
            const csvCheck = await premiumManager.canUseCSVFeature(interaction.guildId, interaction.entitlements)
            if (!csvCheck.allowed) {
                const { monetization } = require('../../config/config.json')
                const skus = monetization?.skus || {}
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setStyle(ButtonStyle.Premium)
                        .setSKUId(skus.subscriptionTier2)
                )
                await database.getServerSettings(interaction.guildId, async serverSettings => {
                    const language = serverSettings.language || 'english'
                    try {
                        await interaction.reply({ embeds: [createCSVPremiumRequiredEmbed(language)], components: [row], flags: MessageFlags.Ephemeral })
                    } catch (err) {
                        if (err.code === 50035) {
                            await interaction.reply({ embeds: [createCSVPremiumRequiredEmbed(language)], components: [], flags: MessageFlags.Ephemeral })
                        } else {
                            throw err
                        }
                    }
                })
                return
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            await database.getServerSettings(interaction.guildId, async serverSettings => {
                if (!serverSettings.logChannel || serverSettings.logChannel === "") {
                    await interaction.editReply({
                        content: "❌ **No log channel configured!**\n\nUse `/settings logchannel` to set up a verification log channel first.",
                    });
                    return;
                }

                const logChannel = interaction.guild.channels.cache.get(serverSettings.logChannel);
                if (!logChannel) {
                    await interaction.editReply({
                        content: "❌ **Log channel not found!**\n\nThe configured log channel may have been deleted.",
                    });
                    return;
                }

                const limit = interaction.options.getInteger('limit') || 1000;
                
                try {
                    // Fetch messages in batches (Discord API limit is 100 per request)
                    let allMessages = [];
                    let lastMessageId = null;
                    let remaining = limit;

                    await interaction.editReply({
                        content: `⏳ Fetching messages from <#${serverSettings.logChannel}>...`,
                    });

                    while (remaining > 0) {
                        const fetchLimit = Math.min(remaining, 100);
                        const options = { limit: fetchLimit };
                        if (lastMessageId) {
                            options.before = lastMessageId;
                        }

                        const messages = await logChannel.messages.fetch(options);
                        if (messages.size === 0) break;

                        // Filter to only bot's own messages
                        const botMessages = messages.filter(msg => msg.author.id === interaction.client.user.id);
                        allMessages.push(...botMessages.values());

                        lastMessageId = messages.last().id;
                        remaining -= messages.size;

                        // Break if we got fewer messages than requested (end of channel)
                        if (messages.size < fetchLimit) break;
                    }

                    if (allMessages.length === 0) {
                        await interaction.editReply({
                            content: "❌ **No verification logs found!**\n\nThe bot hasn't logged any verifications yet, or the messages have been deleted.",
                        });
                        return;
                    }

                    // Parse messages and build CSV
                    const csvRows = ['timestamp,user_id,username,email,type,verified_by,tags'];
                    let successCount = 0;
                    let parseErrors = 0;

                    for (const message of allMessages) {
                        const parsed = parseLogMessage(message.content);
                        if (parsed) {
                            // Try to get username from mention
                            let username = '';
                            try {
                                const member = await interaction.guild.members.fetch(parsed.userId).catch(() => null);
                                username = member ? member.user.username : '';
                            } catch {
                                username = '';
                            }

                            // Replace commas in tags with semicolons to avoid CSV issues
                            const tags = parsed.tags ? parsed.tags.replace(/,/g, ';') : '';
                            
                            csvRows.push([
                                message.createdAt.toISOString(),
                                parsed.userId,
                                escapeCsvField(username),
                                escapeCsvField(parsed.email),
                                parsed.type,
                                parsed.verifiedBy || '',
                                tags
                            ].join(','));
                            successCount++;
                        } else {
                            parseErrors++;
                        }
                    }

                    if (successCount === 0) {
                        await interaction.editReply({
                            content: "❌ **Could not parse any log messages!**\n\nThe log format may have changed or messages are in an unexpected format.",
                        });
                        return;
                    }

                    // Create CSV file
                    const csvContent = csvRows.join('\n');
                    const buffer = Buffer.from(csvContent, 'utf-8');
                    const attachment = new AttachmentBuilder(buffer, {
                        name: `verification-logs-${interaction.guildId}-${Date.now()}.csv`
                    });

                    let summaryMessage = `✅ **Export complete!**\n\n`;
                    summaryMessage += `📊 **Entries exported:** ${successCount}\n`;
                    if (parseErrors > 0) {
                        summaryMessage += `⚠️ **Parse errors:** ${parseErrors} (unrecognized format)\n`;
                    }
                    summaryMessage += `📅 **Date range:** ${allMessages[allMessages.length - 1].createdAt.toLocaleDateString()} - ${allMessages[0].createdAt.toLocaleDateString()}`;

                    await interaction.editReply({
                        content: summaryMessage,
                        files: [attachment]
                    });

                } catch (error) {
                    console.error('Export error:', error);
                    await interaction.editReply({
                        content: "❌ **Export failed!**\n\nMake sure the bot has permission to read the log channel.",
                    });
                }
            });
        }
    },
};

/**
 * Parse a log message and extract user ID and email
 * Formats:
 * - Current:  ✅ <@123456789> → `email@example.com`
 * - With tags: ✅ <@123456789> → `email@example.com` [Ver, TEST]
 * - Manual:   🔧 <@123456789> → `email@example.com` (by <@987654321>)
 * - Legacy:   Authorized: <@123456789>     →     email@example.com
 */
function parseLogMessage(content) {
    // Current format with optional tags: ✅ <@userId> → `email` [tags]
    const regularMatchWithTags = content.match(/^✅\s*<@!?(\d+)>\s*→\s*`([^`]+)`\s*\[([^\]]+)\]$/);
    if (regularMatchWithTags) {
        return {
            userId: regularMatchWithTags[1],
            email: regularMatchWithTags[2],
            type: 'auto',
            verifiedBy: null,
            tags: regularMatchWithTags[3]
        };
    }

    // Current format without tags: ✅ <@userId> → `email`
    const regularMatch = content.match(/^✅\s*<@!?(\d+)>\s*→\s*`([^`]+)`$/);
    if (regularMatch) {
        return {
            userId: regularMatch[1],
            email: regularMatch[2],
            type: 'auto',
            verifiedBy: null,
            tags: null
        };
    }

    // Manual verification with optional tags: 🔧 <@userId> → `email` (by <@adminId>) [tags]
    const manualMatchWithTags = content.match(/^🔧\s*<@!?(\d+)>\s*→\s*`([^`]+)`\s*\(by\s*<@!?(\d+)>\)\s*\[([^\]]+)\]$/);
    if (manualMatchWithTags) {
        return {
            userId: manualMatchWithTags[1],
            email: manualMatchWithTags[2],
            type: 'manual',
            verifiedBy: manualMatchWithTags[3],
            tags: manualMatchWithTags[4]
        };
    }

    // Manual verification without tags: 🔧 <@userId> → `email` (by <@adminId>)
    const manualMatch = content.match(/^🔧\s*<@!?(\d+)>\s*→\s*`([^`]+)`\s*\(by\s*<@!?(\d+)>\)$/);
    if (manualMatch) {
        return {
            userId: manualMatch[1],
            email: manualMatch[2],
            type: 'manual',
            verifiedBy: manualMatch[3],
            tags: null
        };
    }

    // Legacy format: Authorized: <@userId>     →     email
    const legacyMatch = content.match(/^Authorized:\s*<@!?(\d+)>\s*→\s*(\S+@\S+)$/);
    if (legacyMatch) {
        return {
            userId: legacyMatch[1],
            email: legacyMatch[2].trim(),
            type: 'auto',
            verifiedBy: null,
            tags: null
        };
    }

    return null;
}

/**
 * Escape a field for CSV (handle commas, quotes, newlines)
 */
function escapeCsvField(field) {
    if (!field) return '';
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}
