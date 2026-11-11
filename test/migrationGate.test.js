// SPDX-License-Identifier: AGPL-3.0-or-later
// The shard must not log in (and so must not reach clientReady, whose startup queries
// need the new tables) before its schema migrations have settled.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { spawnSync } = require('child_process')

const helpers = path.join(__dirname, 'helpers')
const repoRoot = path.resolve(__dirname, '..')

test('EmailBot logs in only after migrations reach the latest version', () => {
    const latest = Math.max(...[...require('fs').readFileSync(path.join(repoRoot, 'src/database/Database.js'), 'utf8')
        .matchAll(/this\.runMigration\((\d+),/g)].map((m) => Number(m[1])))
    const child = spawnSync(process.execPath, [
        '-r', path.join(helpers, 'env.js'),
        '-r', path.join(helpers, 'loginProbe.js'),
        path.join(repoRoot, 'src/EmailBot.js')
    ], { encoding: 'utf8', timeout: 60000, env: { ...process.env, DB_ENCRYPTION_KEY: '' } })
    const line = child.stdout.split('\n').find((l) => l.startsWith('{"loginAtUserVersion"'))
    assert.ok(line, `no login probe output\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`)
    assert.equal(JSON.parse(line).loginAtUserVersion, latest)
})
