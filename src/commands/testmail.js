const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags, EmbedBuilder } = require('discord.js');
const database = require("../database/Database.js");
const premiumManager = require("../premium/PremiumManager");
const { createMailLimitReachedEmbed } = require("../utils/embeds");
const { getWebsiteUrl } = require("../utils/premiumButtons");

// Per-guild daily cap so test mails can't be used to spam an address. In-memory is
// fine: guild slash commands always run on the guild's own shard.
const DAILY_CAP = 3;
const usage = new Map(); // guildId -> { day: 'YYYY-MM-DD', count }

function underDailyCap(guildId) {
    const today = new Date().toISOString().slice(0, 10);
    const entry = usage.get(guildId);
    if (!entry || entry.day !== today) {
        usage.set(guildId, { day: today, count: 1 });
        return true;
    }
    if (entry.count >= DAILY_CAP) return false;
    entry.count += 1;
    return true;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setDefaultPermission(true)
        .setName('testmail')
        .setDescription('Send a test verification email to check delivery and spam placement (Admin only)')
        .addStringOption(option => option
            .setName('email')
            .setDescription('Address to send the test email to (e.g. your own)')
            .setRequired(true))
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const toEmail = interaction.options.getString('email', true).trim().toLowerCase();

        if (toEmail.split('@').length - 1 !== 1 || toEmail.includes(' ') || !toEmail.split('@')[1]?.includes('.')) {
            await interaction.editReply({ content: '❌ That doesn\'t look like a valid email address.' });
            return;
        }

        if (!underDailyCap(interaction.guildId)) {
            await interaction.editReply({ content: `⏳ Test-mail limit reached (${DAILY_CAP}/day per server). Try again tomorrow.` });
            return;
        }

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            // Test sends count against the guild's quota — otherwise this would be a
            // free-mail loophole.
            const premiumCheck = await premiumManager.canSendMail(interaction.guildId, interaction.entitlements);
            if (!premiumCheck.allowed) {
                await interaction.editReply({ embeds: [createMailLimitReachedEmbed(serverSettings.language, getWebsiteUrl())] });
                return;
            }

            const mailSender = interaction.client.mailSender;
            if (!mailSender) {
                await interaction.editReply({ content: '❌ Mail system not initialized. Please try again shortly.' });
                return;
            }

            const result = await mailSender.sendTestEmail({
                toEmail,
                guildId: interaction.guildId,
                guildName: interaction.guild.name,
                language: serverSettings.language,
                emailStyle: serverSettings.emailStyle,
                premiumSource: premiumCheck.source
            });

            if (result.ok) {
                const embed = new EmbedBuilder()
                    .setTitle('✅ Test email sent')
                    .setDescription(
                        `A test verification email was sent to \`${toEmail}\`.\n\n` +
                        `**Provider:** ${result.provider}\n` +
                        `**Latency:** ${result.latencyMs} ms\n` +
                        (result.messageId ? `**Message ID:** \`${result.messageId}\`\n` : '') +
                        '\n💡 Check the **inbox and the spam folder** — if it lands in spam, that\'s where your members\' codes go too. ' +
                        '(Test mails count against your monthly quota.)'
                    )
                    .setColor(0x57F287);
                await interaction.editReply({ embeds: [embed] });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Test email failed')
                    .setDescription(
                        `Delivery to \`${toEmail}\` failed.\n\n**Error:** \`${String(result.error).slice(0, 500)}\`\n\n` +
                        'Members currently cannot receive verification codes — this is the same path real sends use.'
                    )
                    .setColor(0xED4245);
                await interaction.editReply({ embeds: [embed] });
            }
        });
    }
};
