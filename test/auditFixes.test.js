// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// Regression cover for the defects found in the 2026-08 audit. Each test here fails
// against the behaviour that was shipped before the corresponding fix.

const test = require('node:test')
const assert = require('node:assert')
const h = require('./helpers')
const VerificationService = require('../src/core/VerificationService')
const TelegramBot = require('../src/telegram/TelegramBot')
const md5hash = require('../src/crypto/Crypto')

const USER = 'u-audit'

function makeService(opts = {}) {
    const transport = opts.transport || h.fakeTransport()
    const authorizer = opts.authorizer || h.fakeAuthorizer()
    const notifier = opts.notifier || h.fakeNotifier()
    const svc = new VerificationService({
        platform: 'telegram',
        mailTransport: transport,
        authorizer,
        notifier
    })
    return { svc, transport, authorizer, notifier }
}

async function issueCode(svc, community, settings, email = 'student@uni.de', userID = USER) {
    const r = await svc.submitEmail({ community, settings, userID, email })
    assert.strictEqual(r.outcome, 'code_sent', `expected code_sent, got ${r.outcome}`)
    return (await svc.peekPending(community.id, userID)).code
}

test.before(async () => { await h.ready() })

// --------------------------------------------------------------------------
// Address validation
// --------------------------------------------------------------------------

test('malformed addresses never reach the mail transport', async () => {
    const { svc, transport } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: [community.id], domains: [] }, community.id)

    // Every one of these passed the old "one @ and no space" check.
    const malformed = [
        '@uni.de',            // no local part
        'student@',           // no domain
        'student@uni',        // no TLD
        'student@uni.',       // trailing dot
        'student@.de',        // empty label
        'a@b@uni.de',         // two @ — caught before, kept for cover
        'student\n@uni.de',   // CRLF: whitespace that isn't a space
        'stu dent@uni.de',
        '<student@uni.de>'
    ]

    for (const email of malformed) {
        const r = await svc.submitEmail({ community, settings, userID: USER, email })
        assert.strictEqual(r.outcome, 'invalid_email', `${JSON.stringify(email)} should be rejected`)
        assert.strictEqual(r.reason, 'invalid_format', `${JSON.stringify(email)} is a format problem`)
    }
    assert.strictEqual(transport.sends.length, 0, 'nothing was handed to the mail provider')
})

test('ordinary addresses still get through', async () => {
    const { svc } = makeService()
    // A community each, so the monthly free quota (1 locally, 25 in CI) never decides
    // the outcome of a test about address parsing.
    for (const email of ['student@uni.de', 'first.last+tag@sub.uni.ac.uk', 'o_brien@uni.de']) {
        const community = h.newCommunity()
        const settings = h.settings({ managedChats: [community.id], domains: [] }, community.id)
        const r = await svc.submitEmail({ community, settings, userID: USER, email })
        assert.strictEqual(r.outcome, 'code_sent', `${email} should be accepted`)
    }
})

// --------------------------------------------------------------------------
// Grant ordering
// --------------------------------------------------------------------------

test('a failed grant leaves the previous holder alone and records no verification', async () => {
    const authorizer = h.fakeAuthorizer({
        async grant() { return { ok: false, detail: 'grant_error', labels: [] } }
    })
    const { svc } = makeService({ authorizer })
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: [community.id], domains: [] }, community.id)

    const email = 'student@uni.de'
    const code = await issueCode(svc, community, settings, email)
    const r = await svc.submitCode({ community, settings, userID: USER, code })

    assert.strictEqual(r.outcome, 'authorization_failed')
    // Both of these used to happen *before* the grant was attempted, so a failure
    // kicked whoever held the address and claimed a verification that never happened.
    assert.deepStrictEqual(authorizer.calls.revokePrevious, [],
        'the previous holder keeps their access when the new grant fails')
    const row = await new Promise(res => h.database.getEmailUser(md5hash(email), community.id, res))
    assert.strictEqual(row, null, 'no verified-user row is written for a failed grant')
    // And the code survives so the user can simply try again.
    assert.ok(await svc.peekPending(community.id, USER), 'the pending code is restored')
})

