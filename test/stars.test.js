const test = require('node:test')
const assert = require('node:assert')
const h = require('./helpers')
const StarsStore = require('../src/telegram/stars/StarsStore')
const { key, TELEGRAM } = require('../src/core/PlatformKey')
const premiumManager = require('../src/premium/PremiumManager')

test.before(async () => { await h.ready() })

function mockTelegram() {
    const calls = { links: [], preCheckout: [], refunds: [] }
    return {
        calls,
        async createInvoiceLink(params) {
            calls.links.push(params)
            return `https://t.me/$invoice_${params.title.replace(/\s/g, '_')}`
        },
        async callApi(method, payload) {
            if (method === 'answerPreCheckoutQuery') calls.preCheckout.push(payload)
            if (method === 'refundStarPayment') calls.refunds.push(payload)
            return true
        }
    }
}

function store(telegram = mockTelegram()) {
    const s = new StarsStore(telegram)
    // Independent of whatever the local config prices things at.
    s.enabled = true
    s.prices = {
        subscriptionTier1: 350, subscriptionTier2: 700,
        credits100: 200, credits500: 700, credits2000: 1750, csvUnlock: 2800
    }
    return s
}

let charge = 0
const nextCharge = () => `charge_${++charge}_${Date.now()}`

function payment(communityKey, product, extra = {}) {
    return {
        currency: 'XTR',
        total_amount: 200,
        invoice_payload: JSON.stringify({ c: communityKey, p: product }),
        telegram_payment_charge_id: nextCharge(),
        ...extra
    }
}

// --------------------------------------------------------------------------
// invoices
// --------------------------------------------------------------------------

test('digital goods are always priced in Stars', async () => {
    const tg = mockTelegram()
    await store(tg).createLink('credits100', key(TELEGRAM, -100))
    assert.strictEqual(tg.calls.links[0].currency, 'XTR',
        'Telegram requires XTR for digital goods sold in-app')
})

test('only the subscriptions carry a billing period', async () => {
    const tg = mockTelegram()
    const s = store(tg)
    await s.createLink('subscriptionTier1', key(TELEGRAM, -100))
    await s.createLink('credits500', key(TELEGRAM, -100))

    assert.strictEqual(tg.calls.links[0].subscription_period, StarsStore.MONTH_SECONDS)
    assert.strictEqual(tg.calls.links[1].subscription_period, undefined,
        'a credit pack is a one-off, not a subscription')
})

test('the invoice payload carries the community, so a purchase lands in the right place', async () => {
    const tg = mockTelegram()
    const chat = key(TELEGRAM, -100777)
    await store(tg).createLink('csvUnlock', chat)
    assert.deepStrictEqual(JSON.parse(tg.calls.links[0].payload), { c: chat, p: 'csvUnlock' })
})

test('an unpriced or unknown product cannot be sold', async () => {
    const s = store()
    s.prices = { credits100: 200 }
    await assert.rejects(() => s.createLink('subscriptionTier1', key(TELEGRAM, -1)), /no Star price/)
    await assert.rejects(() => s.createLink('nonsense', key(TELEGRAM, -1)), /unknown product/)
})

test('the catalog hides products this deployment has not priced', () => {
    const s = store()
    s.prices = { credits100: 200, csvUnlock: 0 }
    assert.deepStrictEqual(s.catalog().map(p => p.id), ['credits100'])
})

// --------------------------------------------------------------------------
// pre-checkout
// --------------------------------------------------------------------------

test('a valid pre-checkout is approved', async () => {
    const tg = mockTelegram()
    const ok = await store(tg).answerPreCheckout({
        id: 'q1', invoice_payload: JSON.stringify({ c: key(TELEGRAM, -100), p: 'credits100' })
    })
    assert.strictEqual(ok, true)
    assert.strictEqual(tg.calls.preCheckout[0].ok, true)
    assert.strictEqual(tg.calls.preCheckout[0].pre_checkout_query_id, 'q1')
})

