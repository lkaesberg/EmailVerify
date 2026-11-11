// SPDX-License-Identifier: AGPL-3.0-or-later
require('./helpers/env')
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')

const database = require('../src/database/Database')
const EmailUser = require('../src/database/EmailUser')
const { takeEmailOwnership } = require('../src/utils/resolveVerificationRoles')

const GUILD = 'g1'
const user = (email, userID) => new EmailUser(email, userID, GUILD, 'role', 0)
const owner = (email) => database.getEmailOwnerId(email, GUILD)
const rows = (email) => new Promise((resolve, reject) => database.db.all(
    'SELECT * FROM userEmails WHERE email = ? AND guildID = ?', [email, GUILD], (e, r) => e ? reject(e) : resolve(r)))

before(async () => {
    assert.equal(await database.migrated, true)
})
after(() => new Promise((resolve) => database.db.close(() => resolve())))

test('swapEmailOwner only writes when the owner is still the expected one', async () => {
    assert.equal(await database.swapEmailOwner(user('cas', 'P'), null), 'ok')
    // Somebody else read "no owner" too: their insert must not replace P.
    assert.equal(await database.swapEmailOwner(user('cas', 'Q'), null), 'conflict')
    assert.equal(await owner('cas'), 'P')
    assert.equal(await database.swapEmailOwner(user('cas', 'Q'), 'R'), 'conflict')
    assert.equal(await owner('cas'), 'P')
    assert.equal(await database.swapEmailOwner(user('cas', 'Q'), 'P'), 'ok')
    assert.equal(await owner('cas'), 'Q')
    assert.equal((await rows('cas')).length, 1)
})

test('swapEmailOwner treats a row with no userID as unowned', async () => {
    await new Promise((resolve, reject) => database.db.run(
        'INSERT INTO userEmails (email, userID, guildID, groupID, isPublic) VALUES (?, NULL, ?, ?, 0)', ['nullrow', GUILD, 'role'], (e) => e ? reject(e) : resolve()))
    assert.equal(await database.swapEmailOwner(user('nullrow', 'P'), null), 'ok')
    assert.equal(await owner('nullrow'), 'P')
})

test('takeEmailOwnership reports the owner it replaced', async () => {
    assert.deepEqual(await takeEmailOwnership(user('seq', 'P')), { owned: true, previousHolderId: null })
    assert.deepEqual(await takeEmailOwnership(user('seq', 'Q')), { owned: true, previousHolderId: 'P' })
    // Re-verifying with one's own address displaces nobody.
    assert.deepEqual(await takeEmailOwnership(user('seq', 'Q')), { owned: true, previousHolderId: null })
    assert.equal(await owner('seq'), 'Q')
})

test('a verification that read the owner before another landed still displaces it', async () => {
    // The e2e race: P and Q both read "no owner", P writes first. Q's stale read must
    // not let it overwrite P silently; it has to name P as the holder it displaced.
    assert.equal(await database.swapEmailOwner(user('race', 'P'), null), 'ok')
    const realGet = database.getEmailOwnerId
    let calls = 0
    database.getEmailOwnerId = async (...args) => (calls++ === 0 ? null : realGet.apply(database, args))
    try {
        assert.deepEqual(await takeEmailOwnership(user('race', 'Q')), { owned: true, previousHolderId: 'P' })
    } finally {
        database.getEmailOwnerId = realGet
    }
    assert.equal(calls, 2)
    assert.equal(await owner('race'), 'Q')
})

test('concurrent verifications of one address: the final owner displaced the other', async () => {
    for (let i = 0; i < 20; i++) {
        const email = `concurrent-${i}`
        const [p, q] = await Promise.all([takeEmailOwnership(user(email, 'P')), takeEmailOwnership(user(email, 'Q'))])
        assert.ok(p.owned && q.owned)
        const finalOwner = await owner(email)
        const winner = finalOwner === 'P' ? p : q
        const loser = finalOwner === 'P' ? q : p
        assert.equal(winner.previousHolderId, finalOwner === 'P' ? 'Q' : 'P', `iteration ${i}`)
        assert.equal(loser.previousHolderId, null, `iteration ${i}`)
    }
})

test('takeEmailOwnership gives up without writing on a DB error', async () => {
    const realSwap = database.swapEmailOwner
    database.swapEmailOwner = async () => 'error'
    try {
        assert.deepEqual(await takeEmailOwnership(user('err', 'P')), { owned: false, previousHolderId: null })
    } finally {
        database.swapEmailOwner = realSwap
    }
    const realGet = database.getEmailOwnerId
    database.getEmailOwnerId = async () => { throw new Error('boom') }
    try {
        assert.deepEqual(await takeEmailOwnership(user('err', 'P')), { owned: false, previousHolderId: null })
    } finally {
        database.getEmailOwnerId = realGet
    }
    assert.equal(await owner('err'), null)
})