test('a successful grant still revokes the previous holder and records the user', async () => {
    const { svc, authorizer } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: [community.id], domains: [] }, community.id)
    // Two sends into one community; credits keep the free quota out of the way.
    await h.database.addGuildCredits(community.id, 10)

    const email = 'shared@uni.de'
    const first = await issueCode(svc, community, settings, email, 'user-one')
    assert.strictEqual((await svc.submitCode({ community, settings, userID: 'user-one', code: first })).outcome, 'success')

    const second = await issueCode(svc, community, settings, email, 'user-two')
    assert.strictEqual((await svc.submitCode({ community, settings, userID: 'user-two', code: second })).outcome, 'success')

    // The hook fires once per successful verification — the authorizer is what decides
    // whether there is actually a previous holder to strip. What matters here is that
    // it fires at all after the reordering, and that it names the new owner.
    assert.strictEqual(authorizer.calls.revokePrevious.length, 2, 'once per successful verification')
    assert.strictEqual(authorizer.calls.revokePrevious.at(-1).newUserID, 'user-two')
    const row = await h.waitForEmailUser(md5hash(email), community.id)
    assert.strictEqual(row.userID, 'user-two', 'the address now belongs to the second user')
})

// --------------------------------------------------------------------------
// Code comparison and rate-limiter housekeeping
// --------------------------------------------------------------------------

test('a wrong code of a different length is still just a wrong code', async () => {
    const { svc } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: [community.id], domains: [] }, community.id)
    await issueCode(svc, community, settings)

    // Constant-time comparison has to handle unequal lengths without throwing.
    for (const guess of ['1', '', '1234567890123']) {
        const r = await svc.submitCode({ community, settings, userID: USER, code: guess })
        assert.strictEqual(r.outcome, 'wrong_code', `${JSON.stringify(guess)} is wrong, not an error`)
    }
})

test('pruneRateLimits drops entries whose backoff is long past', async () => {
    const { svc } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: [community.id], domains: [] }, community.id)
    await svc.submitEmail({ community, settings, userID: USER, email: 'student@uni.de' })
    assert.strictEqual(svc.userTimeouts.size, 1, 'the send registered a rate-limiter entry')

    svc.pruneRateLimits(Date.now())
    assert.strictEqual(svc.userTimeouts.size, 1, 'a fresh entry is kept')

    svc.pruneRateLimits(Date.now() + VerificationService.RATE_LIMIT_IDLE_MS + 60_000)
    assert.strictEqual(svc.userTimeouts.size, 0, 'a long-idle entry is swept')
})

// --------------------------------------------------------------------------
// Data deletion
// --------------------------------------------------------------------------

test('deleting user data removes the pending row, plaintext address and all', async () => {
    const { svc } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: [community.id], domains: [] }, community.id)
    await issueCode(svc, community, settings, 'leaver@uni.de', 'user-leaving')

    h.database.deleteUserData('user-leaving')
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(await svc.peekPending(community.id, 'user-leaving'), null,
        'pending_verifications is the only table holding a plaintext address')
})

test('deleting server data clears pending rows but keeps paid-for credits', async () => {
    const { svc } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: [community.id], domains: [] }, community.id)
    await h.database.addGuildCredits(community.id, 100)
    await issueCode(svc, community, settings, 'someone@uni.de', 'user-x')

    h.database.deleteServerData(community.id)
    await new Promise(r => setTimeout(r, 50))

    assert.strictEqual(await svc.peekPending(community.id, 'user-x'), null, 'pending codes go')
    const premium = await h.database.getGuildPremium(community.id)
    assert.strictEqual(premium.bonusCredits, 100,
        'credits are paid for and must survive the bot being removed and re-added')
})

// --------------------------------------------------------------------------
// Telegram wiring
// --------------------------------------------------------------------------

test('chat_member is in the requested update types', () => {
    // Telegram's default (an empty allowed_updates) excludes chat_member, which left
    // the `mute` gate blind to every arrival.
    assert.ok(TelegramBot.ALLOWED_UPDATES.includes('chat_member'),
        'the mute gate cannot work without it')
    for (const type of ['message', 'pre_checkout_query', 'chat_join_request']) {
        assert.ok(TelegramBot.ALLOWED_UPDATES.includes(type), `${type} is still handled`)
    }
})
