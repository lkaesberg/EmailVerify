const test = require('node:test')
const assert = require('node:assert')
const h = require('./helpers')
const DeepLink = require('../src/telegram/DeepLink')
const TelegramAuthorizer = require('../src/telegram/TelegramAuthorizer')
const VerificationService = require('../src/core/VerificationService')
const { key, TELEGRAM } = require('../src/core/PlatformKey')

test.before(async () => { await h.ready() })

// A stand-in for telegraf's Telegram client, recording every gate action.
function mockTelegram({ chats = {}, fail = null } = {}) {
    const calls = { approve: [], restrict: [], inviteLink: [], ban: [], unban: [], sent: [] }
    return {
        calls,
        async getChat(id) {
            return chats[id] || { id, title: `Chat ${id}`, permissions: { can_send_messages: true, can_invite_users: true } }
        },
        async approveChatJoinRequest(chatId, userId) {
            if (fail === 'approve') { const e = new Error('Bad Request'); e.description = 'CHAT_ADMIN_REQUIRED'; throw e }
            if (fail === 'already') { const e = new Error('x'); e.description = 'USER_ALREADY_PARTICIPANT'; throw e }
            calls.approve.push({ chatId, userId })
        },
        async restrictChatMember(chatId, userId, extra) {
            calls.restrict.push({ chatId, userId, permissions: extra.permissions })
        },
        async createChatInviteLink(chatId, opts) {
            calls.inviteLink.push({ chatId, opts })
            return { invite_link: `https://t.me/+link${chatId}` }
        },
        async banChatMember(chatId, userId) { calls.ban.push({ chatId, userId }) },
        async unbanChatMember(chatId, userId) { calls.unban.push({ chatId, userId }) },
        async sendMessage(chatId, text) { calls.sent.push({ chatId, text }) },
        async getChatAdministrators() { return [] }
    }
}

// --------------------------------------------------------------------------
// deep links
// --------------------------------------------------------------------------

test('deep-link payloads survive Telegram\'s character restrictions', () => {
    const payload = DeepLink.encode(-1001234567890)
    assert.ok(/^[A-Za-z0-9_-]{1,64}$/.test(payload), 'only characters Telegram allows in a start payload')
    assert.strictEqual(DeepLink.decode(payload), '-1001234567890')
})

test('a non-payload is rejected rather than misread as a chat', () => {
    for (const bad of ['', 'hello', 'v', 'vabc', null, undefined, 'v-100']) {
        assert.strictEqual(DeepLink.decode(bad), null, `rejects ${JSON.stringify(bad)}`)
    }
})

test('the shared link points at the bot, not the group', () => {
    // A bot cannot DM someone who has not started it, so entry must run through the bot.
    assert.strictEqual(DeepLink.buildUrl('@Verify', -100123), 'https://t.me/Verify?start=vn100123')
    assert.throws(() => DeepLink.buildUrl('', -100123), /botUsername/)
})

// --------------------------------------------------------------------------
// chat resolution
// --------------------------------------------------------------------------

test('a gated chat with no explicit defaults is itself the default', () => {
    const auth = new TelegramAuthorizer(mockTelegram())
    const chat = key(TELEGRAM, -100111)
    const settings = h.settings({ managedChats: [chat], defaultRoles: [], domainRoles: {} }, chat)
    const r = auth.resolve({ id: chat }, settings, 'a@uni.de')
    assert.deepStrictEqual(r.targets.chats, [chat])
    assert.strictEqual(r.expected, true)
})

test('domain-specific chats replace Discord\'s domain-specific roles', () => {
    const auth = new TelegramAuthorizer(mockTelegram())
    const students = key(TELEGRAM, -100222)
    const staff = key(TELEGRAM, -100333)
    const settings = h.settings({
        managedChats: [students, staff],
        defaultRoles: [],
        domainRoles: { '@*.uni.de': [students], '@staff.uni.de': [staff] }
    }, students)

    const student = auth.resolve({ id: students }, settings, 'sam@cs.uni.de')
    assert.deepStrictEqual(student.targets.chats, [students])

    const prof = auth.resolve({ id: staff }, settings, 'prof@staff.uni.de')
    assert.deepStrictEqual(prof.targets.chats.sort(), [students, staff].sort(),
        'staff match both patterns and get both chats')
})

test('a chat that is no longer gated is never granted', () => {
    const auth = new TelegramAuthorizer(mockTelegram())
    const gated = key(TELEGRAM, -100444)
    const removed = key(TELEGRAM, -100555)
    const settings = h.settings({ managedChats: [gated], defaultRoles: [gated, removed] }, gated)
    const r = auth.resolve({ id: gated }, settings, 'a@uni.de')
    assert.deepStrictEqual(r.targets.chats, [gated])
})

