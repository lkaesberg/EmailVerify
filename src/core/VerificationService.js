// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const crypto = require('crypto')
const database = require('../database/Database')
const md5hash = require('../crypto/Crypto')
const EmailUser = require('../database/EmailUser')
const UserTimeout = require('../UserTimeout')
const analytics = require('../utils/Analytics')
const premiumManager = require('../premium/PremiumManager')
const { emailMatchesDomains, emailIsBlacklisted } = require('../utils/wildcardMatch')

// Verification code lifetime and the number of wrong guesses tolerated before the
// code is invalidated. The old in-memory codes had neither, leaving a 100k-keyspace
// code brute-forceable with unlimited attempts and no expiry.
const CODE_TTL_MS = 15 * 60 * 1000
const MAX_CODE_ATTEMPTS = 5
// Flat cooldown between "Resend code" clicks (separate from the escalating
// email-request backoff — resending to the SAME address is lower-risk).
const RESEND_COOLDOWN_MS = 60 * 1000
// How long a rate-limiter entry may sit idle past its backoff before a sweep may
// drop it. Entries are only removed on a successful verification, so without this
// everyone who abandons the flow stays in the map for the life of the process.
const RATE_LIMIT_IDLE_MS = 60 * 60 * 1000

// Deliberately stricter than the old "exactly one @ and no space", which admitted
// `a@b`, `@x` and `a@.` and handed them straight to the mail provider. Not
// RFC-complete — it wants a non-empty local part free of whitespace and address
// separators, and a domain with a real TLD.
const EMAIL_RE = /^[^\s@<>,;:"'\\]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/
const EMAIL_MAX_LENGTH = 254

/**
 * The verification flow itself, with no knowledge of the chat platform it serves.
 *
 * Every rule that decides whether someone may verify lives here — blacklists,
 * domain matching, the purchaser allowlist, rate limiting, the mail quota, code
 * TTL and attempt caps, and the atomic consume that stops one code being redeemed
 * twice. Each method returns an *outcome object*; rendering that outcome to a
 * human is the adapter's job, because an ephemeral Discord embed and a Telegram DM
 * have nothing in common.
 *
 * Two collaborators are injected because they are irreducibly platform-specific:
 *
 *   authorizer — grants access once the code is right. Discord adds roles;
 *                Telegram approves a join request, unmutes, or issues a one-time
 *                invite link. See the interface notes on `submitCode`.
 *   notifier   — fire-and-forget admin/operator messages (quota warnings, the
 *                "bot isn't configured" nudge). Every hook is optional.
 */
class VerificationService {
    /**
     * @param {Object} opts
     * @param {'discord'|'telegram'} opts.platform
     * @param {import('./MailTransport')} opts.mailTransport
     * @param {Object} opts.authorizer
     * @param {Object} [opts.notifier]
     * @param {Object} [opts.serverStatsAPI]  global counters; optional
     * @param {Function} [opts.formatDate]    how this platform renders a date in text
     */
    constructor({ platform, mailTransport, authorizer, notifier = {}, serverStatsAPI = null, formatDate = premiumManager.plainDate }) {
        this.platform = platform
        this.mailTransport = mailTransport
        this.authorizer = authorizer
        this.notifier = notifier
        this.serverStatsAPI = serverStatsAPI
        this.formatDate = formatDate

        // Best-effort, in-process email-send rate limiter. Keyed per user *per
        // community* so abusive escalation in one place neither penalizes nor is
        // reset by the same person's legitimate activity in another.
        this.userTimeouts = new Map()
    }

    get codeTtlMs() { return CODE_TTL_MS }
    get maxAttempts() { return MAX_CODE_ATTEMPTS }
    get resendCooldownMs() { return RESEND_COOLDOWN_MS }

    /**
     * Read the pending code without touching it. Adapters call this before doing any
     * expensive work (Discord REST-fetches the guild), since "no code on file" is by
     * far the most common failure and needs nothing else to answer.
     */
    peekPending(guildID, userID) {
        return database.getPendingVerification(userID, guildID)
    }

    /**
     * Step 1: someone submitted an email address.
     *
     * @param {Object} opts
     * @param {{id: string, name?: string}} opts.community  storage-keyed community
     * @param {Object} opts.settings                        ServerSettings
     * @param {string} opts.userID
     * @param {string} opts.email                           as typed
     * @param {*} [opts.entitlements]                       Discord entitlements, if any
     * @param {*} [opts.passthrough]                        handed back to notifier hooks
     * @returns {Promise<Object>} outcome
     */
    async submitEmail({ community, settings, userID, email, entitlements = null, passthrough = null }) {
        const guildID = community.id
        const emailText = String(email).trim()
        const ctx = { community, settings, userID, passthrough, language: settings.language }

        if (!settings.status) {
            this.#reject(ctx, 'not_configured')
            this.#hook('notConfigured', ctx)
            return { outcome: 'not_configured' }
        }

        // Blacklist check (supports wildcards, e.g., *@tempmail.*, spam*)
        if (emailIsBlacklisted(emailText, settings.blacklist)) {
            this.#reject(ctx, 'blacklisted')
            return { outcome: 'blacklisted' }
        }

        // Locked-list gate: an allowedEmails list exists from a prior Pro / CSV unlock,
        // but the community can no longer manage it. Block all verifications until the
        // admin either clears the list or restores CSV access.
        const allowedEmails = settings.allowedEmails || []
        if (allowedEmails.length > 0) {
            const csvCheck = await premiumManager.canUseCSVFeature(guildID, entitlements)
            if (!csvCheck.allowed) {
                this.#reject(ctx, 'emaillist_locked')
                this.#hook('emaillistLocked', ctx)
                return { outcome: 'emaillist_locked' }
            }
        }

        // Domain allowlist check (supports wildcards, e.g., @*.edu, @*.harvard.edu).
        // Also checks against the uploaded email list. If neither domains nor an
        // allowedEmails list is configured, all valid addresses are accepted
        // (subject to the blacklist).
        const hasValidFormat = emailText.length <= EMAIL_MAX_LENGTH && EMAIL_RE.test(emailText)
        const noRestrictionsConfigured = settings.domains.length === 0 && allowedEmails.length === 0
        const matchesDomain = emailMatchesDomains(emailText, settings.domains)
        // allowedEmails are stored as MD5 hashes of the lowercased address (same scheme as userEmails)
        const isInAllowedList = allowedEmails.includes(md5hash(emailText.toLowerCase()))

        if (!hasValidFormat || (!noRestrictionsConfigured && !matchesDomain && !isInAllowedList)) {
            const reason = hasValidFormat ? 'domain_not_allowed' : 'invalid_format'
            this.#reject(ctx, reason)
            return { outcome: 'invalid_email', reason }
        }

        const limited = this.#checkRateLimit(userID, guildID)
        if (limited) {
            this.#reject(ctx, 'rate_limited')
            return { outcome: 'rate_limited', waitSeconds: limited.waitSeconds }
        }

        const premiumCheck = await this.#admitSend(ctx, guildID, entitlements, { resend: false })
        if (!premiumCheck.allowed) {
            return { outcome: 'quota_denied', premiumCheck }
        }

        const lowered = emailText.toLowerCase()
        return this.#issueCode({
            ctx,
            guildID,
            userID,
            toEmail: lowered,
            emailHash: md5hash(lowered),
            premiumCheck
        })
    }

    /**
     * "Resend code": mail a fresh code to the address already on file. Consumes
     * quota exactly like a first send, behind its own flat cooldown.
     */
    async resendCode({ community, settings, userID, pending = undefined, entitlements = null, passthrough = null }) {
        const guildID = community.id
        const ctx = { community, settings, userID, passthrough, language: settings.language }

        const row = pending === undefined ? await this.peekPending(guildID, userID) : pending
        if (!row) return { outcome: 'no_pending' }

        const sinceLast = Date.now() - (row.lastSentAt || 0)
        if (sinceLast < RESEND_COOLDOWN_MS) {
            return { outcome: 'cooldown', waitSeconds: Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000) }
        }

        const premiumCheck = await this.#admitSend(ctx, guildID, entitlements, { resend: true })
        if (!premiumCheck.allowed) {
            return { outcome: 'quota_denied', premiumCheck }
        }

        const result = await this.#issueCode({
            ctx,
            guildID,
            userID,
            toEmail: row.logEmail,
            emailHash: row.emailHash,
            premiumCheck
        })
        if (result.outcome === 'code_sent') {
            analytics.capture({ event: 'verification_code_resent', userId: userID, guild: community })
        }
        return result
    }

    /**
     * Step 2: someone submitted a code.
     *
     * The authorizer must provide:
     *   resolve(community, settings, email)
     *     → { targets, count, expected, primaryId }
     *       `count` is how many access grants resolved, `expected` whether the config
     *       implies there should have been any — the pair catches a config that points
     *       at roles/chats that no longer exist instead of silently verifying nobody.
     *   grant(community, settings, userID, targets, email) → { ok, labels?, detail?, ... }
     *     anything else it returns is passed to the adapter as outcome.grant.
     *   revokePrevious(community, settings, emailHash, newUserID, targets, language)
     *     fire-and-forget; strips access from whoever verified with this email before.
     */
    async submitCode({ community, settings, userID, code, pending = undefined, passthrough = null }) {
        const guildID = community.id
        const ctx = { community, settings, userID, passthrough, language: settings.language }

        const row = pending === undefined ? await this.peekPending(guildID, userID) : pending
        if (!row) {
            this.#codeFailed(ctx, 'expired')
            return { outcome: 'expired' }
        }

        if (!settings.status) {
            this.#codeFailed(ctx, 'not_configured')
            this.#hook('notConfigured', ctx)
            return { outcome: 'not_configured' }
        }

        // Wrong code: count the attempt and invalidate the code once the cap is hit
        // so a 6-digit code can't be brute-forced. incrementPendingAttempts is a
        // single atomic UPDATE…RETURNING; on a DB error we fail closed (generic
        // error, attempt not revealed) instead of treating it as "not at the cap".
        if (!this.#codeMatches(row.code, code)) {
            const attempts = await database.incrementPendingAttempts(userID, guildID)
            if (attempts === 'error') {
                this.#codeFailed(ctx, 'db_error')
                return { outcome: 'db_error' }
            }
            if (attempts === null) {
                // Row vanished between read and increment: consumed or expired.
                this.#codeFailed(ctx, 'expired')
                return { outcome: 'expired' }
            }
            if (attempts >= MAX_CODE_ATTEMPTS) {
                await database.deletePendingVerification(userID, guildID)
                this.#codeFailed(ctx, 'too_many_attempts')
                return { outcome: 'too_many_attempts' }
            }
            this.#codeFailed(ctx, 'wrong_code')
            return { outcome: 'wrong_code', attemptsRemaining: MAX_CODE_ATTEMPTS - attempts }
        }

        // Correct code → consume it atomically. If another submission of the same
        // code already consumed it, this delete reports no change and we bail out
        // instead of double-verifying.
        const consumed = await database.deletePendingVerification(userID, guildID)
        if (!consumed) {
            this.#codeFailed(ctx, 'expired')
            return { outcome: 'expired' }
        }

        // If anything below fails before access is granted, restore the pending row
        // (with its remaining TTL) so the user can resubmit the same code instead of
        // burning another email send from the community's quota.
        const restorePending = () => database.setPendingVerification(userID, guildID, {
            code: row.code,
            emailHash: row.emailHash,
            logEmail: row.logEmail,
            expiresAt: row.expiresAt
        }).catch(() => {})

        const resolved = this.authorizer.resolve(community, settings, row.logEmail)

        // Config expects access grants but none resolved (roles/chats deleted, or a
        // stale cache): don't silently verify with nothing granted.
        if (resolved.count === 0 && resolved.expected) {
            await restorePending()
            this.#codeFailed(ctx, 'authorization_failed', 'no_targets_resolved')
            this.#hook('authorizationFailed', ctx, 'no_targets_resolved')
            return { outcome: 'authorization_failed', detail: 'no_targets_resolved' }
        }

        const granted = await this.authorizer.grant(community, settings, userID, resolved.targets, row.logEmail)
        if (!granted || !granted.ok) {
            await restorePending()
            const detail = granted?.detail || 'grant_error'
            this.#codeFailed(ctx, 'authorization_failed', detail)
            this.#hook('authorizationFailed', ctx, detail)
            return { outcome: 'authorization_failed', detail }
        }

        // Only now that access actually exists: take it away from whoever held this
        // address before, and record the new owner. Doing either before the grant meant
        // a failed grant had already kicked the previous holder (Telegram revokes with
        // ban+unban) and left the database claiming a verification that never happened.
        try {
            this.authorizer.revokePrevious?.(community, settings, row.emailHash, userID, resolved.targets, settings.language)
        } catch (e) {
            console.error('[Verification] revokePrevious failed:', e)
        }

        // Persist the new verified user (primary grant kept in the legacy field for back-compat).
        await database.updateEmailUser(new EmailUser(row.emailHash, userID, guildID, resolved.primaryId || '', 0))

        const labels = granted.labels || []
        this.#hook('verified', ctx, { email: row.logEmail, labels })

        this.serverStatsAPI?.increaseVerifiedUsers()
        database.incrementVerifications(guildID)
        analytics.capture({
            event: 'verification_completed',
            userId: userID,
            guild: community,
            properties: { roles_assigned: labels.length }
        })
        // Clear the rate limiter so a returning user isn't stuck behind the
        // escalating email-send backoff.
        this.userTimeouts.delete(userID + guildID)

        // `grant` carries whatever the platform produced beyond labels — for Telegram
        // that's the single-use invite links, which *are* the access and so must reach
        // the adapter rather than being summarised away.
        return { outcome: 'success', email: row.logEmail, labels, grant: granted }
    }

    // -----------------------------------------------------------------------
    // internals
    // -----------------------------------------------------------------------

    /** Generate, mail and persist a fresh code. Shared by first send and resend. */
    async #issueCode({ ctx, guildID, userID, toEmail, emailHash, premiumCheck }) {
        // 6-digit code from a CSPRNG (the old Math.random()+1 scheme only ever
        // produced 100000–199999).
        const code = crypto.randomInt(100000, 1000000).toString()

        const result = await this.mailTransport.send({
            toEmail,
            code,
            communityName: ctx.community.name,
            guildID,
            language: ctx.settings.language,
            emailStyle: ctx.settings.emailStyle,
            premiumSource: premiumCheck.source,
            guildLabel: ctx.community.name
        })

        if (!result.ok) {
            analytics.capture({
                event: 'mail_failed',
                userId: userID,
                guild: ctx.community,
                properties: { provider_attempted: result.provider || 'unknown', source: premiumCheck.source }
            })
            return { outcome: 'mail_failed', error: result.error, email: toEmail }
        }

        analytics.capture({
            event: 'mail_sent',
            userId: userID,
            guild: ctx.community,
            properties: { provider: result.provider, source: premiumCheck.source, email_style: ctx.settings.emailStyle }
        })

        // Persist only after a confirmed send — a code the user can never receive
        // would just burn their attempts.
        await database.setPendingVerification(userID, guildID, {
            code,
            emailHash,
            logEmail: toEmail,
            expiresAt: Date.now() + CODE_TTL_MS
        })

        try {
            const crossings = await database.recordMailSentAndCheckThresholds(
                guildID, premiumCheck.source, premiumManager.freeMonthlyLimit
            )
            this.#hook('quotaWarnings', ctx, crossings)
            if (premiumCheck.source === 'credits-zepto' && crossings.creditsRemaining !== null && crossings.creditsRemaining <= 0) {
                const flipped = await database.tryAutoDisableZeptoMode(guildID)
                if (flipped) this.#hook('zeptoAutoDisabled', ctx)
            }
        } catch (e) {
            console.error('[Verification] Failed to record/check thresholds:', e)
            database.incrementMailsSent(guildID)
        }

        return { outcome: 'code_sent', email: result.accepted || toEmail }
    }

    /** Quota gate, plus the analytics and admin escalation a denial triggers. */
    async #admitSend(ctx, guildID, entitlements, { resend }) {
        const premiumCheck = await premiumManager.canSendMail(guildID, entitlements)
        if (premiumCheck.autoDisabled) {
            this.#hook('zeptoAutoDisabled', ctx)
        }
        if (!premiumCheck.allowed) {
            analytics.capture({
                event: 'mail_denied',
                userId: ctx.userID,
                guild: ctx.community,
                properties: {
                    reason: premiumCheck.reason || 'limit_reached',
                    mails_sent_month: premiumCheck.mailsSentMonth ?? null,
                    free_limit: premiumCheck.freeLimit ?? null,
                    ...(resend ? { resend: true } : {})
                }
            })
            // Record the denial and fire the escalating admin upsell — this is lost
            // demand admins can't see otherwise.
            this.#hook('mailDenied', ctx, premiumCheck)
        }
        return premiumCheck
    }

    /**
     * Escalating per-user backoff on email *requests*. Returns null when the send may
     * proceed (and charges the attempt), or the remaining wait.
     */
    #checkRateLimit(userID, guildID) {
        const key = userID + guildID
        let userTimeout = this.userTimeouts.get(key)
        if (!userTimeout) {
            userTimeout = new UserTimeout()
            this.userTimeouts.set(key, userTimeout)
        }
        const timeoutMs = userTimeout.timestamp + userTimeout.waitseconds * 1000 - Date.now()
        if (timeoutMs > 0) {
            return { waitSeconds: Number((timeoutMs / 1000).toFixed(0)) }
        }
        userTimeout.timestamp = Date.now()
        userTimeout.increaseWaitTime()
        return null
    }

    /**
     * Constant-time code comparison. The attempt cap already makes brute force
     * impractical, so this is belt-and-braces — but it costs nothing, and the length
     * check leaks only a length that is fixed at six digits anyway.
     */
    #codeMatches(expected, given) {
        const a = Buffer.from(String(expected))
        const b = Buffer.from(String(given))
        if (a.length !== b.length) return false
        return crypto.timingSafeEqual(a, b)
    }

    /**
     * Drop rate-limiter entries whose backoff elapsed long ago. Called from each
     * front-end's periodic sweep; without it the map only ever shrinks when someone
     * completes a verification.
     */
    pruneRateLimits(now = Date.now(), maxIdleMs = RATE_LIMIT_IDLE_MS) {
        for (const [k, t] of this.userTimeouts) {
            if (t.timestamp + t.waitseconds * 1000 < now - maxIdleMs) this.userTimeouts.delete(k)
        }
    }

    #reject(ctx, reason) {
        analytics.capture({
            event: 'verification_email_rejected',
            userId: ctx.userID,
            guild: ctx.community,
            properties: { reason }
        })
    }

    #codeFailed(ctx, reason, detail = null) {
        analytics.capture({
            event: 'verification_code_failed',
            userId: ctx.userID,
            guild: ctx.community,
            properties: detail ? { reason, detail } : { reason }
        })
    }

    /** Call an optional notifier hook without ever letting it break the flow. */
    #hook(name, ...args) {
        const fn = this.notifier?.[name]
        if (typeof fn !== 'function') return
        try {
            const r = fn.apply(this.notifier, args)
            if (r && typeof r.catch === 'function') r.catch(() => {})
        } catch (e) {
            console.error(`[Verification] notifier.${name} failed:`, e)
        }
    }
}

module.exports = VerificationService
module.exports.CODE_TTL_MS = CODE_TTL_MS
module.exports.MAX_CODE_ATTEMPTS = MAX_CODE_ATTEMPTS
module.exports.RESEND_COOLDOWN_MS = RESEND_COOLDOWN_MS
module.exports.RATE_LIMIT_IDLE_MS = RATE_LIMIT_IDLE_MS
