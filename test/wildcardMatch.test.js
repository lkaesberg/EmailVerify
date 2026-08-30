const test = require('node:test')
const assert = require('node:assert')
const { emailMatchesDomains, emailIsBlacklisted, getMatchingDomainPatterns } = require('../src/utils/wildcardMatch')

test('exact domain match', () => {
    assert.ok(emailMatchesDomains('a@uni.de', ['@uni.de']))
    assert.ok(!emailMatchesDomains('a@other.de', ['@uni.de']))
})

test('wildcard subdomain match', () => {
    assert.ok(emailMatchesDomains('s@cs.harvard.edu', ['@*.edu']))
    assert.ok(emailMatchesDomains('s@mit.edu', ['@*.edu']))
    assert.ok(!emailMatchesDomains('s@example.com', ['@*.edu']))
})

test('empty domain list matches nothing (the caller treats that as default-open)', () => {
    assert.ok(!emailMatchesDomains('a@uni.de', []))
})

test('blacklist wildcards', () => {
    assert.ok(emailIsBlacklisted('x@tempmail.io', ['*@tempmail.*']))
    assert.ok(emailIsBlacklisted('spammy@a.com', ['*spam*']))
    assert.ok(!emailIsBlacklisted('real@uni.de', ['*@tempmail.*', '*spam*']))
})

test('matching patterns drive domain-specific grants', () => {
    const patterns = getMatchingDomainPatterns('prof@staff.uni.de', ['@staff.uni.de', '@*.uni.de', '@other.com'])
    assert.ok(patterns.includes('@staff.uni.de'))
    assert.ok(!patterns.includes('@other.com'))
})