// --------------------------------------------------------------------------
// the three gate modes
// --------------------------------------------------------------------------

test('joinRequest mode approves the pending request', async () => {
    const tg = mockTelegram()
    const auth = new TelegramAuthorizer(tg)
    const chat = key(TELEGRAM, -100666)
    const settings = h.settings({ managedChats: [chat], gateMode: 'joinRequest', defaultRoles: [] }, chat)
    const r = await auth.grant({ id: chat }, settings, key(TELEGRAM, 42), { chats: [chat] })

    assert.strictEqual(r.ok, true)
    assert.deepStrictEqual(tg.calls.approve, [{ chatId: -100666, userId: 42 }])
    assert.deepStrictEqual(r.labels, ['Chat -100666'])
})

test('an already-approved member counts as success, not an error', async () => {
    const tg = mockTelegram({ fail: 'already' })
    const auth = new TelegramAuthorizer(tg)
    const chat = key(TELEGRAM, -100777)
    const settings = h.settings({ managedChats: [chat], gateMode: 'joinRequest', defaultRoles: [] }, chat)
    const r = await auth.grant({ id: chat }, settings, key(TELEGRAM, 42), { chats: [chat] })
    assert.strictEqual(r.ok, true, 'someone an admin already let in is still verified')
})

test('a missing admin right surfaces as a failed grant', async () => {
    const tg = mockTelegram({ fail: 'approve' })
    const auth = new TelegramAuthorizer(tg)
    const chat = key(TELEGRAM, -100888)
    const settings = h.settings({ managedChats: [chat], gateMode: 'joinRequest', defaultRoles: [] }, chat)
    const r = await auth.grant({ id: chat }, settings, key(TELEGRAM, 42), { chats: [chat] })
    assert.strictEqual(r.ok, false)
    assert.match(r.detail, /grant_error/)
})

test('mute mode restores the chat\'s own default permissions', async () => {
    const chatId = -100999
    const tg = mockTelegram({ chats: { [chatId]: { id: chatId, title: 'Muted Group', permissions: { can_send_messages: true, can_send_polls: false } } } })
    const auth = new TelegramAuthorizer(tg)
    const chat = key(TELEGRAM, chatId)
    const settings = h.settings({ managedChats: [chat], gateMode: 'mute', defaultRoles: [] }, chat)

    await auth.grant({ id: chat }, settings, key(TELEGRAM, 42), { chats: [chat] })
    assert.deepStrictEqual(tg.calls.restrict[0].permissions, { can_send_messages: true, can_send_polls: false },
        'restores what the group allows, not a hardcoded set')
})

test('holding a new arrival mutes every permission', async () => {
    const tg = mockTelegram()
    const auth = new TelegramAuthorizer(tg)
    await auth.mute(-100999, 42)
    const perms = tg.calls.restrict[0].permissions
    assert.ok(Object.values(perms).every(v => v === false), 'a held member can do nothing until verified')
})

test('inviteLink mode issues a single-use link that expires', async () => {
    const tg = mockTelegram()
    const auth = new TelegramAuthorizer(tg, { inviteLinkTtlMinutes: 15 })
    const chat = key(TELEGRAM, -101010)
    const settings = h.settings({ managedChats: [chat], gateMode: 'inviteLink', defaultRoles: [] }, chat)

    const r = await auth.grant({ id: chat }, settings, key(TELEGRAM, 42), { chats: [chat] })
    assert.strictEqual(r.ok, true)
    assert.deepStrictEqual(r.links, ['https://t.me/+link-101010'])
    const opts = tg.calls.inviteLink[0].opts
    assert.strictEqual(opts.member_limit, 1, 'the link cannot be shared onward')
    assert.ok(opts.expire_date * 1000 > Date.now(), 'and it expires')
})

test('routing into two chats yields two links', async () => {
    const tg = mockTelegram()
    const auth = new TelegramAuthorizer(tg, { inviteLinkTtlMinutes: 15 })
    const a = key(TELEGRAM, -100001)
    const b = key(TELEGRAM, -100002)
    const settings = h.settings({ managedChats: [a, b], gateMode: 'inviteLink', defaultRoles: [] }, a)
    const r = await auth.grant({ id: a }, settings, key(TELEGRAM, 42), { chats: [a, b] })
    assert.strictEqual(r.links.length, 2)
})

// --------------------------------------------------------------------------
// end to end through the shared service
// --------------------------------------------------------------------------

