// SPDX-License-Identifier: AGPL-3.0-or-later
const { testConfig } = require('./helpers/env')
// Vote rewards on and a website configured, read when the modules load.
testConfig.topggWebhookSecret = 'test-secret'
testConfig.websiteUrl = 'https://example.org/'

const { test, after } = require('node:test')
const assert = require('node:assert/strict')

const database = require('../src/database/Database')
const voting = require('../src/utils/voting')

after(async () => {
    await database.migrated
    await new Promise((resolve) => database.db.close(() => resolve()))
})

for (const language of ['english', 'german']) {
    test(`the out-of-emails notice offers no vote while votes are on (${language})`, async () => {
        assert.equal(voting.isEnabled(), true)
        const payload = await voting.limitReachedMessage(language)
        assert.equal(payload.components, undefined)
        assert.equal(payload.embeds.length, 1)
    })
}

test('the notice links the website tagged as the limit notice', async () => {
    const payload = await voting.limitReachedMessage('english')
    assert.match(JSON.stringify(payload.embeds[0].data), /utm_source=bot&utm_medium=limit_notice/)
})
