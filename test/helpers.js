// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg

// Shared test bootstrap. Must be required before anything that pulls in the
// Database or Analytics singletons, so both are redirected away from production.
const os = require('os')
const path = require('path')
const fs = require('fs')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emailverify-test-'))
process.env.EMAILVERIFY_DB_PATH = path.join(tmpDir, 'test.db')
process.env.EMAILVERIFY_DISABLE_ANALYTICS = '1'

const database = require('../src/database/Database')
const ServerSettings = require('../src/database/ServerSettings')

/** Migrations run asynchronously in the constructor; wait for them to settle. */
function ready() {
    return new Promise((resolve, reject) => {
        const started = Date.now()
        const poll = () => {
            database.db.get('PRAGMA user_version', (err, row) => {
                if (err) return reject(err)
                if (row && row.user_version >= 21) return resolve()
                if (Date.now() - started > 10000) return reject(new Error('migrations did not finish'))
                setTimeout(poll, 25)
            })
        }
        poll()
    })
}

/**
 * Settings with sensible defaults. Pass the community key so `platform` is derived
 * exactly as Database.getServerSettings does — `status` means "has roles" on Discord
 * and "gates a chat" on Telegram, so getting this wrong makes a test pass or fail
 * for the wrong reason.
 */
function settings(overrides = {}, communityKey = null) {
    const s = new ServerSettings()
    s.language = 'english'
    s.defaultRoles = ['role-verified']
    if (communityKey) s.setPlatformFromKey(communityKey)
    return Object.assign(s, overrides)
}

/** Records what it was asked to send and answers however the test wants. */
function fakeTransport({ ok = true, error = 'smtp down' } = {}) {
    const sends = []
    return {
        sends,
        async send(opts) {
            sends.push(opts)
            return ok
                ? { ok: true, provider: 'fake', messageId: 'mid', accepted: opts.toEmail, latencyMs: 1, error: null, rejected: null }
                : { ok: false, provider: 'fake', messageId: null, accepted: null, latencyMs: 1, error, rejected: null }
        }
    }
}

/** Authorizer that always grants, and records the calls. */
function fakeAuthorizer(overrides = {}) {
    const calls = { resolve: [], grant: [], revokePrevious: [] }
    return {
        calls,
        resolve(community, s, email) {
            calls.resolve.push({ community, email })
            return { targets: { ids: ['t1'] }, count: 1, expected: true, primaryId: 't1' }
        },
        async grant(community, s, userID, targets, email) {
            calls.grant.push({ userID, targets, email })
            return { ok: true, labels: ['Verified'] }
        },
        revokePrevious(community, s, emailHash, newUserID) {
            calls.revokePrevious.push({ emailHash, newUserID })
        },
        ...overrides
    }
}

/** Collects notifier hook invocations by name. */
function fakeNotifier() {
    const seen = []
    const record = (name) => (...args) => { seen.push({ name, args }) }
    return {
        seen,
        names: () => seen.map(e => e.name),
        notConfigured: record('notConfigured'),
        emaillistLocked: record('emaillistLocked'),
        mailDenied: record('mailDenied'),
        quotaWarnings: record('quotaWarnings'),
        zeptoAutoDisabled: record('zeptoAutoDisabled'),
        authorizationFailed: record('authorizationFailed'),
        verified: record('verified')
    }
}

let guildCounter = 0
/** A fresh community id per test, so tests never share quota or pending rows. */
function newCommunity(name = 'Test Community') {
    guildCounter += 1
    return { id: `t:-100${guildCounter}${Date.now() % 100000}`, name }
}

/** Poll for a verified-user row, since updateEmailUser is fire-and-forget. */
async function waitForEmailUser(emailHash, guildID, timeoutMs = 2000) {
    const started = Date.now()
    for (;;) {
        const row = await new Promise(resolve => database.getEmailUser(emailHash, guildID, resolve))
        if (row) return row
        if (Date.now() - started > timeoutMs) return null
        await new Promise(r => setTimeout(r, 20))
    }
}

module.exports = { database, ready, waitForEmailUser, settings, fakeTransport, fakeAuthorizer, fakeNotifier, newCommunity, tmpDir }
