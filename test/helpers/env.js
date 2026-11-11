// SPDX-License-Identifier: AGPL-3.0-or-later
// Test environment: a throwaway working directory (Database.js opens config/bot.db
// relative to the cwd) and an in-memory config.json, so tests never touch a real
// database or the operator's config. Require this before anything under src/.

const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const repoRoot = path.resolve(__dirname, '..', '..')

const testConfig = {
    token: 'test-token',
    clientId: '900000000000000001',
    operatorWebhookUrl: '',
    posthog: { enabled: false },
    zeptomail: { enabled: false },
    monetization: {
        enabled: true,
        freeMonthlyLimit: 20,
        skus: { credits100: 'sku-credits100', credits500: 'sku-credits500', credits2000: 'sku-credits2000', csvUnlock: 'sku-csv' }
    }
}

const virtualConfig = path.join(repoRoot, 'config', '__test_config__.json')
const realResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
    if (/(^|[\\/])config[\\/]config\.json$/.test(request)) return virtualConfig
    return realResolve.call(this, request, parent, ...rest)
}
const configModule = new Module(virtualConfig)
configModule.filename = virtualConfig
configModule.loaded = true
configModule.exports = testConfig
require.cache[virtualConfig] = configModule

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emailverify-test-'))
fs.mkdirSync(path.join(workDir, 'config'))
// Language.js and EmailBot.js read ./language and ./src/commands from the cwd.
fs.symlinkSync(path.join(repoRoot, 'language'), path.join(workDir, 'language'))
fs.symlinkSync(path.join(repoRoot, 'src'), path.join(workDir, 'src'))
process.chdir(workDir)
delete process.env.DB_ENCRYPTION_KEY

process.on('exit', () => {
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch {}
})

module.exports = { repoRoot, workDir, testConfig }
