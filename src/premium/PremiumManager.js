const database = require('../database/Database')
const config = require('../../config/config.json')
const { getLocale } = require('../Language')
const OperatorWebhook = require('../utils/OperatorWebhook')

const monetization = config.monetization || { enabled: false }
const skus = monetization.skus || {}
const zeptoCfg = config.zeptomail || {}
const zeptoConfigured = !!(zeptoCfg.enabled && zeptoCfg.apiToken && zeptoCfg.fromAddress)

class PremiumManager {
    get enabled() {
        return !!monetization.enabled
    }

    get freeMonthlyLimit() {
        return monetization.freeMonthlyLimit ?? 25
    }

    /** Whether the operator has configured the ZeptoMail provider. Required for
     *  guilds to opt into the 'zeptomail' mail mode. */
    get zeptoConfigured() {
        return zeptoConfigured
    }

    /**
     * Checks if a guild has an active subscription entitlement.
     * Returns 'tier2', 'tier1', or null.
     */
    getSubscriptionTier(entitlements) {
        if (!entitlements || entitlements.size === 0) return null
        if (skus.subscriptionTier2 && entitlements.some(e => e.skuId === skus.subscriptionTier2)) return 'tier2'
        if (skus.subscriptionTier1 && entitlements.some(e => e.skuId === skus.subscriptionTier1)) return 'tier1'
        return null
    }

    /**
     * Determines whether the guild is allowed to send an email.
     * If credits are consumed, the credit is decremented atomically.
     * Returns { allowed, source, autoDisabled?, reason?, mailsSentMonth?, freeLimit? }.
     * `autoDisabled` is true exactly once per zeptomail-mode exhaustion event so the
     * caller knows to notify the owner.
     */
    async canSendMail(guildID, entitlements) {
        if (!this.enabled) return { allowed: true, source: 'disabled' }

        // 1. Subscription → always allowed, always Zepto, free quota irrelevant.
        const tier = this.getSubscriptionTier(entitlements)
        if (tier) return { allowed: true, source: 'subscription' }

        const premium = await database.getGuildPremium(guildID)

        // 2. ZeptoMail-credits opt-in mode: no free quota, credit-funded Zepto sends.
        //    When credits are exhausted we atomically flip the guild back to 'free' and
        //    fall through to the standard free-quota path so the in-progress verification
        //    still succeeds when there's free quota left.
        if (premium.mailMode === 'zeptomail' && this.zeptoConfigured) {
            const consumed = await database.consumeGuildCredit(guildID)
            if (consumed) return { allowed: true, source: 'credits-zepto' }

            const autoDisabled = await database.tryAutoDisableZeptoMode(guildID)
            const stats = await new Promise(resolve => database.getGuildStats(guildID, resolve))
            if (stats.mailsSentMonth < this.freeMonthlyLimit) {
                return { allowed: true, source: 'free', autoDisabled, autoDisabledReason: 'credits_exhausted' }
            }
            const consumedFallback = await database.consumeGuildCredit(guildID)
            if (consumedFallback) return { allowed: true, source: 'credits', autoDisabled, autoDisabledReason: 'credits_exhausted' }
            return {
                allowed: false,
                reason: 'limit_reached',
                mailsSentMonth: stats.mailsSentMonth,
                freeLimit: this.freeMonthlyLimit,
                autoDisabled,
                autoDisabledReason: 'credits_exhausted'
            }
        }

        // 3. Default 'free' mode: free monthly allowance → credits → denied.
        const stats = await new Promise(resolve => database.getGuildStats(guildID, resolve))
        if (stats.mailsSentMonth < this.freeMonthlyLimit) {
            return { allowed: true, source: 'free' }
        }
        const consumed = await database.consumeGuildCredit(guildID)
        if (consumed) return { allowed: true, source: 'credits' }
        return {
            allowed: false,
            reason: 'limit_reached',
            mailsSentMonth: stats.mailsSentMonth,
            freeLimit: this.freeMonthlyLimit
        }
    }

    /**
     * Notify the guild owner (via ErrorNotifier) and operator webhook that the
     * guild's zeptomail-credits mode was auto-disabled. Idempotency must be
     * guaranteed by the caller (only call when tryAutoDisableZeptoMode flipped).
     */
    async notifyZeptoModeAutoDisabled(guild, language) {
        if (!guild) return
        const lang = language || 'english'
        const ErrorNotifier = require('../utils/ErrorNotifier')
        const { buildPlanButtons, getWebsiteUrl } = require('../utils/premiumButtons')

        let components = null
        try {
            const premiumStatus = await this.getPremiumStatus(guild.id, null)
            const rows = buildPlanButtons(premiumStatus, { context: 'quotaWarn' })
            if (rows.length > 0) components = rows
        } catch (e) {
            // Buttons are a bonus — proceed without them if SKUs aren't fetchable.
        }

        const websiteUrl = getWebsiteUrl()
        let message = getLocale(lang, 'zeptoModeAutoDisabledMessage')
        if (websiteUrl) {
            message += '\n\n' + getLocale(lang, 'quotaWarnFooterWebsite', websiteUrl)
        }

        await ErrorNotifier.notify({
            guild,
            errorTitle: getLocale(lang, 'zeptoModeAutoDisabledTitle'),
            errorMessage: message,
            language: lang,
            components
        }).catch(() => {})

        OperatorWebhook.notify({
            title: '🔌 ZeptoMail mode auto-disabled',
            description: 'Guild ran out of credits in zeptomail-credits mode; switched back to the free self-SMTP path.',
            fields: [
                { name: 'Guild', value: `\`${guild.id}\` (${guild.name || 'unknown'})`, inline: false }
            ],
            level: 'warn'
        })
    }

