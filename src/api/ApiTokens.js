// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Issuing and checking of the Tier 2 restriction-list API tokens.
//
// Only the SHA-256 of a token is ever persisted (see migration 21). The plaintext
// exists for exactly one ephemeral Discord reply and is unrecoverable afterwards,
// so a leaked database yields nothing usable and "I lost it" is answered by
// regenerating rather than by us being able to read it back.

const crypto = require('crypto')

// Recognisable prefix so a leaked string is greppable and obviously a credential.
const TOKEN_PREFIX = 'evk_'
const TOKEN_BYTES = 32

/**
 * Mint a new token. Returns { token, tokenHash } — `token` is shown to the admin
 * once and then discarded; only `tokenHash` is stored.
 */
function generateToken() {
    const token = TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString('base64url')
    return { token, tokenHash: hashToken(token) }
}

/** SHA-256, hex. Used both when storing and when authenticating a request. */
function hashToken(token) {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Pull the bearer token out of an Authorization header. Returns null when the
 * header is absent or not a well-formed bearer credential, so the caller can
 * answer 401 without having to parse anything itself.
 */
function extractBearer(authorizationHeader) {
    if (typeof authorizationHeader !== 'string') return null
    const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim())
    return match ? match[1] : null
}

module.exports = { generateToken, hashToken, extractBearer, TOKEN_PREFIX }
