const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')
const config = require('../../config/config.json')

const skus = config.monetization?.skus || {}
const appId = config.clientId
const websiteUrl = (config.websiteUrl || '').trim()

// Reverse map: Discord SKU snowflake → operator-facing product metadata. Built
// once from config so logs and notifications can show "⭐ Standard subscription"
// instead of a raw SKU id. Unset/empty SKU ids in config are skipped, so an
// unconfigured product never collides on an empty-string key.
const SKU_CATALOG = {}
function registerSku(skuId, meta) {
    if (typeof skuId === 'string' && skuId.trim().length > 0) SKU_CATALOG[skuId] = meta
}
registerSku(skus.subscriptionTier1, { label: '⭐ Standard subscription', kind: 'subscription' })
registerSku(skus.subscriptionTier2, { label: '💎 Pro subscription', kind: 'subscription' })
registerSku(skus.credits100, { label: '🎟️ 100 Credit Pack', kind: 'credits', credits: 100 })
registerSku(skus.credits500, { label: '🎟️ 500 Credit Pack', kind: 'credits', credits: 500 })
registerSku(skus.credits2000, { label: '🎟️ 2,000 Credit Pack', kind: 'credits', credits: 2000 })
registerSku(skus.csvUnlock, { label: '📁 CSV unlock', kind: 'csv' })

/**
 * Resolve a SKU id to its operator-facing product info.
 * @param {string} skuId
 * @returns {{label:string, kind:'subscription'|'credits'|'csv', credits?:number}|null}
 */
function describeSku(skuId) {
    return SKU_CATALOG[skuId] || null
}

function getWebsiteUrl() {
    return websiteUrl || null
}

/**
 * Build a public Discord store URL for a SKU.
 * Useful for hyperlink fallbacks when a Premium button can't be rendered.
 */
function storeUrl(skuId) {
    if (!appId || !skuId) return null
    return `https://discord.com/application-directory/${appId}/store/${skuId}`
}

function appStoreUrl() {
    if (!appId) return null
    return `https://discord.com/application-directory/${appId}/store`
}

function premiumButton(skuId) {
    return new ButtonBuilder().setStyle(ButtonStyle.Premium).setSKUId(skuId)
}

/**
 * Build action rows offering relevant SKUs as Premium buttons.
 *
 * @param {{ subscriptionTier: 'tier1'|'tier2'|null, csvUnlocked: boolean }} status
 * @param {{ context?: 'status'|'mailLimit'|'csvRequired'|'quotaWarn' }} [opts]
 * @returns {ActionRowBuilder[]} 0-2 rows of Premium buttons (≤5 per row)
 */
function buildPlanButtons(status, opts = {}) {
    const context = opts.context || 'status'
    const tier = status.subscriptionTier
    const hasCsv = !!status.csvUnlocked || tier === 'tier2'

    const subscriptions = []
    // In csvRequired context, only Tier 2 actually grants CSV access — don't push
    // Tier 1, which would mislead the user into buying a plan that doesn't help.
    if (context !== 'csvRequired' && !tier && skus.subscriptionTier1) {
        subscriptions.push(skus.subscriptionTier1)
    }
    if (tier !== 'tier2' && skus.subscriptionTier2) {
        subscriptions.push(skus.subscriptionTier2)
    }

    const oneTime = []
    if (!hasCsv && skus.csvUnlock) oneTime.push(skus.csvUnlock)

    const credits = []
    if (skus.credits100) credits.push(skus.credits100)
    if (skus.credits500) credits.push(skus.credits500)
    if (skus.credits2000) credits.push(skus.credits2000)

    // CSV-required prompts shouldn't show credit packs (they're for email quota, not CSV).
    // Mail-limit and quotaWarn prompts shouldn't show CSV unlock (it doesn't unblock email sends).
    const includeCredits = context !== 'csvRequired'
    const includeCsv = context !== 'mailLimit' && context !== 'quotaWarn'

    const rows = []
    const topRow = []
    topRow.push(...subscriptions.map(premiumButton))
    if (includeCsv) topRow.push(...oneTime.map(premiumButton))
    if (topRow.length > 0) rows.push(new ActionRowBuilder().addComponents(topRow.slice(0, 5)))

    if (includeCredits && credits.length > 0) {
        rows.push(new ActionRowBuilder().addComponents(credits.slice(0, 5).map(premiumButton)))
    }

    return rows
}

module.exports = {
    buildPlanButtons,
    storeUrl,
    appStoreUrl,
    getWebsiteUrl,
    describeSku
}