test('a full Telegram verification runs the same rules as Discord', async () => {
    const tg = mockTelegram()
    const auth = new TelegramAuthorizer(tg)
    const chatId = -102020
    const chat = key(TELEGRAM, chatId)
    const community = { id: chat, name: 'Uni Group' }
    const settings = h.settings({
        managedChats: [chat],
        gateMode: 'joinRequest',
        domains: ['@*.uni.de'],
        defaultRoles: []
    }, chat)
    const svc = new VerificationService({
        platform: TELEGRAM,
        mailTransport: h.fakeTransport(),
        authorizer: auth,
        notifier: h.fakeNotifier()
    })
    await h.database.addGuildCredits(chat, 10)
    const userID = key(TELEGRAM, 777)

    const wrongDomain = await svc.submitEmail({ community, settings, userID, email: 'a@gmail.com' })
    assert.strictEqual(wrongDomain.outcome, 'invalid_email')

    const sent = await svc.submitEmail({ community, settings, userID, email: 'sam@cs.uni.de' })
    assert.strictEqual(sent.outcome, 'code_sent')

    const { code } = await svc.peekPending(chat, userID)
    const bad = await svc.submitCode({ community, settings, userID, code: '111111' })
    assert.strictEqual(bad.outcome, 'wrong_code')

    const ok = await svc.submitCode({ community, settings, userID, code })
    assert.strictEqual(ok.outcome, 'success')
    assert.deepStrictEqual(tg.calls.approve, [{ chatId, userId: 777 }])
})

test('re-verifying the same address removes the previous account', async () => {
    const tg = mockTelegram()
    const auth = new TelegramAuthorizer(tg)
    const chatId = -103030
    const chat = key(TELEGRAM, chatId)
    const community = { id: chat, name: 'Uni Group' }
    const settings = h.settings({ managedChats: [chat], gateMode: 'joinRequest', domains: [], defaultRoles: [] }, chat)
    const svc = new VerificationService({
        platform: TELEGRAM, mailTransport: h.fakeTransport(), authorizer: auth, notifier: h.fakeNotifier()
    })
    await h.database.addGuildCredits(chat, 20)

    const first = key(TELEGRAM, 8001)
    await svc.submitEmail({ community, settings, userID: first, email: 'shared@uni.de' })
    await svc.submitCode({ community, settings, userID: first, code: (await svc.peekPending(chat, first)).code })

    const second = key(TELEGRAM, 8002)
    await svc.submitEmail({ community, settings, userID: second, email: 'shared@uni.de' })
    await svc.submitCode({ community, settings, userID: second, code: (await svc.peekPending(chat, second)).code })

    // revokePrevious is fire-and-forget; give the callback a turn to land.
    await new Promise(r => setTimeout(r, 60))
    assert.deepStrictEqual(tg.calls.ban, [{ chatId, userId: 8001 }],
        'the first account loses its seat when the address moves')
})

test('one user with codes in two communities is not guessed at', async () => {
    const svc = new VerificationService({
        platform: TELEGRAM,
        mailTransport: h.fakeTransport(),
        authorizer: new TelegramAuthorizer(mockTelegram()),
        notifier: h.fakeNotifier()
    })
    const userID = key(TELEGRAM, 9001)
    const a = { id: key(TELEGRAM, -104040), name: 'A' }
    const b = { id: key(TELEGRAM, -105050), name: 'B' }
    for (const c of [a, b]) {
        const settings = h.settings({ managedChats: [c.id], domains: [], defaultRoles: [] }, c.id)
        await h.database.addGuildCredits(c.id, 10)
        await svc.submitEmail({ community: c, settings, userID, email: 'x@uni.de' })
        // The rate limiter is per user per community, so the second send is admitted.
    }
    const rows = await h.database.getPendingVerificationsForUser(userID)
    assert.strictEqual(rows.length, 2, 'both codes are outstanding, so the bot must ask which community')
})

test('routing that points only at ungated chats fails loudly instead of granting everything', () => {
    const auth = new TelegramAuthorizer(mockTelegram())
    const gated = key(TELEGRAM, -106060)
    const stale = key(TELEGRAM, -106061)
    // The admin configured routing, but every target has since been ungated.
    const settings = h.settings({ managedChats: [gated], defaultRoles: [stale], domainRoles: {} }, gated)
    const r = auth.resolve({ id: gated }, settings, 'a@uni.de')
    assert.strictEqual(r.count, 0, 'no access is invented for a broken mapping')
    assert.strictEqual(r.expected, true, 'and the service reports it as a configuration failure')
})
