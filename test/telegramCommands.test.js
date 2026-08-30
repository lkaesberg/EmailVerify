const test = require('node:test')
const assert = require('node:assert')
const h = require('./helpers')
const config = require('../config/config.json')
const database = require('../src/database/Database')
const { key, TELEGRAM } = require('../src/core/PlatformKey')

// Feed real Telegram update objects through the real Telegraf middleware stack, with
// only the outbound API faked. This is the closest thing to driving the bot without
// a BotFather token: routing, admin checks and argument parsing all run for real.
config.telegram.token = '123456:ATestTokenForHandleUpdateOnly'
config.telegram.botUsername = 'TestVerifyBot'
const TelegramBot = require('../src/telegram/TelegramBot')

const CHAT_ID = -1002222000
const CHAT_KEY = key(TELEGRAM, CHAT_ID)
const ADMIN_ID = 500
const MEMBER_ID = 501

// Telegraf builds a fresh Telegram client for every update, so stubbing the bot's
// own client would miss the one handlers actually use. Intercepting callApi — the
// single funnel every Bot API method goes through — catches both.
const { Telegram } = require('telegraf')
const apiCalls = []
Telegram.prototype.callApi = async function (method, payload = {}) {
    apiCalls.push({ method, payload })
    switch (method) {
        case 'sendMessage': return { message_id: apiCalls.length, text: payload.text }
        case 'getChat': return { id: payload.chat_id, title: 'Test Group', type: 'supergroup', permissions: {} }
        case 'getChatMember':
            return payload.user_id === 999
                ? { status: 'administrator', can_invite_users: true, user: { id: 999, is_bot: true } }
                : { status: payload.user_id === ADMIN_ID ? 'administrator' : 'member', user: { id: payload.user_id } }
        case 'getChatAdministrators': return []
        case 'createChatInviteLink': return { invite_link: `https://t.me/+invite${payload.chat_id}` }
        case 'createInvoiceLink': return `https://t.me/$inv_${payload.title.replace(/\s/g, '_')}`
        case 'getMe': return { id: 999, is_bot: true, username: 'TestVerifyBot', first_name: 'Test' }
        default: return true
    }
}

function makeBot() {
    apiCalls.length = 0
    const bot = new TelegramBot({ mailTransport: h.fakeTransport() })
    bot.bot.botInfo = { id: 999, is_bot: true, username: 'TestVerifyBot', first_name: 'Test' }
    return { bot, sent: apiCalls }
}

/** Everything the bot said, newest last. */
function messages(calls) {
    return calls.filter(c => c.method === 'sendMessage').map(c => c.payload)
}

let updateId = 0
function groupCommand(text, from = ADMIN_ID) {
    return {
        update_id: ++updateId,
        message: {
            message_id: ++updateId, date: Math.floor(Date.now() / 1000),
            chat: { id: CHAT_ID, type: 'supergroup', title: 'Test Group' },
            from: { id: from, is_bot: false, first_name: 'U' },
            text,
            entities: text.startsWith('/') ? [{ offset: 0, length: text.split(' ')[0].length, type: 'bot_command' }] : []
        }
    }
}

function privateMessage(text, from = MEMBER_ID) {
    return {
        update_id: ++updateId,
        message: {
            message_id: ++updateId, date: Math.floor(Date.now() / 1000),
            chat: { id: from, type: 'private' },
            from: { id: from, is_bot: false, first_name: 'M' },
            text,
            entities: text.startsWith('/') ? [{ offset: 0, length: text.split(' ')[0].length, type: 'bot_command' }] : []
        }
    }
}

const lastText = (sent) => {
    const msgs = messages(sent)
    return msgs.length ? msgs[msgs.length - 1].text : ''
}

test.before(async () => { await h.ready() })

test('/setup registers the chat and hands back the member link', async () => {
    const { bot, sent } = makeBot()
    await bot.bot.handleUpdate(groupCommand('/setup'))

    const settings = await new Promise(r => database.getServerSettings(CHAT_KEY, r))
    assert.deepStrictEqual(settings.managedChats, [CHAT_KEY])
    assert.strictEqual(settings.status, true, 'a gated chat is a configured community')
    assert.match(lastText(sent), /t\.me\/TestVerifyBot\?start=/,
        'the published entry point is the bot, not the group')
})

test('a non-admin cannot configure the chat', async () => {
    const { bot, sent } = makeBot()
    await bot.bot.handleUpdate(groupCommand('/gatemode mute', MEMBER_ID))
    assert.match(lastText(sent), /administrators/i)

    const settings = await new Promise(r => database.getServerSettings(CHAT_KEY, r))
    assert.notStrictEqual(settings.gateMode, 'mute', 'the setting is unchanged')
})

test('/gatemode accepts the three modes and rejects anything else', async () => {
    const { bot, sent } = makeBot()
    for (const mode of TelegramBot.GATE_MODES) {
        await bot.bot.handleUpdate(groupCommand(`/gatemode ${mode}`))
        const settings = await new Promise(r => database.getServerSettings(CHAT_KEY, r))
        assert.strictEqual(settings.gateMode, mode)
    }
    await bot.bot.handleUpdate(groupCommand('/gatemode nonsense'))
    assert.match(lastText(sent), /joinRequest, mute, inviteLink/)
    const settings = await new Promise(r => database.getServerSettings(CHAT_KEY, r))
    assert.strictEqual(settings.gateMode, 'inviteLink', 'the bad value was not written')
})

