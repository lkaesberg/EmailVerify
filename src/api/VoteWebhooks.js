// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Vote webhooks from the bot lists, mounted at /webhooks on the stats server:
//
//   POST /webhooks/topgg           top.gg; v1 (HMAC-signed) and legacy v0 (shared secret)
//   POST /webhooks/discordbotlist  discordbotlist.com; shared secret
//
// A route only exists while its secret is configured. Answers: 200 once the vote is
// recorded (or recognised as a repeat), 401 for a bad secret or signature, 400 for a
// body that isn't a vote, 500 when recording failed, so the list retries. Retries are
// safe: recordVote drops a repeat from the same user.

const crypto = require('crypto')
const express = require('express')
const config = require('../../config/config.json')
const voting = require('../utils/voting')
const analytics = require('../utils/Analytics')

// top.gg signs the send time into each delivery. Reject older ones so a captured
// request can't be replayed later; generous, since retries back off for seconds.
const SIGNATURE_TOLERANCE_S = 10 * 60
const BODY_LIMIT = '16kb'
const SNOWFLAKE = /^\d{17,20}$/

// The endpoints are public, so anyone can hit them. A rejection is worth one event
// (a mistyped secret shows up right away), but not one per probe.
const REJECT_REPORT_INTERVAL_MS = 10 * 60 * 1000
const lastRejectReport = new Map()

function reject(res, source, status, reason) {
    const key = `${source}:${reason}`
    const now = Date.now()
    if (now - (lastRejectReport.get(key) || 0) >= REJECT_REPORT_INTERVAL_MS) {
        lastRejectReport.set(key, now)
        analytics.capture({ event: 'vote_webhook_rejected', properties: { source, reason, http_status: status } })
    }
    return res.status(status).json({ error: reason.replace(/_/g, ' ') })
}

function safeEqual(a, b) {
    const x = Buffer.from(String(a))
    const y = Buffer.from(String(b))
    return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/**
 * v1: `x-topgg-signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`.
 * v0 (legacy) sends the secret itself in `Authorization`.
 */
function verifyTopgg(req, secret, rawBody) {
    const header = req.get('x-topgg-signature')
    if (!header) return safeEqual(req.get('authorization') || '', secret)

    const parts = {}
    for (const part of header.split(',')) {
        const eq = part.indexOf('=')
        if (eq > 0) parts[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
    }
    const t = Number(parts.t)
    if (!Number.isFinite(t) || !parts.v1) return false
    if (Math.abs(Date.now() / 1000 - t) > SIGNATURE_TOLERANCE_S) return false
    const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex')
    return safeEqual(expected, parts.v1)
}

/** Both top.gg payload generations, reduced to what a reward needs. */
function parseTopgg(body) {
    switch (body?.type) {
        case 'vote.create':
            return { userId: body.data?.user?.platform_id, guildId: body.data?.query?.guild }
        case 'upvote':
            return { userId: body.user, guildId: new URLSearchParams(body.query || '').get('guild') }
        case 'webhook.test':
            return { test: true, userId: body.data?.user?.platform_id }
        case 'test':
            return { test: true, userId: body.user }
        default:
            return null
    }
}

async function credit(res, client, vote) {
    try {
        const result = await voting.processVote({ ...vote, client })
        res.status(200).json({ ok: true, duplicate: result.duplicate, bonusGranted: result.bonusGranted })
    } catch (e) {
        console.error(`[Votes] Failed to record ${vote.source} vote:`, e?.message || e)
        analytics.capture({
            event: 'vote_webhook_failed',
            userId: vote.userId,
            properties: { source: vote.source, error: String(e?.message || e).slice(0, 300) }
        })
        res.status(500).json({ error: 'internal error' })
    }
}

function createVoteWebhookRouter(client) {
    const router = express.Router()

    const topggSecret = config.topggWebhookSecret
    if (topggSecret) {
        // Raw body: the v1 signature covers the exact bytes sent.
        router.post('/topgg', express.raw({ type: () => true, limit: BODY_LIMIT }), async (req, res) => {
            const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''
            if (!verifyTopgg(req, topggSecret, rawBody)) return reject(res, 'topgg', 401, 'invalid_signature')

            let vote
            try {
                vote = parseTopgg(JSON.parse(rawBody))
            } catch {
                vote = null
            }
            if (!vote || !SNOWFLAKE.test(String(vote.userId))) return reject(res, 'topgg', 400, 'not_a_vote')
            if (vote.test) {
                console.log(`[Votes] top.gg test webhook received (user ${vote.userId})`)
                analytics.capture({ event: 'vote_webhook_test', userId: vote.userId, properties: { source: 'topgg' } })
                return res.status(200).json({ ok: true, test: true })
            }
            await credit(res, client, { source: 'topgg', userId: vote.userId, queryGuildId: vote.guildId })
        })
    }

    const dblSecret = config.discordbotlistWebhookSecret
    if (dblSecret) {
        router.post('/discordbotlist', express.json({ type: () => true, limit: BODY_LIMIT }), async (req, res) => {
            if (!safeEqual(req.get('authorization') || '', dblSecret)) return reject(res, 'discordbotlist', 401, 'invalid_secret')
            const userId = req.body?.id
            if (!SNOWFLAKE.test(String(userId))) return reject(res, 'discordbotlist', 400, 'not_a_vote')
            await credit(res, client, { source: 'discordbotlist', userId: String(userId) })
        })
    }

    return router
}

module.exports = { createVoteWebhookRouter, verifyTopgg, parseTopgg }