    /**
     * Determines whether the guild can use CSV features (export / emaillist upload).
     * Returns { allowed: boolean }
     */
    async canUseCSVFeature(guildID, entitlements) {
        if (!this.enabled) return { allowed: true }

        // Tier 2 subscription includes CSV
        const tier = this.getSubscriptionTier(entitlements)
        if (tier === 'tier2') return { allowed: true }

        // One-time CSV purchase stored in DB
        const premium = await database.getGuildPremium(guildID)
        if (premium.csvUnlocked) return { allowed: true }

        return { allowed: false }
    }

    /**
     * Redeems the invoking user's unconsumed entitlements for the given guild.
     * Consumes credit packs and processes CSV durable unlocks.
     * Returns { creditsAdded: number, csvUnlocked: boolean, details: string[] }
     */
    async redeemEntitlements(interaction, guildID, language) {
        const lang = language || 'english'
        const results = { creditsAdded: 0, csvUnlocked: false, details: [] }

        const creditSkuMap = {}
        if (skus.credits100) creditSkuMap[skus.credits100] = 100
        if (skus.credits500) creditSkuMap[skus.credits500] = 500
        if (skus.credits2000) creditSkuMap[skus.credits2000] = 2000

        let entitlements
        try {
            entitlements = await interaction.client.application.entitlements.fetch({
                user: interaction.user.id,
                excludeEnded: true
            })
        } catch (err) {
            console.error('Failed to fetch entitlements:', err)
            results.details.push(getLocale(lang, 'premiumFetchFailed'))
            return results
        }

        for (const [, entitlement] of entitlements) {
            // Credit packs (consumable)
            if (creditSkuMap[entitlement.skuId] && !entitlement.consumed) {
                const amount = creditSkuMap[entitlement.skuId]
                try {
                    await entitlement.consume()
                    await database.addGuildCredits(guildID, amount)
                    results.creditsAdded += amount
                    results.details.push(getLocale(lang, 'premiumRedeemCredits', amount.toString()))
                    console.log(`[Premium] Credits redeemed: +${amount} guild=${guildID} user=${interaction.user.id} sku=${entitlement.skuId} entitlement=${entitlement.id}`)
                    OperatorWebhook.notify({
                        title: '🎟️ Credits redeemed',
                        fields: [
                            { name: 'Amount', value: `+${amount}`, inline: true },
                            { name: 'Guild', value: `\`${guildID}\` (${interaction.guild?.name || 'unknown'})`, inline: true },
                            { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'SKU', value: `\`${entitlement.skuId}\``, inline: true },
                            { name: 'Entitlement', value: `\`${entitlement.id}\``, inline: true }
                        ],
                        level: 'success'
                    })
                } catch (err) {
                    console.error('Failed to consume entitlement:', err)
                    results.details.push(getLocale(lang, 'premiumRedeemCreditsFailed', amount.toString()))
                }
            }

            // CSV one-time unlock (consumable, per-server)
            if (entitlement.skuId === skus.csvUnlock && !entitlement.consumed) {
                try {
                    await entitlement.consume()
                    await database.unlockGuildCSV(guildID)
                    results.csvUnlocked = true
                    results.details.push(getLocale(lang, 'premiumRedeemCsv'))
                    console.log(`[Premium] CSV unlocked: guild=${guildID} user=${interaction.user.id} sku=${entitlement.skuId} entitlement=${entitlement.id}`)
                    OperatorWebhook.notify({
                        title: '📁 CSV unlocked',
                        fields: [
                            { name: 'Guild', value: `\`${guildID}\` (${interaction.guild?.name || 'unknown'})`, inline: true },
                            { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'SKU', value: `\`${entitlement.skuId}\``, inline: true },
                            { name: 'Entitlement', value: `\`${entitlement.id}\``, inline: true }
                        ],
                        level: 'success'
                    })
                } catch (err) {
                    console.error('Failed to consume/unlock CSV:', err)
                    results.details.push(getLocale(lang, 'premiumRedeemCsvFailed'))
                }
            }
        }

        if (results.details.length === 0) {
            results.details.push(getLocale(lang, 'premiumNoRedeemable'))
        }

        return results
    }

    /**
     * Returns a full premium status object for display.
     */
    async getPremiumStatus(guildID, entitlements) {
        const tier = this.getSubscriptionTier(entitlements)
        const premium = await database.getGuildPremium(guildID)
        const stats = await new Promise(resolve => {
            database.getGuildStats(guildID, resolve)
        })

        return {
            enabled: this.enabled,
            subscriptionTier: tier,
            freeLimit: this.freeMonthlyLimit,
            mailsSentMonth: stats.mailsSentMonth,
            freeRemaining: Math.max(0, this.freeMonthlyLimit - stats.mailsSentMonth),
            bonusCredits: premium.bonusCredits,
            csvUnlocked: premium.csvUnlocked,
            mailMode: premium.mailMode || 'free',
            zeptoAvailable: this.zeptoConfigured,
            hasUnlimitedMails: !!tier
        }
    }
}

const premiumManager = new PremiumManager()
module.exports = premiumManager
