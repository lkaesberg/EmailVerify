const test = require('node:test')
const assert = require('node:assert')
const h = require('./helpers')
const VerificationService = require('../src/core/VerificationService')

const USER = 'u-1'

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

/** Drive a community from nothing to "a code is pending", returning that code. */
async function issueCode(svc, community, settings, email = 'student@uni.de', userID = USER) {
    const r = await svc.submitEmail({ community, settings, userID, email })
    assert.strictEqual(r.outcome, 'code_sent', `expected code_sent, got ${r.outcome}`)
    const pending = await svc.peekPending(community.id, userID)
    return pending.code
}

test.before(async () => { await h.ready() })

// --------------------------------------------------------------------------
// submitEmail gate
// --------------------------------------------------------------------------

test('unconfigured community is rejected and admins are nudged', async () => {
    const { svc, notifier } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: [], defaultRoles: [] })
    const r = await svc.submitEmail({ community, settings, userID: USER, email: 'a@uni.de' })
    assert.strictEqual(r.outcome, 'not_configured')
    assert.ok(notifier.names().includes('notConfigured'))
})

test('blacklisted address is rejected before any mail is sent', async () => {
    const { svc, transport } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'], blacklist: ['*@tempmail.*'] })
    const r = await svc.submitEmail({ community, settings, userID: USER, email: 'x@tempmail.io' })
    assert.strictEqual(r.outcome, 'blacklisted')
    assert.strictEqual(transport.sends.length, 0)
})

test('malformed and non-matching addresses are distinguished', async () => {
    const { svc } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'], domains: ['@uni.de'] })

    const bad = await svc.submitEmail({ community, settings, userID: USER, email: 'not-an-email' })
    assert.strictEqual(bad.outcome, 'invalid_email')
    assert.strictEqual(bad.reason, 'invalid_format')

    const wrongDomain = await svc.submitEmail({ community, settings, userID: 'u-2', email: 'a@other.de' })
    assert.strictEqual(wrongDomain.outcome, 'invalid_email')
    assert.strictEqual(wrongDomain.reason, 'domain_not_allowed')
})

test('no domains and no allowlist means default-open', async () => {
    const { svc } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'], domains: [], allowedEmails: [] })
    const r = await svc.submitEmail({ community, settings, userID: USER, email: 'anyone@anywhere.com' })
    assert.strictEqual(r.outcome, 'code_sent')
})

test('purchaser allowlist admits a listed address and refuses an unlisted one', async () => {
    const md5hash = require('../src/crypto/Crypto')
    const { svc } = makeService()
    const community = h.newCommunity()
    // csvUnlocked is required or the list reads as locked; grant it directly.
    await h.database.unlockGuildCSV(community.id)
    const settings = h.settings({
        managedChats: ['c1'],
        domains: [],
        allowedEmails: [md5hash('buyer@gmail.com')]
    })

    const listed = await svc.submitEmail({ community, settings, userID: 'buyer', email: 'Buyer@Gmail.com' })
    assert.strictEqual(listed.outcome, 'code_sent', 'case-insensitive allowlist hit')

    const unlisted = await svc.submitEmail({ community, settings, userID: 'stranger', email: 'nope@gmail.com' })
    assert.strictEqual(unlisted.outcome, 'invalid_email')
})

test('an allowlist without CSV access locks verification entirely', async () => {
    const { svc, notifier } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'], allowedEmails: ['somehash'] })
    const r = await svc.submitEmail({ community, settings, userID: USER, email: 'a@uni.de' })
    assert.strictEqual(r.outcome, 'emaillist_locked')
    assert.ok(notifier.names().includes('emaillistLocked'))
})

test('the rate limiter backs off repeat requests', async () => {
    const { svc } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'] })
    const first = await svc.submitEmail({ community, settings, userID: USER, email: 'a@uni.de' })
    assert.strictEqual(first.outcome, 'code_sent')
    const second = await svc.submitEmail({ community, settings, userID: USER, email: 'a@uni.de' })
    assert.strictEqual(second.outcome, 'rate_limited')
    assert.ok(second.waitSeconds >= 0)
})

