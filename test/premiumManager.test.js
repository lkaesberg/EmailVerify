const test = require('node:test')
const assert = require('node:assert')
const h = require('./helpers')
const premiumManager = require('../src/premium/PremiumManager')

test.before(async () => { await h.ready() })

// With monetization off, canSendMail short-circuits to { source: 'disabled' } and
// there is no quota to test. Skip rather than assert something config-dependent.
const quota = { skip: premiumManager.enabled ? false : 'monetization disabled in this config' }

/** Park a community's monthly send count wherever the test needs it. */
function setMonthlySends(guildID, count) {
    return new Promise((resolve, reject) => h.database.db.run(
        'INSERT OR REPLACE INTO guild_stats (guildID, mailsSentMonth, statsMonth) VALUES (?, ?, ?)',
        [guildID, count, h.database.getCurrentMonth()],
        (e) => e ? reject(e) : resolve()
    ))
}

test('a fresh community sends on its free allowance', quota, async () => {
    const { id } = h.newCommunity()
    await setMonthlySends(id, 0)
    const r = await premiumManager.canSendMail(id, null)
    assert.strictEqual(r.allowed, true)
    assert.strictEqual(r.source, 'free')
})

test('credits take over once the free allowance is spent', quota, async () => {
    const { id } = h.newCommunity()
    await setMonthlySends(id, premiumManager.freeMonthlyLimit + 5)
    await h.database.addGuildCredits(id, 2)

    const r = await premiumManager.canSendMail(id, null)
    assert.strictEqual(r.allowed, true)
    assert.strictEqual(r.source, 'credits')

    const after = await h.database.getGuildPremium(id)
    assert.strictEqual(after.bonusCredits, 1, 'the credit is consumed atomically by the check')
})

test('no allowance and no credits is a denial that reports the numbers', quota, async () => {
    const { id } = h.newCommunity()
    await setMonthlySends(id, premiumManager.freeMonthlyLimit + 5)
    const r = await premiumManager.canSendMail(id, null)
    assert.strictEqual(r.allowed, false)
    assert.strictEqual(r.reason, 'limit_reached')
    assert.strictEqual(r.freeLimit, premiumManager.freeMonthlyLimit)
    assert.ok(r.mailsSentMonth > premiumManager.freeMonthlyLimit)
})

test('a stored subscription bypasses the quota entirely', quota, async () => {
    const { id } = h.newCommunity()
    await setMonthlySends(id, premiumManager.freeMonthlyLimit + 999)
    await h.database.setGuildSubscription(id, { tier: 'tier1', expiresAt: Date.now() + 86400000, chargeId: 'c1' })

    const r = await premiumManager.canSendMail(id, null)
    assert.strictEqual(r.allowed, true)
    assert.strictEqual(r.source, 'subscription')
})

test('a lapsed subscription stops counting immediately, without waiting for the sweep', quota, async () => {
    const { id } = h.newCommunity()
    await setMonthlySends(id, premiumManager.freeMonthlyLimit + 999)
    await h.database.setGuildSubscription(id, { tier: 'tier1', expiresAt: Date.now() - 1, chargeId: 'c1' })

    const r = await premiumManager.canSendMail(id, null)
    assert.strictEqual(r.allowed, false, 'an expired subscription is not a subscription')
})

test('Discord entitlements still win over stored state', async () => {
    const { id } = h.newCommunity()
    const skus = require('../config/config.json').monetization.skus
    const entitlements = { size: 1, some: (fn) => fn({ skuId: skus.subscriptionTier2 }) }
    assert.strictEqual(premiumManager.resolveTier(entitlements, { subscriptionTier: null }), 'tier2')
    // And a stored tier is used when there are no entitlements, which is the Telegram case.
    assert.strictEqual(premiumManager.resolveTier(null, { subscriptionTier: 'tier1' }), 'tier1')
    assert.strictEqual(premiumManager.resolveTier(null, {}), null)
})

test('CSV access comes from tier2, a one-off unlock, or neither', quota, async () => {
    const a = h.newCommunity().id
    assert.strictEqual((await premiumManager.canUseCSVFeature(a, null)).allowed, false)

    await h.database.unlockGuildCSV(a)
    assert.strictEqual((await premiumManager.canUseCSVFeature(a, null)).allowed, true, 'one-off unlock')

    const b = h.newCommunity().id
    await h.database.setGuildSubscription(b, { tier: 'tier2', expiresAt: Date.now() + 86400000 })
    assert.strictEqual((await premiumManager.canUseCSVFeature(b, null)).allowed, true, 'tier2 includes CSV')

    const c = h.newCommunity().id
    await h.database.setGuildSubscription(c, { tier: 'tier1', expiresAt: Date.now() + 86400000 })
    assert.strictEqual((await premiumManager.canUseCSVFeature(c, null)).allowed, false, 'tier1 does not')
})

test('the run-out forecast renders per platform', () => {
    const date = new Date(Date.UTC(2026, 8, 14))
    assert.match(premiumManager.discordDate(date), /^<t:\d+:D>$/)
    assert.strictEqual(premiumManager.plainDate(date), '2026-09-14')
})

test('the expiry sweep clears only lapsed subscriptions', async () => {
    const live = h.newCommunity().id
    const dead = h.newCommunity().id
    await h.database.setGuildSubscription(live, { tier: 'tier1', expiresAt: Date.now() + 86400000 })
    await h.database.setGuildSubscription(dead, { tier: 'tier1', expiresAt: Date.now() - 1000 })

    await h.database.expireLapsedSubscriptions()

    assert.strictEqual((await h.database.getGuildPremium(live)).subscriptionTier, 'tier1')
    assert.strictEqual((await h.database.getGuildPremium(dead)).subscriptionTier, null)
})
