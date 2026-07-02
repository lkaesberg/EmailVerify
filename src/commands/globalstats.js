const { SlashCommandBuilder } = require('@discordjs/builders');
const database = require("../database/Database");
const { MessageFlags, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setDefaultPermission(true)
        .setName('globalstats')
        .setDescription('View global server statistics (bot owner only)')
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Type of statistics to view')
                .setRequired(true)
                .addChoices(
                    { name: 'Overview (averages, medians, counts)', value: 'overview' },
                    { name: 'Top 100 by Mails Sent', value: 'top_mails' },
                    { name: 'Top 100 by Verifications', value: 'top_verifications' },
                    { name: 'Top 100 by Blocked Attempts (this month)', value: 'top_denied' }
                )
        )
        .addStringOption(option =>
            option
                .setName('period')
                .setDescription('Time period for statistics')
                .setRequired(true)
                .addChoices(
                    { name: 'This Month', value: 'month' },
                    { name: 'All Time', value: 'alltime' }
                )
        )
        .addIntegerOption(option =>
            option
                .setName('pages')
                .setDescription('Number of pages to show for top lists (default: 1, max: 10)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(10)
        )
        .setDefaultMemberPermissions(0),

    getCurrentMonth() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    },

    async execute(interaction) {
        // Check if the user is the bot owner
        const application = await interaction.client.application.fetch();
        const ownerId = application.owner?.ownerId;

        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "❌ **Access Denied**\n\nThis command is only available to the bot owner.",
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const allStats = await database.getAllGuildStats();
            const type = interaction.options.getString('type');
            const period = interaction.options.getString('period');
            const pages = interaction.options.getInteger('pages') || 1;
            const isMonthly = period === 'month';

            if (allStats.length === 0) {
                await interaction.editReply({
                    content: "📊 No server statistics available yet.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (type === 'overview') {
                await this.showOverview(interaction, allStats, isMonthly);
            } else if (type === 'top_mails') {
                await this.showTopMails(interaction, allStats, isMonthly, pages);
            } else if (type === 'top_verifications') {
                await this.showTopVerifications(interaction, allStats, isMonthly, pages);
            } else if (type === 'top_denied') {
                await this.showTopDenied(interaction, allStats, pages);
            }
        } catch (error) {
            console.error('Error fetching owner stats:', error);
            await interaction.editReply({
                content: "❌ An error occurred while fetching statistics.",
                flags: MessageFlags.Ephemeral
            });
        }
    },

    getMailsValue(stat, isMonthly) {
        if (isMonthly) {
            // Only count if statsMonth matches current month
            const currentMonth = this.getCurrentMonth();
            if (stat.statsMonth === currentMonth) {
                return stat.mailsSentMonth || 0;
            }
            return 0;
        }
        return stat.mailsSentTotal || 0;
    },

    getVerificationsValue(stat, isMonthly) {
        if (isMonthly) {
            // Only count if statsMonth matches current month
            const currentMonth = this.getCurrentMonth();
            if (stat.statsMonth === currentMonth) {
                return stat.verificationsMonth || 0;
            }
            return 0;
        }
        return stat.verificationsTotal || 0;
    },

    // Blocked verification attempts only have a monthly counter (no all-time column),
    // so this is always current-month regardless of the selected period.
    getDeniedValue(stat) {
        const currentMonth = this.getCurrentMonth();
        if (stat.statsMonth === currentMonth) {
            return stat.mailsDeniedMonth || 0;
        }
        return 0;
    },

    async showOverview(interaction, allStats, isMonthly) {
        const mailsArray = allStats.map(s => this.getMailsValue(s, isMonthly)).sort((a, b) => a - b);
        const verificationsArray = allStats.map(s => this.getVerificationsValue(s, isMonthly)).sort((a, b) => a - b);

        // Calculate totals
        const totalMails = mailsArray.reduce((sum, val) => sum + val, 0);
        const totalVerifications = verificationsArray.reduce((sum, val) => sum + val, 0);

        // Calculate averages
        const avgMails = totalMails / allStats.length;
        const avgVerifications = totalVerifications / allStats.length;

        // Calculate medians
        const medianMails = this.calculateMedian(mailsArray);
        const medianVerifications = this.calculateMedian(verificationsArray);

        // Count servers with at least one verification
        const serversWithVerifications = allStats.filter(s => this.getVerificationsValue(s, isMonthly) >= 1).length;
        const serversWithMails = allStats.filter(s => this.getMailsValue(s, isMonthly) >= 1).length;

        // Blocked attempts = lost demand at quota-limited servers (monthly counter only)
        const totalDenied = allStats.reduce((sum, s) => sum + this.getDeniedValue(s), 0);
        const serversWithDenied = allStats.filter(s => this.getDeniedValue(s) >= 1).length;

        // Get period label for display
        const periodLabel = isMonthly ? 'This Month' : 'All Time';
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                           'July', 'August', 'September', 'October', 'November', 'December'];
        const currentMonthName = monthNames[new Date().getMonth()];

        const embed = new EmbedBuilder()
            .setTitle(`📊 Global Server Statistics Overview (${isMonthly ? currentMonthName : periodLabel})`)
            .setColor(0x5865F2)
            .addFields(
                {
                    name: '📈 Total Servers with Stats',
                    value: `${allStats.length.toLocaleString()}`,
                    inline: true
                },
                {
                    name: '✅ Servers with ≥1 Verification',
                    value: `${serversWithVerifications.toLocaleString()} (${((serversWithVerifications / allStats.length) * 100).toFixed(1)}%)`,
                    inline: true
                },
                {
                    name: '📧 Servers with ≥1 Mail Sent',
                    value: `${serversWithMails.toLocaleString()} (${((serversWithMails / allStats.length) * 100).toFixed(1)}%)`,
                    inline: true
                },
                {
                    name: '📬 Mails Sent Statistics',
                    value: 
                        `**Total:** ${totalMails.toLocaleString()}\n` +
                        `**Average:** ${avgMails.toFixed(2)}\n` +
                        `**Median:** ${medianMails}`,
                    inline: true
                },
                {
                    name: '✅ Verifications Statistics',
                    value:
                        `**Total:** ${totalVerifications.toLocaleString()}\n` +
                        `**Average:** ${avgVerifications.toFixed(2)}\n` +
                        `**Median:** ${medianVerifications}`,
                    inline: true
                },
                {
                    name: '🚫 Blocked Attempts (this month)',
                    value:
                        `**Total:** ${totalDenied.toLocaleString()}\n` +
                        `**Servers affected:** ${serversWithDenied.toLocaleString()}\n` +
                        `*Quota-blocked verifications — your upgrade leads*`,
                    inline: true
                }
            )
            .setFooter({ text: `${periodLabel} • Data from ${allStats.length} servers` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },

    async showTopMails(interaction, allStats, isMonthly, pages) {
        const periodLabel = isMonthly ? 'This Month' : 'All Time';
        const itemsPerPage = 10;
        const maxItems = pages * itemsPerPage;
        
        // Sort by mails sent descending and take top N based on pages
        const sorted = [...allStats]
            .sort((a, b) => this.getMailsValue(b, isMonthly) - this.getMailsValue(a, isMonthly))
            .slice(0, maxItems);

        const embeds = await this.createTopEmbeds(
            interaction,
            sorted,
            `📬 Top ${maxItems} Servers by Mails Sent (${periodLabel})`,
            (stat) => this.getMailsValue(stat, isMonthly),
            'mails sent',
            periodLabel,
            pages
        );

        await interaction.editReply({ embeds, flags: MessageFlags.Ephemeral });
    },

    async showTopVerifications(interaction, allStats, isMonthly, pages) {
        const periodLabel = isMonthly ? 'This Month' : 'All Time';
        const itemsPerPage = 10;
        const maxItems = pages * itemsPerPage;
        
        // Sort by verifications descending and take top N based on pages
        const sorted = [...allStats]
            .sort((a, b) => this.getVerificationsValue(b, isMonthly) - this.getVerificationsValue(a, isMonthly))
            .slice(0, maxItems);

        const embeds = await this.createTopEmbeds(
            interaction,
            sorted,
            `✅ Top ${maxItems} Servers by Verifications (${periodLabel})`,
            (stat) => this.getVerificationsValue(stat, isMonthly),
            'verifications',
            periodLabel,
            pages
        );

        await interaction.editReply({ embeds, flags: MessageFlags.Ephemeral });
    },

    async showTopDenied(interaction, allStats, pages) {
        const itemsPerPage = 10;
        const maxItems = pages * itemsPerPage;

        // Only servers actually losing members are interesting here.
        const sorted = allStats
            .filter(s => this.getDeniedValue(s) >= 1)
            .sort((a, b) => this.getDeniedValue(b) - this.getDeniedValue(a))
            .slice(0, maxItems);

        if (sorted.length === 0) {
            await interaction.editReply({
                content: "🚫 No blocked verification attempts recorded this month — no server has hit its mail limit yet.",
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const embeds = await this.createTopEmbeds(
            interaction,
            sorted,
            `🚫 Top Servers by Blocked Attempts (This Month)`,
            (stat) => this.getDeniedValue(stat),
            'blocked attempts',
            'This Month',
            pages
        );

        await interaction.editReply({ embeds, flags: MessageFlags.Ephemeral });
    },

    async createTopEmbeds(interaction, sortedStats, title, getValue, label, periodLabel, maxPages) {
        const embeds = [];
        const itemsPerEmbed = 10;

        for (let i = 0; i < sortedStats.length; i += itemsPerEmbed) {
            const chunk = sortedStats.slice(i, i + itemsPerEmbed);
            const embed = new EmbedBuilder()
                .setTitle(i === 0 ? title : `${title} (cont.)`)
                .setColor(0x5865F2);

            let description = '';
            for (let j = 0; j < chunk.length; j++) {
                const stat = chunk[j];
                const rank = i + j + 1;
                const value = getValue(stat);
                
                // Try to get guild name and truncate if too long
                let guildName = 'Unknown Server';
                try {
                    const guild = interaction.client.guilds.cache.get(stat.guildID);
                    if (guild) {
                        guildName = guild.name.length > 30 ? guild.name.substring(0, 27) + '...' : guild.name;
                    }
                } catch {
                    // Keep default
                }

                description += `**${rank}.** ${guildName} — ${value.toLocaleString()} ${label}\n`;
            }

            embed.setDescription(description || 'No data');
            embed.setFooter({ text: `${periodLabel} • Showing ${i + 1}-${Math.min(i + itemsPerEmbed, sortedStats.length)} of ${sortedStats.length}` });
            embeds.push(embed);
        }

        return embeds.slice(0, maxPages); // Limit to requested pages (max 10 per Discord)
    },

    calculateMedian(sortedArray) {
        if (sortedArray.length === 0) return 0;
        const mid = Math.floor(sortedArray.length / 2);
        if (sortedArray.length % 2 === 0) {
            return ((sortedArray[mid - 1] + sortedArray[mid]) / 2).toFixed(2);
        }
        return sortedArray[mid];
    }
};