test('no code is persisted when delivery fails', async () => {
    const { svc } = makeService({ transport: h.fakeTransport({ ok: false, error: 'mailbox full' }) })
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'] })
    const r = await svc.submitEmail({ community, settings, userID: USER, email: 'a@uni.de' })
    assert.strictEqual(r.outcome, 'mail_failed')
    assert.strictEqual(r.error, 'mailbox full')
    assert.strictEqual(await svc.peekPending(community.id, USER), null,
        'a code the user can never receive would just burn their attempts')
})

// --------------------------------------------------------------------------
// submitCode
// --------------------------------------------------------------------------

test('the right code verifies and grants access', async () => {
    const { svc, authorizer, notifier } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'] })
    const code = await issueCode(svc, community, settings)

    const r = await svc.submitCode({ community, settings, userID: USER, code })
    assert.strictEqual(r.outcome, 'success')
    assert.deepStrictEqual(r.labels, ['Verified'])
    assert.strictEqual(authorizer.calls.grant.length, 1)
    assert.ok(notifier.names().includes('verified'))
    assert.strictEqual(await svc.peekPending(community.id, USER), null, 'code is consumed')
})

test('a wrong code counts an attempt and invalidates at the cap', async () => {
    const { svc } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'] })
    await issueCode(svc, community, settings)

    for (let i = 1; i < VerificationService.MAX_CODE_ATTEMPTS; i++) {
        const r = await svc.submitCode({ community, settings, userID: USER, code: '000000' })
        assert.strictEqual(r.outcome, 'wrong_code', `attempt ${i}`)
        assert.strictEqual(r.attemptsRemaining, VerificationService.MAX_CODE_ATTEMPTS - i)
    }
    const capped = await svc.submitCode({ community, settings, userID: USER, code: '000000' })
    assert.strictEqual(capped.outcome, 'too_many_attempts')
    assert.strictEqual(await svc.peekPending(community.id, USER), null,
        'the code is destroyed at the cap so it cannot be brute-forced further')
})

test('the correct code stops working once the attempt cap is hit', async () => {
    const { svc } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'] })
    const code = await issueCode(svc, community, settings)

    for (let i = 0; i < VerificationService.MAX_CODE_ATTEMPTS; i++) {
        await svc.submitCode({ community, settings, userID: USER, code: '000000' })
    }
    const r = await svc.submitCode({ community, settings, userID: USER, code })
    assert.strictEqual(r.outcome, 'expired')
})

test('an expired code is refused', async () => {
    const { svc } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'] })
    const code = await issueCode(svc, community, settings)

    // Backdate the row past its TTL rather than waiting 15 real minutes.
    await new Promise((resolve, reject) => h.database.db.run(
        'UPDATE pending_verifications SET expiresAt = ? WHERE userID = ? AND guildID = ?',
        [Date.now() - 1000, USER, community.id],
        (e) => e ? reject(e) : resolve()
    ))

    const r = await svc.submitCode({ community, settings, userID: USER, code })
    assert.strictEqual(r.outcome, 'expired')
})

test('a code can only be redeemed once, even by concurrent submissions', async () => {
    const { svc, authorizer } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'] })
    const code = await issueCode(svc, community, settings)
    const pending = { code, emailHash: 'h', logEmail: 'student@uni.de', expiresAt: Date.now() + 60000, attempts: 0 }

    // Both racers read the same pending row, as two shards would.
    const [a, b] = await Promise.all([
        svc.submitCode({ community, settings, userID: USER, code, pending }),
        svc.submitCode({ community, settings, userID: USER, code, pending })
    ])
    const outcomes = [a.outcome, b.outcome].sort()
    assert.deepStrictEqual(outcomes, ['expired', 'success'],
        'exactly one submission wins the atomic consume')
    assert.strictEqual(authorizer.calls.grant.length, 1, 'access is granted exactly once')
})

test('a failed grant restores the code so the user need not re-request one', async () => {
    const failing = h.fakeAuthorizer({
        async grant() { return { ok: false, detail: 'role_add_error' } }
    })
    const { svc, notifier } = makeService({ authorizer: failing })
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'] })
    const code = await issueCode(svc, community, settings)

    const r = await svc.submitCode({ community, settings, userID: USER, code })
    assert.strictEqual(r.outcome, 'authorization_failed')
    assert.strictEqual(r.detail, 'role_add_error')
    assert.ok(notifier.names().includes('authorizationFailed'))

    const restored = await svc.peekPending(community.id, USER)
    assert.ok(restored, 'the pending row is restored')
    assert.strictEqual(restored.code, code, 'the same code still works after the admin fixes permissions')
})

