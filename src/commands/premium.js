const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const premiumManager = require("../premium/PremiumManager");
const database = require("../database/Database");
const { getLocale } = require("../Language");
const { monetization } = require('../../config/config.json');

const skus = monetization?.skus || {}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('premium')
        .setDescription('Manage premium features and view subscription status')
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('View this server\'s premium plan, credits, and usage')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('redeem')
                .setDescription('Redeem your purchased credit packs or CSV unlock to this server')
        )
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            const language = serverSettings.language || 'english'

            if (subcommand === 'status') {
                if (!premiumManager.enabled) {
                    await interaction.reply({
                        content: getLocale(language, 'premiumNotEnabled'),
                        flags: MessageFlags.Ephemeral
                    })
                    return
                }

                const status = await premiumManager.getPremiumStatus(interaction.guildId, interaction.entitlements)

                const tierName = status.subscriptionTier
                    ? getLocale(language, status.subscriptionTier === 'tier2' ? 'premiumPlanPro' : 'premiumPlanStandard')
                    : getLocale(language, 'premiumPlanFree')

                const mailsValue = status.hasUnlimitedMails
                    ? getLocale(language, 'premiumMailsUnlimited', status.mailsSentMonth.toString())
                    : getLocale(language, 'premiumMailsLimited', status.mailsSentMonth.toString(), status.freeLimit.toString(), status.freeRemaining.toString())

                const embed = new EmbedBuilder()
                    .setTitle(getLocale(language, 'premiumStatusTitle'))
                    .setColor(status.subscriptionTier ? 0x5865F2 : 0x99AAB5)
                    .addFields(
                        { name: getLocale(language, 'premiumFieldPlan'), value: tierName, inline: true },
                        { name: getLocale(language, 'premiumFieldEmails'), value: mailsValue, inline: false },
                        { name: getLocale(language, 'premiumFieldCredits'), value: getLocale(language, 'premiumCreditsRemaining', status.bonusCredits.toString()), inline: true },
                        { name: getLocale(language, 'premiumFieldCsv'), value: status.csvUnlocked || status.subscriptionTier === 'tier2' ? getLocale(language, 'premiumCsvUnlocked') : getLocale(language, 'premiumCsvLocked'), inline: true },
                    )

                if (!status.subscriptionTier) {
                    embed.setFooter({ text: getLocale(language, 'premiumStatusFooter') })
                }

                const components = []
                if (!status.subscriptionTier && skus.subscriptionTier1) {
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setStyle(ButtonStyle.Premium)
                            .setSKUId(skus.subscriptionTier1)
                    )
                    components.push(row)
                }

                try {
                    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral })
                } catch (err) {
                    // SKU may be unavailable/unpublished – retry without premium button
                    if (components.length > 0 && err.code === 50035) {
                        await interaction.reply({ embeds: [embed], components: [], flags: MessageFlags.Ephemeral })
                    } else {
                        throw err
                    }
                }
                return
            }

            if (subcommand === 'redeem') {
                if (!premiumManager.enabled) {
                    await interaction.reply({
                        content: getLocale(language, 'premiumNotEnabled'),
                        flags: MessageFlags.Ephemeral
                    })
                    return
                }

                await interaction.deferReply({ flags: MessageFlags.Ephemeral })

                const results = await premiumManager.redeemEntitlements(interaction, interaction.guildId, language)

                const embed = new EmbedBuilder()
                    .setTitle(getLocale(language, 'premiumRedeemTitle'))
                    .setDescription(results.details.join('\n'))
                    .setColor(results.creditsAdded > 0 || results.csvUnlocked ? 0x57F287 : 0x99AAB5)

                if (results.creditsAdded > 0) {
                    embed.addFields({ name: getLocale(language, 'premiumCreditsAdded'), value: `+${results.creditsAdded}`, inline: true })
                }

                await interaction.editReply({ embeds: [embed] })
            }
        })
    }
}
