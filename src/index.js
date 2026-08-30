// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Process entrypoint for both front-ends.
//
// The Discord side is sharded, so it lives in child processes managed by
// sharder.js. The Telegram side is a single long-polling connection and runs here
// in the manager process — it is cheap, it needs no inbound port, and it must sit
// on the same filesystem as the Discord shards because all of them open the same
// SQLite file (config/bot.db).
//
// Telegram is opt-in: with `telegram.enabled` false, this file behaves exactly like
// running the sharder on its own.

const config = require('../config/config.json')

require('./sharder.js')

const telegramCfg = config.telegram || {}

if (!telegramCfg.enabled) {
    console.log('[Telegram] disabled in config — Discord only')
} else if (!telegramCfg.token) {
    console.error('[Telegram] enabled but telegram.token is empty — not starting')
} else {
    startTelegram()
}

function startTelegram() {
    // Required lazily so a Discord-only deployment never pays for telegraf, and a
    // broken Telegram config can never stop the Discord shards from coming up.
    let bot
    try {
        const TelegramBot = require('./telegram/TelegramBot')
        const MailTransport = require('./core/MailTransport')
        bot = new TelegramBot({ mailTransport: new MailTransport() })
    } catch (err) {
        console.error('[Telegram] failed to construct — continuing without it:', err)
        return
    }

    bot.launch().catch((err) => {
        console.error('[Telegram] failed to start — continuing without it:', err)
    })

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            console.log(`[Telegram] stopping on ${signal}`)
            bot.stop(signal)
        })
    }
}
