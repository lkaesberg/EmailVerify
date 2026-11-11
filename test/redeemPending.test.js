// SPDX-License-Identifier: AGPL-3.0-or-later
require('./helpers/env')
const { test, after, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const database = require('../src/database/Database')
const premiumManager = require('../src/premium/PremiumManager')
const { getLocale } = require('../src/Language')

after(async () => {
    await database.migrated
    await new Promise((resolve) => database.db.close(() => resolve()))
})

const real = {}
beforeEach(() => {
    for (const k of ['claimEntitlementRedemption', 'grantEntitlementRedemption', 'releaseEntitlementRedemption']) real[k] = database[k]
    database.claimEntitlementRedemption = async () => Date.now()
    database.releaseEntitlementRedemption = async () => {}
})
afterEach(() => Object.assign(database, real))

function interactionWith(...entitlements) {
    return {
        user: { id: 'buyer' },
        guild: { name: 'Test' },
        client: { application: { entitlements: { fetch: async () => new Map(entitlements.map((e) => [e.id, e])) } } }
    }
}
const entitlement = (id, skuId, consume = async () => {}) => ({ id, skuId, consumed: false, consume })

for (const language of ['english', 'german']) {
    test(`a grant left pending after consume is reported as on its way (${language})`, async () => {
        database.grantEntitlementRedemption = async () => { throw new Error('SQLITE_BUSY: database is locked') }
        const results = await premiumManager.redeemEntitlements(
            interactionWith(entitlement('e1', 'sku-credits100'), entitlement('e2', 'sku-csv')), 'guild', language)
        assert.deepEqual(results.details, [
            getLocale(language, 'premiumRedeemCreditsPending', '100'),
            getLocale(language, 'premiumRedeemCsvPending')
        ])
        assert.equal(results.pending, true)
        assert.equal(results.creditsAdded, 0)
        assert.equal(results.csvUnlocked, false)
        for (const d of results.details) assert.ok(!d.startsWith('❌'), d)
    })
}

test('a grant that was no longer claimable after consume is also pending', async () => {
    database.grantEntitlementRedemption = async () => false
    const results = await premiumManager.redeemEntitlements(interactionWith(entitlement('e3', 'sku-credits500')), 'guild', 'english')
    assert.deepEqual(results.details, [getLocale('english', 'premiumRedeemCreditsPending', '500')])
    assert.equal(results.pending, true)
})

test('a consume that fails is still reported as a failure', async () => {
    database.grantEntitlementRedemption = async () => { throw new Error('must not grant') }
    const results = await premiumManager.redeemEntitlements(interactionWith(
        entitlement('e4', 'sku-credits100', async () => { throw new Error('403') }),
        entitlement('e5', 'sku-csv', async () => { throw new Error('403') })), 'guild', 'english')
    assert.deepEqual(results.details, [
        getLocale('english', 'premiumRedeemCreditsFailed', '100'),
        getLocale('english', 'premiumRedeemCsvFailed')
    ])
    assert.equal(results.pending, false)
})

test('every language has the pending strings with the amount placeholder', () => {
    const fs = require('fs')
    const path = require('path')
    const dir = path.join(__dirname, '..', 'language')
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const table = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
        assert.match(table.premiumRedeemCreditsPending || '', /%VAR%/, file)
        assert.ok(table.premiumRedeemCsvPending, file)
    }
})
