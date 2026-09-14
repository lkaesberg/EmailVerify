// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Tier 2 restriction-list API: lets a subscribing server manage its allowed-email
// list from its own systems (student information system, HR export, CRM) instead
// of re-uploading a CSV through Discord by hand.
//
// Mounted on the existing stats Express app, which only listens on the primary
// shard -- so every request lands in one process even though slash commands run
// across all of them. Writes therefore go through Database's transactional
// helpers rather than updateServerSettings, which would rewrite the whole
// settings row and clobber concurrent edits made from another shard.
//
// Addresses are stored as MD5 hashes of the lowercased address, the same scheme
// /emaillist upload uses, so the list stays consistent no matter which route
// wrote it. That also means the API can add, remove and count entries but can
// never read the addresses back.

const express = require('express')
const database = require('../database/Database')
const md5hash = require('../crypto/Crypto')
const premiumManager = require('../premium/PremiumManager')
const { hashToken, extractBearer } = require('./ApiTokens')

// Same shape the CSV importer accepts, so an address that works in an upload
// works here and vice versa.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Caps on a single request. The list lives in one JSON column, so an unbounded
// batch would be both a slow transaction and a large row.
const MAX_EMAILS_PER_REQUEST = 10000
const MAX_BODY_BYTES = '1mb'

// Per-guild fixed-window rate limit. The API shares a process with the gateway
// shard, so a hot loop from one server must not starve the bot.
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX_REQUESTS = 60

// Separate, tighter budget for requests that never authenticate. Guild-keyed
// limiting cannot apply to those -- there is no guild yet -- so without this an
// anonymous caller could spend our database on unlimited token lookups. Tokens are
// 256-bit random, so this is about load, not about making guessing harder.
const UNAUTH_LIMIT_MAX_REQUESTS = 20

class RateLimiter {
    constructor(maxRequests) {
        this.maxRequests = maxRequests
        this.windows = new Map()
    }

    /** Returns { allowed, retryAfterSeconds, remaining }. */
    hit(key) {
        const now = Date.now()
        let entry = this.windows.get(key)
        if (!entry || now >= entry.resetAt) {
            entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
            this.windows.set(key, entry)
        }
        entry.count++
        if (entry.count > this.maxRequests) {
            return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000), remaining: 0 }
        }
        return { allowed: true, remaining: this.maxRequests - entry.count }
    }

    /** Drop windows that have already expired so the map can't grow without bound. */
    sweep() {
        const now = Date.now()
        for (const [key, entry] of this.windows) {
            if (now >= entry.resetAt) this.windows.delete(key)
        }
    }
}

function fail(res, status, code, message, extra) {
    return res.status(status).json({ error: { code, message, ...(extra || {}) } })
}

/**
 * Normalize a request's addresses into hashes.
 * Accepts { email: "a@b.com" } or { emails: [...] } so adding one and adding many
 * are the same endpoint.
 *
 * Returns { hashes, accepted, invalid } or { error } for a malformed body.
 */
function parseEmailsPayload(body) {
    let raw
    if (body && typeof body.email === 'string') {
        raw = [body.email]
    } else if (body && Array.isArray(body.emails)) {
        raw = body.emails
    } else {
        return { error: 'Body must be {"email": "user@example.com"} or {"emails": ["user@example.com", ...]}.' }
    }

    if (raw.length === 0) return { error: 'No addresses supplied.' }
    if (raw.length > MAX_EMAILS_PER_REQUEST) {
        return { error: `Too many addresses in one request (${raw.length}); the maximum is ${MAX_EMAILS_PER_REQUEST}.` }
    }

    const accepted = []
    const invalid = []
    const hashes = []
    const seen = new Set()

    for (const entry of raw) {
        if (typeof entry !== 'string') {
            invalid.push(String(entry))
            continue
        }
        const normalized = entry.trim().toLowerCase()
        if (!EMAIL_REGEX.test(normalized)) {
            invalid.push(entry)
            continue
        }
        if (seen.has(normalized)) continue
        seen.add(normalized)
        accepted.push(normalized)
        hashes.push(md5hash(normalized))
    }

    return { hashes, accepted, invalid }
}

