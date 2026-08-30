// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const config = require('../../../config/config.json')
const database = require('../../database/Database')
const analytics = require('../../utils/Analytics')
const OperatorWebhook = require('../../utils/OperatorWebhook')

// Telegram bills a Stars subscription every `subscription_period` seconds; 30 days
// is the only period the API currently accepts.
const MONTH_SECONDS = 30 * 24 * 60 * 60
const MONTH_MS = MONTH_SECONDS * 1000

// Digital goods sold inside Telegram must be paid for in Stars — Stripe is not an
// option there — so the currency is always XTR.
const CURRENCY = 'XTR'

/**
 * The same product ladder as the Discord SKUs, priced in Stars.
 *
 * `grant` is what the purchase does; `recurring` marks the two subscriptions, which
 * Telegram re-bills on its own and re-announces as further successful_payments.
 */
const PRODUCTS = {
    subscriptionTier1: { title: 'Standard', description: 'Unlimited verification emails, sent via ZeptoMail.', grant: 'tier1', recurring: true },
    subscriptionTier2: { title: 'Pro', description: 'Everything in Standard, plus email-list upload and export.', grant: 'tier2', recurring: true },
    credits100: { title: '100 credits', description: '100 verification emails. No expiry.', grant: 'credits', amount: 100 },
    credits500: { title: '500 credits', description: '500 verification emails. No expiry.', grant: 'credits', amount: 500 },
    credits2000: { title: '2000 credits', description: '2000 verification emails. No expiry.', grant: 'credits', amount: 2000 },
    csvUnlock: { title: 'Email list unlock', description: 'Upload a list of approved addresses and export verified members.', grant: 'csv' }
}

/**
 * Telegram Stars billing.
 *
 * This is where Telegram is genuinely easier than Discord: no merchant account, no
 * Stripe, no VAT handling, and recurring subscriptions are a single parameter on the
 * invoice. The costs are on the way out — payout is roughly $0.013 per Star bought
 * on web/desktop and about $0.009 when bought in-app (Apple and Google take 30%),
 * with a 1,000-Star minimum, a ~21-day hold, and withdrawal via Fragment to TON.
 *
 * The one thing that must not be got wrong is replay: Telegram can redeliver a
 * successful_payment, and the charge id is the only thing that makes applying one
 * idempotent. Every grant here goes through an insert-first claim on that id.
 */
class StarsStore {
    constructor(telegram) {
        this.telegram = telegram
        const cfg = (config.telegram && config.telegram.stars) || {}
        this.enabled = !!cfg.enabled
        this.prices = cfg.prices || {}
    }

    get products() { return PRODUCTS }

    /** Products this deployment has priced, in display order. */
    catalog() {
        return Object.entries(PRODUCTS)
            .filter(([id]) => Number(this.prices[id]) > 0)
            .map(([id, p]) => ({ id, stars: Number(this.prices[id]), ...p }))
    }

    /**
     * A payment link for one product, scoped to one community.
     *
     * Links rather than direct invoices: the bot cannot message an admin who has
     * never started it, but it can always post a link into the chat it gates.
     */
    async createLink(productId, communityKey) {
        if (!this.enabled) throw new Error('telegram.stars.enabled is false')
        const product = PRODUCTS[productId]
        if (!product) throw new Error(`unknown product: ${productId}`)
        const stars = Number(this.prices[productId])
        if (!(stars > 0)) throw new Error(`no Star price configured for ${productId}`)

        const payload = JSON.stringify({ c: communityKey, p: productId })
        const params = {
            title: product.title,
            description: product.description,
            payload,
            currency: CURRENCY,
            prices: [{ label: product.title, amount: stars }]
        }
        // A subscription_period turns the link into a recurring charge; Telegram then
        // re-bills without any further involvement from us.
        if (product.recurring) params.subscription_period = MONTH_SECONDS

        return this.telegram.createInvoiceLink(params)
    }

    /**
     * Answer a pre-checkout query. Telegram gives us ten seconds and fails the
     * payment otherwise, so this stays cheap: validate the payload shape and say yes.
     */
    async answerPreCheckout(query) {
        const parsed = this.#parsePayload(query.invoice_payload)
        const ok = !!parsed
        try {
            await this.telegram.callApi('answerPreCheckoutQuery', {
                pre_checkout_query_id: query.id,
                ok,
                ...(ok ? {} : { error_message: 'This payment link is no longer valid. Please request a new one.' })
            })
        } catch (err) {
            console.error('[Stars] answerPreCheckoutQuery failed:', err?.message || err)
        }
        return ok
    }