test('a malformed pre-checkout is declined rather than silently charged', async () => {
    const tg = mockTelegram()
    const s = store(tg)
    for (const bad of ['not json', JSON.stringify({ c: 't:-1' }), JSON.stringify({ c: 't:-1', p: 'ghost' })]) {
        assert.strictEqual(await s.answerPreCheckout({ id: 'q', invoice_payload: bad }), false)
    }
    assert.ok(tg.calls.preCheckout.every(c => c.ok === false))
    assert.ok(tg.calls.preCheckout.every(c => typeof c.error_message === 'string'))
})

// --------------------------------------------------------------------------
// applying payments — replay safety is the point
// --------------------------------------------------------------------------

test('a credit pack is granted once, and a redelivery grants nothing', async () => {
    const s = store()
    const chat = h.newCommunity().id
    const user = key(TELEGRAM, 555)
    const p = payment(chat, 'credits100')

    const first = await s.applyPayment(p, user)
    assert.deepStrictEqual(first, { applied: true, product: 'credits100' })
    assert.strictEqual((await h.database.getGuildPremium(chat)).bonusCredits, 100)

    const replay = await s.applyPayment(p, user)
    assert.strictEqual(replay.applied, false)
    assert.strictEqual(replay.reason, 'duplicate')
    assert.strictEqual((await h.database.getGuildPremium(chat)).bonusCredits, 100,
        'Telegram redelivering a payment must never double-credit')
})

test('concurrent deliveries of the same charge grant exactly once', async () => {
    const s = store()
    const chat = h.newCommunity().id
    const p = payment(chat, 'credits500')

    const results = await Promise.all([
        s.applyPayment(p, key(TELEGRAM, 1)),
        s.applyPayment(p, key(TELEGRAM, 1)),
        s.applyPayment(p, key(TELEGRAM, 1))
    ])
    assert.strictEqual(results.filter(r => r.applied).length, 1)
    assert.strictEqual((await h.database.getGuildPremium(chat)).bonusCredits, 500)
})

test('the CSV unlock is applied', async () => {
    const s = store()
    const chat = h.newCommunity().id
    await s.applyPayment(payment(chat, 'csvUnlock'), key(TELEGRAM, 1))
    assert.strictEqual((await h.database.getGuildPremium(chat)).csvUnlocked, true)
    assert.strictEqual((await premiumManager.canUseCSVFeature(chat, null)).allowed, true)
})

test('a subscription uses the expiry Telegram reports', async () => {
    const s = store()
    const chat = h.newCommunity().id
    const expiry = Math.floor((Date.now() + 40 * 24 * 3600 * 1000) / 1000)
    await s.applyPayment(payment(chat, 'subscriptionTier2', {
        subscription_expiration_date: expiry, is_recurring: true, is_first_recurring: true
    }), key(TELEGRAM, 1))

    const premium = await h.database.getGuildPremium(chat)
    assert.strictEqual(premium.subscriptionTier, 'tier2')
    assert.strictEqual(premium.subscriptionExpiresAt, expiry * 1000,
        'not a locally-computed 30 days — Telegram decides what was billed for')
})

test('a renewal extends the subscription rather than stacking a second one', async () => {
    const s = store()
    const chat = h.newCommunity().id
    const first = Math.floor((Date.now() + 30 * 24 * 3600 * 1000) / 1000)
    const second = Math.floor((Date.now() + 60 * 24 * 3600 * 1000) / 1000)

    await s.applyPayment(payment(chat, 'subscriptionTier1', { subscription_expiration_date: first, is_recurring: true, is_first_recurring: true }), key(TELEGRAM, 1))
    await s.applyPayment(payment(chat, 'subscriptionTier1', { subscription_expiration_date: second, is_recurring: true }), key(TELEGRAM, 1))

    const premium = await h.database.getGuildPremium(chat)
    assert.strictEqual(premium.subscriptionExpiresAt, second * 1000)
    assert.strictEqual(premium.subscriptionTier, 'tier1')
})