test('/domain add, list, remove and clear round-trip', async () => {
    const { bot, sent } = makeBot()

    // Bare domains are normalized, exactly as the Discord command does it.
    await bot.bot.handleUpdate(groupCommand('/domain add university.edu, @*.uni.de'))
    let settings = await new Promise(r => database.getServerSettings(CHAT_KEY, r))
    assert.deepStrictEqual(settings.domains, ['@university.edu', '@*.uni.de'])

    await bot.bot.handleUpdate(groupCommand('/domain list'))
    assert.match(lastText(sent), /@university\.edu/)

    await bot.bot.handleUpdate(groupCommand('/domain remove @university.edu'))
    settings = await new Promise(r => database.getServerSettings(CHAT_KEY, r))
    assert.deepStrictEqual(settings.domains, ['@*.uni.de'])

    await bot.bot.handleUpdate(groupCommand('/domain clear'))
    settings = await new Promise(r => database.getServerSettings(CHAT_KEY, r))
    assert.deepStrictEqual(settings.domains, [])
    assert.match(lastText(sent), /any.*valid email/i, 'and says what an empty list means')
})

test('/blacklist keeps wildcard patterns verbatim', async () => {
    const { bot } = makeBot()
    await bot.bot.handleUpdate(groupCommand('/blacklist add *@tempmail.*, *spam*'))
    const settings = await new Promise(r => database.getServerSettings(CHAT_KEY, r))
    assert.deepStrictEqual(settings.blacklist, ['*@tempmail.*', '*spam*'],
        'blacklist entries are patterns, not domains, so they are not rewritten')
})

test('/language only accepts languages that exist', async () => {
    const { bot, sent } = makeBot()
    await bot.bot.handleUpdate(groupCommand('/language german'))
    let settings = await new Promise(r => database.getServerSettings(CHAT_KEY, r))
    assert.strictEqual(settings.language, 'german')

    await bot.bot.handleUpdate(groupCommand('/language klingon'))
    settings = await new Promise(r => database.getServerSettings(CHAT_KEY, r))
    assert.strictEqual(settings.language, 'german', 'unchanged')
    assert.match(lastText(sent), /english/, 'and lists what is available')

    await bot.bot.handleUpdate(groupCommand('/language english'))
})

test('/settings reports the whole configuration', async () => {
    const { bot, sent } = makeBot()
    await bot.bot.handleUpdate(groupCommand('/domain add @uni.de'))
    await bot.bot.handleUpdate(groupCommand('/settings'))
    const text = lastText(sent)
    assert.match(text, /Gate mode/)
    assert.match(text, /@uni\.de/)
    assert.match(text, /t\.me\/TestVerifyBot/)
})

test('admin commands are refused in a private chat, where there is no chat to configure', async () => {
    const { bot, sent } = makeBot()
    await bot.bot.handleUpdate(privateMessage('/domain list', ADMIN_ID))
    assert.match(lastText(sent), /inside the group/i)
})

test('a member verifies end to end through real updates', async () => {
    const { bot, sent } = makeBot()
    await bot.bot.handleUpdate(groupCommand('/domain clear'))
    await bot.bot.handleUpdate(groupCommand('/gatemode joinRequest'))
    await database.addGuildCredits(CHAT_KEY, 20)

    // Arrive from the deep link the admin published.
    const payload = require('../src/telegram/DeepLink').encode(CHAT_ID)
    await bot.bot.handleUpdate(privateMessage(`/start ${payload}`))
    assert.match(lastText(sent), /email address/i)

    // Send the address as an ordinary message, as Telegram has no modals.
    await bot.bot.handleUpdate(privateMessage('member@uni.de'))
    assert.match(lastText(sent), /sent a 6-digit code/i)

    const userKey = key(TELEGRAM, MEMBER_ID)
    const pending = await bot.verification.peekPending(CHAT_KEY, userKey)
    assert.ok(pending, 'a code is outstanding')

    await bot.bot.handleUpdate(privateMessage('000000'))
    assert.match(lastText(sent), /Wrong code/i)

    await bot.bot.handleUpdate(privateMessage(pending.code))
    assert.match(lastText(sent), /verified/i)
    assert.strictEqual(await bot.verification.peekPending(CHAT_KEY, userKey), null)
})

test('a stranger with no link is told where to start, not handed a form', async () => {
    const { bot, sent } = makeBot()
    await bot.bot.handleUpdate(privateMessage('/start', 4321))
    assert.match(lastText(sent), /verification link/i)

    await bot.bot.handleUpdate(privateMessage('random@uni.de', 4321))
    assert.match(lastText(sent), /verification link/i, 'and a bare email goes nowhere')
})

test('/premium is silent about plans when Stars are switched off', async () => {
    const { bot, sent } = makeBot()
    bot.stars.enabled = false
    await bot.bot.handleUpdate(groupCommand('/premium'))
    assert.match(lastText(sent), /aren't enabled/i)
})

test('/premium lists the priced products as payment links', async () => {
    const { bot, sent } = makeBot()
    bot.stars.enabled = true
    bot.stars.prices = { subscriptionTier1: 350, credits100: 200 }
    await bot.bot.handleUpdate(groupCommand('/premium'))

    const msgs = messages(sent)
    const keyboard = msgs[msgs.length - 1].reply_markup?.inline_keyboard
    assert.ok(keyboard, 'plans are offered as buttons')
    assert.strictEqual(keyboard.length, 2, 'one per priced product')
    assert.ok(keyboard.every(row => row[0].url.startsWith('https://t.me/')))
    assert.match(keyboard[0][0].text, /⭐/)
})
