// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

/**
 * Namespacing for the community ids used as primary keys across the database.
 *
 * Every guildID/userID column is opaque TEXT, so a second platform can share the
 * same tables without a schema migration — provided its ids can never collide with
 * Discord's. Discord snowflakes are digits-only, so a non-numeric prefix is
 * sufficient and (unlike adding a `platform` column to five primary keys) leaves
 * the ~40 existing query methods untouched.
 *
 * Discord ids stay bare so every existing row keeps working unchanged.
 */

const DISCORD = 'discord'
const TELEGRAM = 'telegram'

// Prefix per platform. Discord is intentionally absent — its keys are the bare id.
const PREFIXES = {
    [TELEGRAM]: 't:'
}

/**
 * Build the storage key for a platform-native id.
 * @param {'discord'|'telegram'} platform
 * @param {string|number} id
 * @returns {string}
 */
function key(platform, id) {
    const raw = String(id)
    const prefix = PREFIXES[platform]
    if (!prefix) return raw
    // Idempotent: keying an already-keyed id must not double-prefix.
    return raw.startsWith(prefix) ? raw : prefix + raw
}

/**
 * Which platform a storage key belongs to. Unprefixed keys are Discord's.
 * @param {string} storageKey
 * @returns {'discord'|'telegram'}
 */
function platformOf(storageKey) {
    const raw = String(storageKey)
    for (const [platform, prefix] of Object.entries(PREFIXES)) {
        if (raw.startsWith(prefix)) return platform
    }
    return DISCORD
}

/**
 * Recover the platform-native id from a storage key (inverse of `key`).
 * Telegram chat ids are negative numbers, so the result is returned as a string
 * and the caller converts where the Bot API needs a number.
 * @param {string} storageKey
 * @returns {string}
 */
function nativeId(storageKey) {
    const raw = String(storageKey)
    const prefix = PREFIXES[platformOf(raw)]
    return prefix ? raw.slice(prefix.length) : raw
}

module.exports = { key, platformOf, nativeId, DISCORD, TELEGRAM }
