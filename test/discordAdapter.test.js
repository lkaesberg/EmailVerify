const test = require('node:test')
const assert = require('node:assert')
const h = require('./helpers')
const VerificationService = require('../src/core/VerificationService')
const DiscordAuthorizer = require('../src/discord/DiscordAuthorizer')

// Minimal stand-ins for the discord.js objects the authorizer touches. They exist
// to prove the adapter is wired to the service correctly — role resolution, the
// legacy groupID, and the failure paths — without a gateway connection.
function mockRole(id, name) { return { id, name } }

function mockGuild({ id, name = 'Mock Guild', roles = [], failAdd = false }) {
    const cache = new Map(roles.map(r => [r.id, r]))
    cache.find = (fn) => [...cache.values()].find(fn)
    const added = []
    const removed = []
    return {
        id, name, added, removed,
        iconURL: () => null,
        roles: { cache },
        channels: { cache: { get: () => null }, fetch: async () => null },
        members: {
            async fetch() {
                return {
                    roles: {
                        async add(role) { if (failAdd) throw new Error('Missing Permissions'); added.push(role.id) },
                        async remove(role) { removed.push(role.id) }
                    }
                }
            }
        }
    }
}

test.before(async () => { await h.ready() })

function discordService(extra = {}) {
    return new VerificationService({
        platform: 'discord',
        mailTransport: extra.transport || h.fakeTransport(),
        authorizer: new DiscordAuthorizer(),
        notifier: extra.notifier || h.fakeNotifier()
    })
}

/** Discord communities are keyed bare, so build ids that look like snowflakes. */
let n = 0
const snowflake = () => `9000000000000${++n}${Date.now() % 10000}`

test('default and domain roles are combined, deduplicated and assigned', async () => {
    const student = mockRole('r-student', 'Student')
    const verified = mockRole('r-verified', 'Verified')
    const unverified = mockRole('r-unverified', 'Unverified')
    const guild = mockGuild({ id: snowflake(), roles: [student, verified, unverified] })

    const settings = h.settings({
        defaultRoles: ['r-verified'],
        domainRoles: { '@*.edu': ['r-student', 'r-verified'] },
        unverifiedRoleName: 'r-unverified'
    })
    const svc = discordService()
    await h.database.addGuildCredits(guild.id, 10)

    const sent = await svc.submitEmail({ community: guild, settings, userID: 'du-1', email: 'a@mit.edu' })
    assert.strictEqual(sent.outcome, 'code_sent')
    const { code } = await svc.peekPending(guild.id, 'du-1')

    const r = await svc.submitCode({ community: guild, settings, userID: 'du-1', code })
    assert.strictEqual(r.outcome, 'success')
    assert.deepStrictEqual(guild.added.sort(), ['r-student', 'r-verified'], 'deduplicated union of default + domain roles')
    assert.deepStrictEqual(guild.removed, ['r-unverified'], 'the unverified role is stripped')
    assert.deepStrictEqual(r.labels.sort(), ['Student', 'Verified'])
})

test('a non-matching domain grants only the default roles', async () => {
    const student = mockRole('r-student', 'Student')
    const verified = mockRole('r-verified', 'Verified')
    const guild = mockGuild({ id: snowflake(), roles: [student, verified] })
    const settings = h.settings({
        defaultRoles: ['r-verified'],
        domainRoles: { '@*.edu': ['r-student'] }
    })
    const svc = discordService()
    await h.database.addGuildCredits(guild.id, 10)

    await svc.submitEmail({ community: guild, settings, userID: 'du-2', email: 'a@company.com' })
    const { code } = await svc.peekPending(guild.id, 'du-2')
    await svc.submitCode({ community: guild, settings, userID: 'du-2', code })

    assert.deepStrictEqual(guild.added, ['r-verified'])
})

test('configured roles that no longer exist fail loudly and keep the code alive', async () => {
    // defaultRoles names a role the guild no longer has → resolves to nothing.
    const guild = mockGuild({ id: snowflake(), roles: [] })
    const settings = h.settings({ defaultRoles: ['r-deleted'] })
    const notifier = h.fakeNotifier()
    const svc = discordService({ notifier })
    await h.database.addGuildCredits(guild.id, 10)

    await svc.submitEmail({ community: guild, settings, userID: 'du-3', email: 'a@uni.de' })
    const { code } = await svc.peekPending(guild.id, 'du-3')
    const r = await svc.submitCode({ community: guild, settings, userID: 'du-3', code })

    assert.strictEqual(r.outcome, 'authorization_failed')
    assert.strictEqual(r.detail, 'no_targets_resolved')
    assert.ok(notifier.names().includes('authorizationFailed'), 'admins are told their roles are broken')
    assert.ok(await svc.peekPending(guild.id, 'du-3'), 'the member can retry the same code once it is fixed')
})

test('a permissions error during role assignment restores the code', async () => {
    const verified = mockRole('r-verified', 'Verified')
    const guild = mockGuild({ id: snowflake(), roles: [verified], failAdd: true })
    const settings = h.settings({ defaultRoles: ['r-verified'] })
    const svc = discordService()
    await h.database.addGuildCredits(guild.id, 10)

    await svc.submitEmail({ community: guild, settings, userID: 'du-4', email: 'a@uni.de' })
    const { code } = await svc.peekPending(guild.id, 'du-4')
    const r = await svc.submitCode({ community: guild, settings, userID: 'du-4', code })

    assert.strictEqual(r.outcome, 'authorization_failed')
    assert.strictEqual(r.detail, 'role_add_error')
    const restored = await svc.peekPending(guild.id, 'du-4')
    assert.strictEqual(restored.code, code, 'same code, so no second email is billed')
})

test('the verified user row keeps the legacy primary-role id', async () => {
    const verified = mockRole('r-verified', 'Verified')
    const guild = mockGuild({ id: snowflake(), roles: [verified] })
    const settings = h.settings({ defaultRoles: ['r-verified'] })
    const svc = discordService()
    await h.database.addGuildCredits(guild.id, 10)

    await svc.submitEmail({ community: guild, settings, userID: 'du-5', email: 'legacy@uni.de' })
    const { code } = await svc.peekPending(guild.id, 'du-5')
    await svc.submitCode({ community: guild, settings, userID: 'du-5', code })

    const md5hash = require('../src/crypto/Crypto')
    // updateEmailUser is fire-and-forget, so poll briefly rather than racing the write.
    const row = await h.waitForEmailUser(md5hash('legacy@uni.de'), guild.id)
    assert.ok(row, 'the verified user is persisted')
    assert.strictEqual(row.userID, 'du-5')
    assert.strictEqual(row.groupID, 'r-verified')
})

test('discord communities remain unprefixed, so existing rows keep resolving', async () => {
    const { platformOf } = require('../src/core/PlatformKey')
    const guild = mockGuild({ id: snowflake() })
    assert.strictEqual(platformOf(guild.id), 'discord')
    const settings = h.settings({ defaultRoles: ['r'] })
    // status still means "has roles" for Discord, not "has chats"
    assert.strictEqual(settings.status, true)
    settings.platform = 'telegram'
    settings.managedChats = []
    assert.strictEqual(settings.status, false, 'telegram needs a gated chat instead')
})
