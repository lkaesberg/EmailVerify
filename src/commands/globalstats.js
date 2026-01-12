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
                    { name: 'Top 100 by Verifications', value: 'top_verifications' }
                )
        ),

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

            if (allStats.length === 0) {
                await interaction.editReply({
                    content: "📊 No server statistics available yet.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (type === 'overview') {
                await this.showOverview(interaction, allStats);
            } else if (type === 'top_mails') {
                await this.showTopMails(interaction, allStats);
            } else if (type === 'top_verifications') {
                await this.showTopVerifications(interaction, allStats);
            }
        } catch (error) {
            console.error('Error fetching owner stats:', error);
            await interaction.editReply({
                content: "❌ An error occurred while fetching statistics.",
                flags: MessageFlags.Ephemeral
            });
        }
    },

    async showOverview(interaction, allStats) {
        const mailsArray = allStats.map(s => s.mailsSentTotal || 0).sort((a, b) => a - b);
        const verificationsArray = allStats.map(s => s.verificationsTotal || 0).sort((a, b) => a - b);

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
        const serversWithVerifications = allStats.filter(s => (s.verificationsTotal || 0) >= 1).length;
        const serversWithMails = allStats.filter(s => (s.mailsSentTotal || 0) >= 1).length;

        const embed = new EmbedBuilder()
            .setTitle('📊 Global Server Statistics Overview')
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
                }
            )
            .setFooter({ text: `Data from ${allStats.length} servers` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },

    async showTopMails(interaction, allStats) {
        // Sort by mails sent descending and take top 100
        const sorted = [...allStats]
            .sort((a, b) => (b.mailsSentTotal || 0) - (a.mailsSentTotal || 0))
            .slice(0, 100);

        const embeds = await this.createTopEmbeds(
            interaction,
            sorted,
            '📬 Top 100 Servers by Mails Sent',
            (stat) => stat.mailsSentTotal || 0,
            'mails sent'
        );

        await interaction.editReply({ embeds, flags: MessageFlags.Ephemeral });
    },

    async showTopVerifications(interaction, allStats) {
        // Sort by verifications descending and take top 100
        const sorted = [...allStats]
            .sort((a, b) => (b.verificationsTotal || 0) - (a.verificationsTotal || 0))
            .slice(0, 100);

        const embeds = await this.createTopEmbeds(
            interaction,
            sorted,
            '✅ Top 100 Servers by Verifications',
            (stat) => stat.verificationsTotal || 0,
            'verifications'
        );

        await interaction.editReply({ embeds, flags: MessageFlags.Ephemeral });
    },

    async createTopEmbeds(interaction, sortedStats, title, getValue, label) {
        const embeds = [];
        const itemsPerEmbed = 25;

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
                
                // Try to get guild name
                let guildName = 'Unknown Server';
                try {
                    const guild = interaction.client.guilds.cache.get(stat.guildID);
                    if (guild) {
                        guildName = guild.name;
                    }
                } catch {
                    // Keep default
                }

                description += `**${rank}.** ${guildName}\n`;
                description += `    └ ${value.toLocaleString()} ${label} (ID: \`${stat.guildID}\`)\n`;
            }

            embed.setDescription(description || 'No data');
            embed.setFooter({ text: `Showing ${i + 1}-${Math.min(i + itemsPerEmbed, sortedStats.length)} of ${sortedStats.length}` });
            embeds.push(embed);
        }

        return embeds.slice(0, 10); // Discord limits to 10 embeds per message
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
