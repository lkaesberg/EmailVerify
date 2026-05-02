const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')
const config = require('../../config/config.json')

const skus = config.monetization?.skus || {}
const appId = config.clientId

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
 * @param {{ context?: 'status'|'mailLimit'|'csvRequired' }} [opts]
 * @returns {ActionRowBuilder[]} 0-2 rows of Premium buttons (≤5 per row)
 */
function buildPlanButtons(status, opts = {}) {
    const context = opts.context || 'status'
    const tier = status.subscriptionTier
    const hasCsv = !!status.csvUnlocked || tier === 'tier2'

    const subscriptions = []
    if (!tier && skus.subscriptionTier1) subscriptions.push(skus.subscriptionTier1)
    if (tier !== 'tier2' && skus.subscriptionTier2) subscriptions.push(skus.subscriptionTier2)

    const oneTime = []
    if (!hasCsv && skus.csvUnlock) oneTime.push(skus.csvUnlock)

    const credits = []
    if (skus.credits100) credits.push(skus.credits100)
    if (skus.credits500) credits.push(skus.credits500)
    if (skus.credits2000) credits.push(skus.credits2000)

    // CSV-required prompts shouldn't show credit packs (they're for email quota, not CSV).
    // Mail-limit prompts shouldn't show CSV unlock (it doesn't unblock the user's send).
    const includeCredits = context !== 'csvRequired'
    const includeCsv = context !== 'mailLimit'
    const includeSubs = true

    const rows = []
    const topRow = []
    if (includeSubs) topRow.push(...subscriptions.map(premiumButton))
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
    appStoreUrl
}
