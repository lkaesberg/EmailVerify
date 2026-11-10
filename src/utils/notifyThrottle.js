// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Throttled admin/operator alerts, shared by every shard and surviving restarts.
// The window is claimed in the database before sending, so two shards seeing the same
// problem send one alert; when the alert reaches no one the claim is handed back, so
// a failed send retries after RETRY_MS rather than suppressing alerts for the whole
// interval.

const RETRY_MS = 5 * 60 * 1000

/**
 * @param {string} kind
 * @param {string} scope guild id, or '*' for a bot-wide alert
 * @param {number} intervalMs
 * @param {(suppressed: number) => Promise<boolean>} send resolves true when the alert reached someone
 * @returns {Promise<{sent: boolean}|null>} null when throttled, else whether the alert went out
 */
async function throttledNotify(kind, scope, intervalMs, send) {
    const database = require('../database/Database.js')
    const claim = await database.claimNotification(kind, scope, intervalMs)
    if (!claim) return null
    let sent = false
    try {
        sent = (await send(claim.suppressed)) === true
    } catch (e) {
        console.warn(`[notifyThrottle] ${kind} alert for ${scope} failed:`, e?.message || e)
    }
    if (!sent) {
        await database.releaseNotification(kind, scope, claim.claimID, intervalMs, Math.min(RETRY_MS, intervalMs))
    }
    return { sent }
}

module.exports = { throttledNotify, RETRY_MS }