test('a subscription lifts the mail quota, exactly as a Discord entitlement does', async () => {
    const s = store()
    const chat = h.newCommunity().id
    await new Promise((resolve, reject) => h.database.db.run(
        'INSERT OR REPLACE INTO guild_stats (guildID, mailsSentMonth, statsMonth) VALUES (?, ?, ?)',
        [chat, premiumManager.freeMonthlyLimit + 100, h.database.getCurrentMonth()],
        (e) => e ? reject(e) : resolve()
    ))
    await s.applyPayment(payment(chat, 'subscriptionTier1', {
        subscription_expiration_date: Math.floor((Date.now() + 30 * 24 * 3600 * 1000) / 1000)
    }), key(TELEGRAM, 1))

    const gate = await premiumManager.canSendMail(chat, null)
    assert.strictEqual(gate.allowed, true)
    assert.strictEqual(gate.source, 'subscription')
})

test('a payment with a payload we cannot trust grants nothing', async () => {
    const s = store()
    for (const bad of [{ invoice_payload: 'garbage', telegram_payment_charge_id: 'x' },
                       { invoice_payload: JSON.stringify({ c: 't:-1', p: 'ghost' }), telegram_payment_charge_id: 'y' }]) {
        const r = await s.applyPayment(bad, key(TELEGRAM, 1))
        assert.strictEqual(r.applied, false)
    }
    const noCharge = await s.applyPayment(
        { invoice_payload: JSON.stringify({ c: h.newCommunity().id, p: 'credits100' }) }, key(TELEGRAM, 1))
    assert.strictEqual(noCharge.reason, 'no_charge_id',
        'without a charge id there is no way to make the grant idempotent')
})

// --------------------------------------------------------------------------
// refunds
// --------------------------------------------------------------------------

test('refunding a subscription revokes it', async () => {
    const tg = mockTelegram()
    const s = store(tg)
    const chat = h.newCommunity().id
    const p = payment(chat, 'subscriptionTier1', {
        subscription_expiration_date: Math.floor((Date.now() + 30 * 24 * 3600 * 1000) / 1000)
    })
    await s.applyPayment(p, key(TELEGRAM, 4242))

    const r = await s.refund(key(TELEGRAM, 4242), p.telegram_payment_charge_id)
    assert.strictEqual(r.ok, true)
    assert.deepStrictEqual(tg.calls.refunds[0], {
        user_id: 4242, telegram_payment_charge_id: p.telegram_payment_charge_id
    })
    assert.strictEqual((await h.database.getGuildPremium(chat)).subscriptionTier, null)
})

test('a charge cannot be refunded twice, and an unknown charge is refused', async () => {
    const tg = mockTelegram()
    const s = store(tg)
    const chat = h.newCommunity().id
    const p = payment(chat, 'credits100')
    await s.applyPayment(p, key(TELEGRAM, 7))

    assert.strictEqual((await s.refund(key(TELEGRAM, 7), p.telegram_payment_charge_id)).ok, true)
    const again = await s.refund(key(TELEGRAM, 7), p.telegram_payment_charge_id)
    assert.strictEqual(again.ok, false)
    assert.strictEqual(again.reason, 'already_refunded')
    assert.strictEqual(tg.calls.refunds.length, 1, 'Telegram is only asked to refund once')

    const unknown = await s.refund(key(TELEGRAM, 7), 'never_seen')
    assert.strictEqual(unknown.reason, 'unknown_charge')
})

test('selling is refused outright when Stars are not enabled', async () => {
    const s = new StarsStore(mockTelegram())
    s.enabled = false
    await assert.rejects(() => s.createLink('credits100', key(TELEGRAM, -1)), /enabled is false/)
})
