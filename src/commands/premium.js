const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags, EmbedBuilder } = require('discord.js');
const premiumManager = require("../premium/PremiumManager");
const database = require("../database/Database");
const { getLocale } = require("../Language");
const { buildPlanButtons, appStoreUrl } = require("../utils/premiumButtons");

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
                    : (status.mailMode === 'zeptomail' && !status.subscriptionTier
                        ? getLocale(language, 'premiumMailsZeptoMode', status.bonusCredits.toString())
                        : getLocale(language, 'premiumMailsLimited', status.mailsSentMonth.toString(), status.freeLimit.toString(), status.freeRemaining.toString()))

                const modeValue = status.subscriptionTier
                    ? getLocale(language, 'premiumMailModeSubscription')
                    : (status.mailMode === 'zeptomail'
                        ? getLocale(language, 'premiumMailModeZepto')
                        : getLocale(language, 'premiumMailModeFree'))

                const embed = new EmbedBuilder()
                    .setTitle(getLocale(language, 'premiumStatusTitle'))
                    .setColor(status.subscriptionTier ? 0x5865F2 : 0x99AAB5)
                    .addFields(
                        { name: getLocale(language, 'premiumFieldPlan'), value: tierName, inline: true },
                        { name: getLocale(language, 'premiumFieldMailMode'), value: modeValue, inline: true },
                        { name: getLocale(language, 'premiumFieldEmails'), value: mailsValue, inline: false },
                        { name: getLocale(language, 'premiumFieldCredits'), value: getLocale(language, 'premiumCreditsRemaining', status.bonusCredits.toString()), inline: true },
                        { name: getLocale(language, 'premiumFieldCsv'), value: status.csvUnlocked || status.subscriptionTier === 'tier2' ? getLocale(language, 'premiumCsvUnlocked') : getLocale(language, 'premiumCsvLocked'), inline: true },
                        { name: getLocale(language, 'premiumFieldRedeem'), value: getLocale(language, 'premiumRedeemInstructions'), inline: false },
                    )

                // Advertise upgradeable plans (different content based on current tier)
                const adLines = []
                if (!status.subscriptionTier) {
                    adLines.push(getLocale(language, 'premiumAdStandard'))
                }
                if (status.subscriptionTier !== 'tier2') {
                    adLines.push(getLocale(language, 'premiumAdPro'))
                }
                if (!(status.csvUnlocked || status.subscriptionTier === 'tier2')) {
                    adLines.push(getLocale(language, 'premiumAdCsvUnlock'))
                }
                adLines.push(getLocale(language, 'premiumAdCreditPacks'))

                const storeLink = appStoreUrl()

                if (adLines.length > 0) {
                    let adValue = adLines.join('\n\n')
                    if (storeLink) {
                        adValue += '\n\n' + getLocale(language, 'premiumMobileHint', storeLink)
                    }
                    embed.addFields({
                        name: getLocale(language, 'premiumAdHeader'),
                        value: adValue,
                        inline: false
                    })
                }

                const footerLines = []
                if (!status.subscriptionTier) {
                    footerLines.push(getLocale(language, 'premiumStatusFooter'))
                }
                footerLines.push(getLocale(language, 'premiumAdFooter'))
                embed.setFooter({ text: footerLines.join(' • ') })
                if (storeLink) embed.setURL(storeLink)

                const components = buildPlanButtons(status, { context: 'status' })

                try {
                    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral })
                } catch (err) {
                    // SKU may be unavailable/unpublished – retry without premium buttons
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

                if (results.creditsAdded > 0 || results.csvUnlocked) {
                    embed.addFields({
                        name: getLocale(language, 'premiumRedeemMultiGuildWarningTitle'),
                        value: getLocale(language, 'premiumRedeemMultiGuildWarning', interaction.guild?.name || ''),
                        inline: false
                    })
                }

                await interaction.editReply({ embeds: [embed] })
            }
        })
    }
}
