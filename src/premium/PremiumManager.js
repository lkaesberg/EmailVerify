// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const database = require('../database/Database')
const config = require('../../config/config.json')
const { getLocale } = require('../Language')
const OperatorWebhook = require('../utils/OperatorWebhook')
const analytics = require('../utils/Analytics')

const monetization = config.monetization || { enabled: false }
const skus = monetization.skus || {}
const zeptoCfg = config.zeptomail || {}
const zeptoConfigured = !!(zeptoCfg.enabled && zeptoCfg.apiToken && zeptoCfg.fromAddress)
// A redemption claim older than this with no outcome is treated as abandoned.
const REDEMPTION_STALE_MS = 10 * 60 * 1000

class PremiumManager {
    get enabled() {
        return !!monetization.enabled
    }

    get freeMonthlyLimit() {
        return monetization.freeMonthlyLimit ?? 25
    }

    /**
     * Verification emails one vote unlocks for the voter in one server, and the most a
     * voter can unlock there in a month. The keys were renamed when the reward moved
     * from the whole server to the voter, so an old server-wide config isn't misread.
     */
    get voteReward() {
        const cfg = monetization.voteReward || {}
        return { perVote: cfg.mailsPerVote ?? 3, monthlyCap: cfg.monthlyCapPerVoter ?? 6 }
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
     * Project when the free monthly quota will run out at the current sending pace.
     * Returns a Date within this month, or null when there's no useful signal (no
     * sends yet, already over the limit — the 100% warning covers that — or on pace
     * to stay within the quota).
     */
    computeRunOutForecast(mailsSentMonth, freeLimit) {
        if (!freeLimit || !mailsSentMonth || mailsSentMonth <= 0) return null
        if (mailsSentMonth >= freeLimit) return null
        const now = new Date()
        const dayOfMonth = now.getDate()
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
        const dailyRate = mailsSentMonth / dayOfMonth
        if (dailyRate * daysInMonth < freeLimit) return null
        const runOutDay = Math.min(daysInMonth, Math.max(dayOfMonth + 1, Math.ceil(freeLimit / dailyRate)))
        return new Date(now.getFullYear(), now.getMonth(), runOutDay)
    }

    /**
     * Localized forecast line ("at this pace you'll run out around <date>") for the
     * given usage, or null. The date renders as a Discord timestamp so it localizes
     * itself to each reader's locale/timezone.
     */
    forecastLine(language, mailsSentMonth, freeLimit = this.freeMonthlyLimit) {
        const runOut = this.computeRunOutForecast(mailsSentMonth, freeLimit)
        if (!runOut) return null
        const unix = Math.floor(runOut.getTime() / 1000)
        return getLocale(language || 'english', 'premiumForecastRunOut', `<t:${unix}:D>`)
    }

    /**
     * Escalating "members are being turned away" notification. Records the denial and
     * notifies admins (with purchase buttons) on the 1st, 5th and 20th denial per
     * month — loss framing at the moment of highest purchase intent, and re-engagement
     * for admins who missed the single 100% warning.
     */
    async notifyMailDenied(guild, language) {
        if (!guild) return
        let crossings
        try {
            crossings = await database.recordMailDeniedAndCheckThresholds(guild.id)
        } catch (e) {
            console.error('[Premium] Failed to record mail denial:', e)
            return
        }
        if (!crossings.crossed1 && !crossings.crossed5 && !crossings.crossed20) return

        const lang = language || 'english'
        const ErrorNotifier = require('../utils/ErrorNotifier')
        const { buildPlanButtons, getWebsiteUrl, mobileHintLine } = require('../utils/premiumButtons')

        let components = null
        try {
            const premiumStatus = await this.getPremiumStatus(guild.id, null)
            const rows = buildPlanButtons(premiumStatus, { context: 'mailLimit' })
            if (rows.length > 0) components = rows
        } catch (e) {
            // Buttons are a bonus — proceed without them if SKUs aren't fetchable.
        }

        let message = getLocale(lang, 'mailDeniedWarnMessage', String(crossings.deniedMonth ?? 1))
        message += '\n\n' + getLocale(lang, 'quotaWarnRedeemHint')
        const mobileHint = mobileHintLine(lang)
        if (mobileHint) {
            message += '\n' + mobileHint
        }
        const websiteUrl = getWebsiteUrl()
        if (websiteUrl) {
            message += '\n' + getLocale(lang, 'quotaWarnFooterWebsite', websiteUrl)
        }

        await ErrorNotifier.notify({
            guild,
            errorTitle: getLocale(lang, 'mailDeniedWarnTitle'),
            errorMessage: message,
            language: lang,
            components
        }).catch(() => {})
    }

