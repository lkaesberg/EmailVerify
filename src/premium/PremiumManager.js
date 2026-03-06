const database = require('../database/Database')
const config = require('../../config/config.json')
const { getLocale } = require('../Language')

const monetization = config.monetization || { enabled: false }
const skus = monetization.skus || {}

class PremiumManager {
    get enabled() {
        return !!monetization.enabled
    }

    get freeMonthlyLimit() {
        return monetization.freeMonthlyLimit ?? 50
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
     * Returns { allowed: boolean, reason: string|null, source: string }
     */
    async canSendMail(guildID, entitlements) {
        if (!this.enabled) return { allowed: true, source: 'disabled' }

        // 1. Check subscription (unlimited)
        const tier = this.getSubscriptionTier(entitlements)
        if (tier) return { allowed: true, source: 'subscription' }

        // 2. Check free monthly allowance
        const stats = await new Promise(resolve => {
            database.getGuildStats(guildID, resolve)
        })
        if (stats.mailsSentMonth < this.freeMonthlyLimit) {
            return { allowed: true, source: 'free' }
        }

        // 3. Check bonus credits
        const consumed = await database.consumeGuildCredit(guildID)
        if (consumed) return { allowed: true, source: 'credits' }

        // 4. Denied
        return {
            allowed: false,
            reason: 'limit_reached',
            mailsSentMonth: stats.mailsSentMonth,
            freeLimit: this.freeMonthlyLimit
        }
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
            hasUnlimitedMails: !!tier
        }
    }
}

const premiumManager = new PremiumManager()
module.exports = premiumManager