test('a config that resolves to no grants fails loudly instead of verifying nobody', async () => {
    const empty = h.fakeAuthorizer({
        resolve() { return { targets: {}, count: 0, expected: true, primaryId: '' } }
    })
    const { svc } = makeService({ authorizer: empty })
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'] })
    const code = await issueCode(svc, community, settings)

    const r = await svc.submitCode({ community, settings, userID: USER, code })
    assert.strictEqual(r.outcome, 'authorization_failed')
    assert.strictEqual(r.detail, 'no_targets_resolved')
    assert.ok(await svc.peekPending(community.id, USER), 'code restored')
})

// --------------------------------------------------------------------------
// resendCode
// --------------------------------------------------------------------------

test('resend is refused inside the cooldown and re-mails the same address after it', async () => {
    const { svc, transport } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'] })
    // Credits make the second send admissible whatever freeMonthlyLimit is set to.
    await h.database.addGuildCredits(community.id, 10)
    await issueCode(svc, community, settings, 'student@uni.de')

    const tooSoon = await svc.resendCode({ community, settings, userID: USER })
    assert.strictEqual(tooSoon.outcome, 'cooldown')
    assert.ok(tooSoon.waitSeconds > 0 && tooSoon.waitSeconds <= 60)

    // Backdate lastSentAt past the cooldown.
    await new Promise((resolve, reject) => h.database.db.run(
        'UPDATE pending_verifications SET lastSentAt = ? WHERE userID = ? AND guildID = ?',
        [Date.now() - VerificationService.RESEND_COOLDOWN_MS - 1000, USER, community.id],
        (e) => e ? reject(e) : resolve()
    ))

    const before = transport.sends.length
    const again = await svc.resendCode({ community, settings, userID: USER })
    assert.strictEqual(again.outcome, 'code_sent')
    assert.strictEqual(transport.sends.length, before + 1)
    assert.strictEqual(transport.sends.at(-1).toEmail, 'student@uni.de',
        'resend goes to the address already on file, not a new one')
})

test('resend with nothing pending tells the user to start over', async () => {
    const { svc } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'] })
    const r = await svc.resendCode({ community, settings, userID: 'nobody' })
    assert.strictEqual(r.outcome, 'no_pending')
})

test('a resend issues a different code and resets the attempt counter', async () => {
    const { svc } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'] })
    await h.database.addGuildCredits(community.id, 10)
    const first = await issueCode(svc, community, settings)

    await svc.submitCode({ community, settings, userID: USER, code: '000000' })
    await new Promise((resolve, reject) => h.database.db.run(
        'UPDATE pending_verifications SET lastSentAt = 0 WHERE userID = ? AND guildID = ?',
        [USER, community.id], (e) => e ? reject(e) : resolve()
    ))

    const r = await svc.resendCode({ community, settings, userID: USER })
    assert.strictEqual(r.outcome, 'code_sent')
    const pending = await svc.peekPending(community.id, USER)
    assert.notStrictEqual(pending.code, first, 'a fresh code is issued')
    assert.strictEqual(pending.attempts, 0, 'attempts reset with the new code')
})

test('an exhausted quota with no credits denies the send and escalates to admins', async () => {
    const premiumManager = require('../src/premium/PremiumManager')
    const { svc, transport, notifier } = makeService()
    const community = h.newCommunity()
    const settings = h.settings({ managedChats: ['c1'] })

    // Park the community above its free allowance with an empty credit balance,
    // whatever that allowance is configured to be.
    await new Promise((resolve, reject) => h.database.db.run(
        'INSERT OR REPLACE INTO guild_stats (guildID, mailsSentMonth, statsMonth) VALUES (?, ?, ?)',
        [community.id, premiumManager.freeMonthlyLimit + 1, h.database.getCurrentMonth()],
        (e) => e ? reject(e) : resolve()
    ))

    const r = await svc.submitEmail({ community, settings, userID: USER, email: 'a@uni.de' })
    assert.strictEqual(r.outcome, 'quota_denied')
    assert.strictEqual(transport.sends.length, 0, 'no mail is sent once the quota is gone')
    assert.ok(notifier.names().includes('mailDenied'), 'admins are told they are turning members away')
})