    /**
     * Determines whether the guild is allowed to send an email.
     * Whatever admits the send is taken atomically up front: a free email
     * (reserveFreeMail), a credit, or a vote email. MailSender gives it back if the
     * send fails.
     * Returns { allowed, source, votePassId?, autoDisabled?, reason?, mailsSentMonth?, freeLimit? }.
     * `autoDisabled` is true exactly once per zeptomail-mode exhaustion event so the
     * caller knows to notify the owner.
     *
     * With `userID` (the member the email is for), a server that is out of free emails
     * and credits still lets that member through on emails their own votes unlocked
     * (source 'vote'). Those are spent last, after the free quota and any credits.
     */
    async canSendMail(guildID, entitlements, userID = null) {
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
            const freeLimit = this.freeMonthlyLimit
            if (await database.reserveFreeMail(guildID, freeLimit)) {
                return { allowed: true, source: 'free', autoDisabled, autoDisabledReason: 'credits_exhausted' }
            }
            const consumedFallback = await database.consumeGuildCredit(guildID)
            if (consumedFallback) return { allowed: true, source: 'credits', autoDisabled, autoDisabledReason: 'credits_exhausted' }
            const votePassId = userID ? await database.consumeVotePass(userID, guildID) : null
            if (votePassId) {
                return { allowed: true, source: 'vote', votePassId, autoDisabled, autoDisabledReason: 'credits_exhausted' }
            }
            const stats = await new Promise(resolve => database.getGuildStats(guildID, resolve))
            return {
                allowed: false,
                reason: 'limit_reached',
                mailsSentMonth: stats.mailsSentMonth,
                freeLimit,
                autoDisabled,
                autoDisabledReason: 'credits_exhausted'
            }
        }