    /**
     * Apply a completed payment. Safe to call more than once for the same charge —
     * everything after the claim runs at most once.
     *
     * @returns {Promise<{applied: boolean, reason?: string, product?: string}>}
     */
    async applyPayment(payment, userKey) {
        const parsed = this.#parsePayload(payment.invoice_payload)
        if (!parsed) return { applied: false, reason: 'unparseable_payload' }

        const { c: communityKey, p: productId } = parsed
        const product = PRODUCTS[productId]
        if (!product) return { applied: false, reason: 'unknown_product' }

        const chargeId = payment.telegram_payment_charge_id
        if (!chargeId) return { applied: false, reason: 'no_charge_id' }

        // Insert-first claim: a redelivered payment loses here and grants nothing.
        const claimed = await database.recordStarPayment({
            chargeId,
            guildID: communityKey,
            userID: userKey,
            product: productId,
            stars: payment.total_amount || 0,
            isRecurring: !!payment.is_recurring
        })
        if (!claimed) return { applied: false, reason: 'duplicate', product: productId }

        try {
            await this.#grant(product, productId, communityKey, payment, chargeId)
        } catch (err) {
            console.error('[Stars] failed to apply a claimed payment:', err)
            OperatorWebhook.notify({
                title: '🚨 Stars payment claimed but not applied',
                description: 'A payment was recorded but granting it failed. This needs manual repair — the charge id will not be retried.',
                fields: [
                    { name: 'Charge', value: `\`${chargeId}\``, inline: false },
                    { name: 'Community', value: `\`${communityKey}\``, inline: true },
                    { name: 'Product', value: `\`${productId}\``, inline: true },
                    { name: 'Error', value: `\`${(err?.message || 'unknown').slice(0, 500)}\``, inline: false }
                ],
                level: 'error'
            })
            return { applied: false, reason: 'grant_failed', product: productId }
        }

        analytics.capture({
            event: payment.is_recurring && !payment.is_first_recurring ? 'premium_renewed' : 'premium_purchased',
            userId: userKey,
            guildId: communityKey,
            properties: { product: productId, stars: payment.total_amount || 0, provider: 'telegram_stars' }
        })
        return { applied: true, product: productId }
    }

    async #grant(product, productId, communityKey, payment, chargeId) {
        if (product.grant === 'credits') {
            await database.addGuildCredits(communityKey, product.amount)
            return
        }
        if (product.grant === 'csv') {
            await database.unlockGuildCSV(communityKey)
            return
        }
        // A subscription: trust Telegram's own expiry when it sends one, so a renewal
        // extends by exactly the period Telegram billed for.
        const expiresAt = payment.subscription_expiration_date
            ? payment.subscription_expiration_date * 1000
            : Date.now() + MONTH_MS
        await database.setGuildSubscription(communityKey, { tier: product.grant, expiresAt, chargeId })
    }

    /**
     * Refund a Star payment and undo what it granted. Only subscriptions are revoked
     * automatically — consumed credits cannot be un-consumed, so those are left for
     * the operator to reconcile.
     */
    async refund(userKey, chargeId) {
        const record = await database.getStarPayment(chargeId)
        if (!record) return { ok: false, reason: 'unknown_charge' }
        if (record.refundedAt) return { ok: false, reason: 'already_refunded' }

        const userId = Number(String(userKey).replace(/^t:/, ''))
        await this.telegram.callApi('refundStarPayment', {
            user_id: userId,
            telegram_payment_charge_id: chargeId
        })
        await database.markStarPaymentRefunded(chargeId)

        const product = PRODUCTS[record.product]
        if (product && (product.grant === 'tier1' || product.grant === 'tier2')) {
            await database.clearGuildSubscription(record.guildID)
        }
        analytics.capture({
            event: 'premium_removed',
            guildId: record.guildID,
            properties: { product: record.product, provider: 'telegram_stars', reason: 'refund' }
        })
        return { ok: true, product: record.product, revoked: product?.grant }
    }

    #parsePayload(raw) {
        if (typeof raw !== 'string') return null
        let parsed
        try {
            parsed = JSON.parse(raw)
        } catch {
            return null
        }
        if (!parsed || typeof parsed.c !== 'string' || typeof parsed.p !== 'string') return null
        if (!PRODUCTS[parsed.p]) return null
        return parsed
    }
}

module.exports = StarsStore
module.exports.PRODUCTS = PRODUCTS
module.exports.MONTH_SECONDS = MONTH_SECONDS
module.exports.CURRENCY = CURRENCY