/**
 * Build the router.
 * @param {import('discord.js').Client} bot - used to re-check the guild's live
 *   Tier 2 entitlement on every request, so access lapses with the subscription.
 */
function createRestrictionListRouter(bot) {
    const router = express.Router()
    const limiter = new RateLimiter(RATE_LIMIT_MAX_REQUESTS)
    const unauthLimiter = new RateLimiter(UNAUTH_LIMIT_MAX_REQUESTS)
    const sweepTimer = setInterval(() => {
        limiter.sweep()
        unauthLimiter.sweep()
    }, RATE_LIMIT_WINDOW_MS)
    // Never hold the process open just for the rate-limit sweep.
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref()

    /** Charge a failed-authentication attempt to the caller's address, then 401. */
    const rejectUnauthenticated = (req, res, code, message) => {
        const ip = req.ip || req.socket?.remoteAddress || 'unknown'
        const gate = unauthLimiter.hit(`ip:${ip}`)
        if (!gate.allowed) {
            res.set('Retry-After', String(gate.retryAfterSeconds))
            return fail(res, 429, 'rate_limited',
                `Too many failed authentication attempts. Limit is ${UNAUTH_LIMIT_MAX_REQUESTS} per minute.`,
                { retryAfterSeconds: gate.retryAfterSeconds })
        }
        res.set('WWW-Authenticate', 'Bearer')
        return fail(res, 401, code, message)
    }

    router.use(express.json({ limit: MAX_BODY_BYTES }))

    // Turn body-parser's own errors into the same JSON envelope as everything else,
    // instead of Express's default HTML error page.
    router.use((err, req, res, next) => {
        if (err) {
            if (err.type === 'entity.too.large') {
                return fail(res, 413, 'payload_too_large', `Request body exceeds ${MAX_BODY_BYTES}.`)
            }
            return fail(res, 400, 'invalid_json', 'Request body is not valid JSON.')
        }
        next()
    })

    // --- authentication + entitlement check ---------------------------------
    router.use(async (req, res, next) => {
        const token = extractBearer(req.get('authorization'))
        if (!token) {
            return rejectUnauthenticated(req, res, 'missing_token',
                'Provide your token as "Authorization: Bearer <token>".')
        }

        let guildId
        try {
            guildId = await database.getGuildIdByApiTokenHash(hashToken(token))
        } catch (e) {
            console.error('[RestrictionAPI] token lookup failed:', e)
            return fail(res, 500, 'internal_error', 'Could not verify the token.')
        }
        if (!guildId) {
            return rejectUnauthenticated(req, res, 'invalid_token',
                'Unknown or revoked token. Generate a new one with /api token generate.')
        }

        // Rate limit per guild rather than per IP: the credential identifies the
        // tenant, and one server behind many addresses is still one server.
        const gate = limiter.hit(guildId)
        if (!gate.allowed) {
            res.set('Retry-After', String(gate.retryAfterSeconds))
            return fail(res, 429, 'rate_limited',
                `Too many requests. Limit is ${RATE_LIMIT_MAX_REQUESTS} per minute.`,
                { retryAfterSeconds: gate.retryAfterSeconds })
        }

        // Re-check the subscription on every request so access stops when it lapses,
        // rather than living as long as the token does.
        let entitlements = null
        try {
            entitlements = await bot.application.entitlements.fetch({ guild: guildId, excludeEnded: true })
        } catch (e) {
            console.warn(`[RestrictionAPI] entitlement fetch failed for guild ${guildId}:`, e?.message || e)
            // Fail closed: we would rather reject a legitimate request during a Discord
            // outage than let a lapsed subscription keep writing.
            return fail(res, 503, 'entitlement_check_failed',
                'Could not confirm the subscription right now. Please retry shortly.')
        }

        const check = await premiumManager.canUseApiFeature(guildId, entitlements)
        if (!check.allowed) {
            return fail(res, 403, 'tier2_required',
                'The restriction-list API requires an active top-tier subscription for this server.')
        }

        req.guildId = guildId
        res.set('X-RateLimit-Remaining', String(gate.remaining))
        database.touchGuildApiToken(guildId)
        next()
    })

    // --- endpoints -----------------------------------------------------------

    /** Token / connection check. Handy as the first call when wiring up a client. */
    router.get('/me', async (req, res) => {
        const count = await database.getAllowedEmailCount(req.guildId)
        const guild = bot.guilds?.cache?.get(req.guildId)
        res.json({
            guildId: req.guildId,
            guildName: guild ? guild.name : null,
            tier: 'tier2',
            allowedEmails: count === null ? 0 : count
        })
    })

    /** Entry count. The addresses themselves are hashed and cannot be returned. */
    router.get('/emails', async (req, res) => {
        const count = await database.getAllowedEmailCount(req.guildId)
        if (count === null) {
            return fail(res, 404, 'guild_not_configured',
                'This server has no settings yet. Run /setup in Discord first.')
        }
        res.json({ count, stored: 'md5', note: 'Addresses are stored hashed and cannot be listed back.' })
    })

    /** Add one address or many — same endpoint, singular or plural body. */
    router.post('/emails', async (req, res) => {
        const parsed = parseEmailsPayload(req.body)
        if (parsed.error) return fail(res, 400, 'invalid_body', parsed.error)

        if (parsed.hashes.length === 0) {
            return fail(res, 400, 'no_valid_addresses',
                'None of the supplied addresses were valid.', { invalid: parsed.invalid })
        }

        try {
            const result = await database.addAllowedEmailHashes(req.guildId, parsed.hashes)
            if (result.missing) {
                return fail(res, 404, 'guild_not_configured',
                    'This server has no settings yet. Run /setup in Discord first.')
            }
            res.json({
                added: result.added,
                skipped: result.skipped,
                invalid: parsed.invalid,
                total: result.total
            })
        } catch (e) {
            console.error('[RestrictionAPI] add failed:', e)
            fail(res, 500, 'internal_error', 'Could not update the list.')
        }
    })

    /**
     * Remove one address. The address is hashed and matched against the stored
     * hashes -- we never need the plaintext back to delete it.
     */
    router.delete('/emails/:email', async (req, res) => {
        const normalized = String(req.params.email || '').trim().toLowerCase()
        if (!EMAIL_REGEX.test(normalized)) {
            return fail(res, 400, 'invalid_address', `"${req.params.email}" is not a valid email address.`)
        }

        try {
            const result = await database.removeAllowedEmailHash(req.guildId, md5hash(normalized))
            if (result.missing) {
                return fail(res, 404, 'guild_not_configured',
                    'This server has no settings yet. Run /setup in Discord first.')
            }
            if (result.removed === 0) {
                return fail(res, 404, 'not_in_list', 'That address is not on the list.', { total: result.total })
            }
            res.json({ removed: result.removed, total: result.total })
        } catch (e) {
            console.error('[RestrictionAPI] remove failed:', e)
            fail(res, 500, 'internal_error', 'Could not update the list.')
        }
    })

    /**
     * Empty the list. Requires ?confirm=true so a mistyped DELETE against the
     * collection can't wipe a list by accident.
     */
    router.delete('/emails', async (req, res) => {
        if (req.query.confirm !== 'true') {
            return fail(res, 400, 'confirmation_required',
                'Deleting the whole list requires ?confirm=true.')
        }

        try {
            const result = await database.clearAllowedEmails(req.guildId)
            if (result.missing) {
                return fail(res, 404, 'guild_not_configured',
                    'This server has no settings yet. Run /setup in Discord first.')
            }
            res.json({ removed: result.removed, total: 0 })
        } catch (e) {
            console.error('[RestrictionAPI] clear failed:', e)
            fail(res, 500, 'internal_error', 'Could not clear the list.')
        }
    })

    router.use((req, res) => fail(res, 404, 'not_found', `No such endpoint: ${req.method} ${req.baseUrl}${req.path}`))

    // Terminal error handler. Express only forwards to error middleware registered
    // *after* the failing layer, so the body-parser handler above cannot catch these.
    // Without this an unexpected throw would fall through to Express's default HTML
    // error page, breaking every client's JSON parsing.
    router.use((err, req, res, next) => {
        console.error('[RestrictionAPI] unhandled error:', err)
        if (res.headersSent) return next(err)
        fail(res, 500, 'internal_error', 'Unexpected server error.')
    })

    return router
}

module.exports = { createRestrictionListRouter, EMAIL_REGEX, MAX_EMAILS_PER_REQUEST }