        // 3. Default 'free' mode: free monthly allowance → credits → the member's own
        //    vote emails → denied.
        const freeLimit = this.freeMonthlyLimit
        if (await database.reserveFreeMail(guildID, freeLimit)) {
            return { allowed: true, source: 'free' }
        }
        const consumed = await database.consumeGuildCredit(guildID)
        if (consumed) return { allowed: true, source: 'credits' }
        const votePassId = userID ? await database.consumeVotePass(userID, guildID) : null
        if (votePassId) return { allowed: true, source: 'vote', votePassId }
        const stats = await new Promise(resolve => database.getGuildStats(guildID, resolve))
        return {
            allowed: false,
            reason: 'limit_reached',
            mailsSentMonth: stats.mailsSentMonth,
            freeLimit
        }
    }

    /**
     * Notify the guild owner (via ErrorNotifier) and operator webhook that the
     * guild's zeptomail-credits mode was auto-disabled. Idempotency must be
     * guaranteed by the caller (only call when tryAutoDisableZeptoMode flipped).
     */
    async notifyZeptoModeAutoDisabled(guild, language) {
        if (!guild) return
        analytics.capture({ event: 'zepto_mode_auto_disabled', guild })
        const lang = language || 'english'
        const ErrorNotifier = require('../utils/ErrorNotifier')
        const { buildPlanButtons, getWebsiteUrl, mobileHintLine } = require('../utils/premiumButtons')

        let components = null
        try {
            const premiumStatus = await this.getPremiumStatus(guild.id, null)
            const rows = buildPlanButtons(premiumStatus, { context: 'quotaWarn' })
            if (rows.length > 0) components = rows
        } catch (e) {
            // Buttons are a bonus — proceed without them if SKUs aren't fetchable.
        }

        let message = getLocale(lang, 'zeptoModeAutoDisabledMessage')
        const mobileHint = mobileHintLine(lang)
        if (mobileHint) {
            message += '\n\n' + mobileHint
        }
        const websiteUrl = getWebsiteUrl()
        if (websiteUrl) {
            message += (mobileHint ? '\n' : '\n\n') + getLocale(lang, 'quotaWarnFooterWebsite', websiteUrl)
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
     * Determines whether the guild can use the restriction-list API.
     *
     * Deliberately stricter than canUseCSVFeature: this is a Tier 2 subscription
     * benefit only. The one-time CSV unlock does NOT grant it, because the API is an
     * ongoing service (a live endpoint we host and rate-limit) rather than a one-off
     * capability, so it has to lapse when the subscription does.
     *
     * Returns { allowed: boolean, reason?: string }
     */
    async canUseApiFeature(guildID, entitlements) {
        if (!this.enabled) return { allowed: true }
        if (this.getSubscriptionTier(entitlements) === 'tier2') return { allowed: true }
        return { allowed: false, reason: 'tier2_required' }
    }

    /**
     * Consume one consumable entitlement on Discord and grant it to the guild, recorded
     * in the redemption ledger so a grant that fails after the consume is owed, not lost.
     *
     *   'granted' : consumed and applied to the guild
     *   'busy'    : another redeem of this entitlement is in flight; nothing done here
     *   'pending' : consumed, but the local grant failed; reconcileRedemptions retries it
     * Throws when consume() fails; the claim is released so the entitlement can be redeemed again.
     */
    async #consumeAndGrant(entitlement, userID, guildID, kind, amount) {
        const claimedAt = await database.claimEntitlementRedemption({
            entitlementID: entitlement.id, guildID, userID, skuID: entitlement.skuId, kind, amount
        }, REDEMPTION_STALE_MS)
        if (claimedAt === null) return 'busy'

        try {
            await entitlement.consume()
        } catch (err) {
            await database.releaseEntitlementRedemption(entitlement.id, claimedAt)
            throw err
        }

        try {
            if (await database.grantEntitlementRedemption(entitlement.id)) return 'granted'
            console.error(`[Premium] Redemption ${entitlement.id} was no longer claimable after consume; left for reconciliation`)
        } catch (err) {
            console.error(`[Premium] Grant failed after consuming ${entitlement.id}; left for reconciliation:`, err)
        }
        return 'pending'
    }

    /**
     * Settle ledger claims left in 'consuming' (a grant that failed after consume(), or
     * a process that died around it). An entitlement Discord reports as consumed is
     * granted now; one still unconsumed is released so the user can redeem it again.
     * Runs on shard 0, where entitlement events land; the ledger's status check keeps
     * a grant to once even if it overlapped a live redeem.
     */
    async reconcileRedemptions(client) {
        const rows = await database.getStuckEntitlementRedemptions(REDEMPTION_STALE_MS)
        for (const row of rows) {
            let entitlement
            try {
                entitlement = await client.application.entitlements.fetch({ entitlement: row.entitlementID, force: true, cache: false })
            } catch (err) {
                console.warn(`[Premium] Could not fetch entitlement ${row.entitlementID} for reconciliation:`, err?.message || err)
                continue
            }
            try {
                if (entitlement.consumed) {
                    if (await database.grantEntitlementRedemption(row.entitlementID)) {
                        console.log(`[Premium] Reconciled redemption: ${row.kind} ${row.kind === 'credits' ? `+${row.amount} ` : ''}guild=${row.guildID} user=${row.userID} entitlement=${row.entitlementID}`)
                        OperatorWebhook.notify({
                            title: '🧾 Redemption reconciled',
                            fields: [
                                { name: 'Kind', value: row.kind === 'credits' ? `+${row.amount} credits` : 'CSV unlock', inline: true },
                                { name: 'Guild', value: `\`${row.guildID}\``, inline: true },
                                { name: 'User', value: `<@${row.userID}>`, inline: true },
                                { name: 'Entitlement', value: `\`${row.entitlementID}\``, inline: true }
                            ],
                            level: 'success'
                        })
                    }
                } else {
                    await database.releaseEntitlementRedemption(row.entitlementID, row.createdAt)
                }
            } catch (err) {
                console.error(`[Premium] Reconciling ${row.entitlementID} failed:`, err)
            }
        }
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
                    const outcome = await this.#consumeAndGrant(entitlement, interaction.user.id, guildID, 'credits', amount)
                    if (outcome === 'busy') continue
                    if (outcome === 'pending') {
                        results.details.push(getLocale(lang, 'premiumRedeemCreditsFailed', amount.toString()))
                        continue
                    }
                    results.creditsAdded += amount
                    analytics.capture({ event: 'premium_redeemed', userId: interaction.user.id, guildId: guildID, properties: { type: 'credits', amount, sku: entitlement.skuId } })
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
                    const outcome = await this.#consumeAndGrant(entitlement, interaction.user.id, guildID, 'csv', 0)
                    if (outcome === 'busy') continue
                    if (outcome === 'pending') {
                        results.details.push(getLocale(lang, 'premiumRedeemCsvFailed'))
                        continue
                    }
                    results.csvUnlocked = true
                    analytics.capture({ event: 'premium_redeemed', userId: interaction.user.id, guildId: guildID, properties: { type: 'csv', sku: entitlement.skuId } })
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
        const freeLimit = this.freeMonthlyLimit

        return {
            enabled: this.enabled,
            subscriptionTier: tier,
            freeLimit,
            mailsSentMonth: stats.mailsSentMonth,
            mailsDeniedMonth: stats.mailsDeniedMonth || 0,
            freeRemaining: Math.max(0, freeLimit - stats.mailsSentMonth),
            bonusCredits: premium.bonusCredits,
            csvUnlocked: premium.csvUnlocked,
            // The mode that is actually in effect: a stored 'zeptomail' does nothing
            // while ZeptoMail isn't configured (canSendMail takes the free path), so
            // don't show it as active.
            mailMode: this.zeptoConfigured ? (premium.mailMode || 'free') : 'free',
            zeptoAvailable: this.zeptoConfigured,
            hasUnlimitedMails: !!tier
        }
    }
}

const premiumManager = new PremiumManager()
module.exports = premiumManager
