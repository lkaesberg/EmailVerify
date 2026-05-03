const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags } = require('discord.js');
const https = require('https');
const { URL } = require('url');
const database = require("../database/Database.js");
const { getLocale } = require("../Language");
const premiumManager = require("../premium/PremiumManager");
const md5hash = require("../crypto/Crypto");
const { createCSVPremiumRequiredEmbed } = require("../utils/embeds");
const { buildPlanButtons } = require("../utils/premiumButtons");

function downloadAttachment(rawUrl) {
    return new Promise((resolve, reject) => {
        const url = new URL(rawUrl);
        https.get({
            hostname: url.hostname,
            path: url.pathname + url.search,
            port: url.port || 443,
            headers: { 'Accept': 'text/csv,text/plain,*/*' }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                downloadAttachment(res.headers.location).then(resolve, reject)
                return
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
                reject(new Error(`HTTP ${res.statusCode}`))
                return
            }
            const chunks = []
            res.on('data', c => chunks.push(c))
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
            res.on('error', reject)
        }).on('error', reject)
    })
}

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
                .setName('clear')
                .setDescription('Remove all allowed email addresses from the list')
        )
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            const language = serverSettings.language || 'english';

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
                    const premiumStatus = await premiumManager.getPremiumStatus(interaction.guildId, interaction.entitlements)
                    const components = buildPlanButtons(premiumStatus, { context: 'csvRequired' })
                    try {
                        await interaction.reply({ embeds: [createCSVPremiumRequiredEmbed(language)], components, flags: MessageFlags.Ephemeral })
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
                    const text = await downloadAttachment(attachment.url);

                    // Parse emails: one per row, handle CSV with commas, trim whitespace
                    const parsedEmails = [];
                    const lines = text.split(/\r?\n/);
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

                    for (const line of lines) {
                        const parts = line.split(',');
                        for (const part of parts) {
                            const trimmed = part.trim().toLowerCase().replace(/^["']|["']$/g, '');
                            if (trimmed && emailRegex.test(trimmed)) {
                                parsedEmails.push(trimmed);
                            }
                        }
                    }

                    if (parsedEmails.length === 0) {
                        await interaction.editReply({
                            content: getLocale(language, "emaillistNoValidEmails")
                        });
                        return;
                    }

                    // Hash + dedup the new entries, then merge with the existing list (append, not replace).
                    const newHashes = new Set(parsedEmails.map(e => md5hash(e)));
                    const existingHashes = new Set(serverSettings.allowedEmails || []);
                    let added = 0;
                    for (const h of newHashes) {
                        if (!existingHashes.has(h)) {
                            existingHashes.add(h);
                            added++;
                        }
                    }
                    const total = existingHashes.size;

                    serverSettings.allowedEmails = Array.from(existingHashes);
                    database.updateServerSettings(interaction.guildId, serverSettings);

                    await interaction.editReply({
                        content: getLocale(language, "emaillistUploaded", added.toString(), total.toString())
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
