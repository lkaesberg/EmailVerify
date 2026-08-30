const test = require('node:test')
const assert = require('node:assert')
const { key, platformOf, nativeId, DISCORD, TELEGRAM } = require('../src/core/PlatformKey')

test('discord ids stay bare so existing rows keep working', () => {
    assert.strictEqual(key(DISCORD, '895056197789564969'), '895056197789564969')
    assert.strictEqual(platformOf('895056197789564969'), DISCORD)
    assert.strictEqual(nativeId('895056197789564969'), '895056197789564969')
})

test('telegram ids are prefixed and round-trip', () => {
    const k = key(TELEGRAM, -1001234567890)
    assert.strictEqual(k, 't:-1001234567890')
    assert.strictEqual(platformOf(k), TELEGRAM)
    assert.strictEqual(nativeId(k), '-1001234567890')
})

test('keying is idempotent', () => {
    const once = key(TELEGRAM, -100)
    assert.strictEqual(key(TELEGRAM, once), once)
})

test('a telegram key can never collide with a discord snowflake', () => {
    // Snowflakes are digits only, so a prefixed key is not a possible Discord id.
    assert.ok(!/^\d+$/.test(key(TELEGRAM, 123)))
})
