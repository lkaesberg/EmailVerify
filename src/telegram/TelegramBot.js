// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const { Telegraf } = require('telegraf')
const config = require('../../config/config.json')
const database = require('../database/Database')
const { getLocale, defaultLanguage, languages } = require('../Language')
const analytics = require('../utils/Analytics')
const { key, nativeId, TELEGRAM } = require('../core/PlatformKey')
const VerificationService = require('../core/VerificationService')
const premiumManager = require('../premium/PremiumManager')
const TelegramAuthorizer = require('./TelegramAuthorizer')
const TelegramNotifier = require('./TelegramNotifier')
const DeepLink = require('./DeepLink')
const { parseDomains } = require('../utils/parseDomains')
const StarsStore = require('./stars/StarsStore')

// How long we remember "this person is verifying for that community" after they
// arrive from a deep link. Only needed until a code exists — after that the pending
// row itself identifies the community, so this is a short-lived hint, not state.
const CONTEXT_TTL_MS = 30 * 60 * 1000

const GATE_MODES = ['joinRequest', 'mute', 'inviteLink']

// The update types we ask Telegram for.
//
// `chat_member` has to be listed explicitly: Telegram's default — which is what an
// empty allowed_updates means, and what telegraf sends when the option is omitted —
// is "every type EXCEPT chat_member". Without this list the `mute` gate never sees
// anyone arrive and silently does nothing.
const ALLOWED_UPDATES = [
    'message',
    'callback_query',
    'pre_checkout_query',
    'chat_join_request',
    'chat_member'
]

/**
 * The Telegram front-end.
 *
 * It owns nothing about *whether* someone may verify — that is
 * core/VerificationService, shared with Discord. What lives here is Telegram:
 * routing updates, the DM conversation that replaces Discord's modals, the join
 * request and mute gates, and admin setup.
 */
class TelegramBot {
    constructor({ serverStatsAPI = null, mailTransport } = {}) {
        const cfg = config.telegram || {}
        this.cfg = cfg
        this.bot = new Telegraf(cfg.token)
        this.telegram = this.bot.telegram

        this.authorizer = new TelegramAuthorizer(this.telegram, {
            inviteLinkTtlMinutes: cfg.inviteLinkTtlMinutes ?? 15
        })
        this.notifier = new TelegramNotifier(this.telegram)
        this.stars = new StarsStore(this.telegram)
        this.verification = new VerificationService({
            platform: TELEGRAM,
            mailTransport,
            authorizer: this.authorizer,
            notifier: this.notifier,
            serverStatsAPI,
            formatDate: premiumManager.plainDate
        })

        // userId -> { chatKey, ts }: which community this DM is about.
        this.context = new Map()

        this.#registerHandlers()
    }

    async launch() {
        await this.#publishCommands()
        // Long polling, deliberately: webhooks would need an ingress and a second
        // port, and port 8181 already belongs to the stats API on Discord shard 0.
        //
        // launch() only settles once polling stops, so it must not be awaited — but it
        // must be caught. This process is the Discord ShardingManager, and an unhandled
        // rejection here (a revoked token answers 401) would take the shards down with
        // it, which is exactly what the Telegram side is supposed to be unable to do.
        this.bot.launch({ dropPendingUpdates: false, allowedUpdates: ALLOWED_UPDATES })
            .catch((err) => console.error('[Telegram] polling stopped:', err))
        const me = await this.telegram.getMe()
        this.username = me.username
        if (!this.cfg.botUsername) this.cfg.botUsername = me.username
        console.log(`[Telegram] online as @${me.username}`)
        analytics.capture({ event: 'bot_online', properties: { platform: TELEGRAM } })
        this.sweepTimer = setInterval(() => this.#sweep(), 30 * 60 * 1000)
        this.sweepTimer.unref?.()
        return me
    }

    stop(reason = 'SIGTERM') {
        clearInterval(this.sweepTimer)
        try { this.bot.stop(reason) } catch { /* already stopped */ }
    }

    // ---------------------------------------------------------------------
    // wiring
    // ---------------------------------------------------------------------

    #registerHandlers() {
        const bot = this.bot

        bot.catch((err, ctx) => {
            console.error(`[Telegram] handler error on ${ctx?.updateType}:`, err)
        })

        bot.start((ctx) => this.#onStart(ctx))
        bot.command('verify', (ctx) => this.#onVerify(ctx))
        bot.command('resend', (ctx) => this.#onResend(ctx))
        bot.command('status', (ctx) => this.#onStatus(ctx))
        bot.command('cancel', (ctx) => this.#onCancel(ctx))
        bot.command('help', (ctx) => this.#reply(ctx, getLocale(defaultLanguage, 'telegramHelp')))
        bot.command('setup', (ctx) => this.#onSetup(ctx))
        bot.command('premium', (ctx) => this.#onPremium(ctx))
        bot.command('domain', (ctx) => this.#onDomain(ctx))
        bot.command('blacklist', (ctx) => this.#onBlacklist(ctx))
        bot.command('language', (ctx) => this.#onLanguage(ctx))
        bot.command('settings', (ctx) => this.#onSettings(ctx))
        bot.command('gatemode', (ctx) => this.#onGateMode(ctx))

        // Stars. answerPreCheckoutQuery has a ten-second deadline, so it is answered
        // before anything else and never waits on a database write.
        bot.on('pre_checkout_query', (ctx) => this.stars.answerPreCheckout(ctx.preCheckoutQuery))
        bot.on('message', (ctx, next) => {
            if (!ctx.message?.successful_payment) return next()
            return this.#onSuccessfulPayment(ctx)
        })

        // Someone asked to join a gated chat. We can only DM them if they have
        // started the bot before, so this is a best-effort nudge — the deep link an
        // admin publishes is the path that always works.
        bot.on('chat_join_request', (ctx) => this.#onJoinRequest(ctx))

        // The `mute` gate: hold new arrivals until they verify.
        bot.on('chat_member', (ctx) => this.#onChatMember(ctx))

        // Free-text in a private chat is either the email or the code.
        bot.on('message', (ctx, next) => {
            if (ctx.chat?.type !== 'private') return next()
            const text = ctx.message?.text
            if (!text || text.startsWith('/')) return next()
            return this.#onPrivateText(ctx, text.trim())
        })
    }

    async #publishCommands() {
        const members = [
            { command: 'verify', description: 'Start or restart email verification' },
            { command: 'resend', description: 'Send the verification code again' },
            { command: 'status', description: 'Where your verification stands' },
            { command: 'cancel', description: 'Abandon the current attempt' },
            { command: 'help', description: 'How this bot works' }
        ]
        await this.telegram.setMyCommands(members, { scope: { type: 'all_private_chats' } }).catch(() => {})
        await this.telegram.setMyCommands(
            [...members,
                { command: 'setup', description: 'Gate this chat behind email verification' },
                { command: 'gatemode', description: 'Choose how unverified members are held back' },
                { command: 'premium', description: 'Plans and credits, paid in Telegram Stars' },
                { command: 'domain', description: 'add / remove / list allowed email domains' },
                { command: 'blacklist', description: 'add / remove / list blocked email patterns' },
                { command: 'language', description: 'Set the language for this chat' },
                { command: 'settings', description: 'Show this chat\'s configuration' }],
            { scope: { type: 'all_chat_administrators' } }
        ).catch(() => {})
    }

    // ---------------------------------------------------------------------
    // member flow
    // ---------------------------------------------------------------------

    async #onStart(ctx) {
        const payload = ctx.startPayload || (ctx.message?.text || '').split(' ')[1]
        const chatId = DeepLink.decode(payload)
        if (!chatId) {
            const resumed = await this.#resumeContext(ctx.from.id)
            if (!resumed) return this.#reply(ctx, await this.#noContextMessage(ctx.from.id))
            return this.#promptFor(ctx, resumed)
        }
        const chatKey = key(TELEGRAM, chatId)
        this.#remember(ctx.from.id, chatKey)
        return this.#promptFor(ctx, chatKey)
    }

    async #onVerify(ctx) {
        if (ctx.chat?.type !== 'private') {
            // Keep the group clean: point them at the DM rather than collecting an
            // email address in front of everyone.
            const link = this.#linkFor(ctx.chat.id)
            return this.#reply(ctx, link || getLocale(defaultLanguage, 'telegramNoContext'))
        }
        const chatKey = await this.#contextFor(ctx.from.id)
        if (!chatKey) return this.#reply(ctx, await this.#noContextMessage(ctx.from.id))
        // Restart cleanly: drop any half-finished code so /verify always means "begin".
        await database.deletePendingVerification(key(TELEGRAM, ctx.from.id), chatKey).catch(() => {})
        return this.#promptFor(ctx, chatKey)
    }

    /** Ask for whichever of the two inputs is outstanding. */
    async #promptFor(ctx, chatKey) {
        const { settings, community } = await this.#load(chatKey)
        const userID = key(TELEGRAM, ctx.from.id)
        const pending = await this.verification.peekPending(chatKey, userID)
        if (pending) {
            return this.#reply(ctx, getLocale(settings.language, 'telegramAskCode'))
        }
        let text = getLocale(settings.language, 'telegramWelcome', community.name)
        if ((settings.domains || []).length > 0) {
            text += '\n\n' + getLocale(settings.language, 'telegramAllowedDomains', settings.domains.join(', '))
        }
        analytics.capture({ event: 'verification_started', userId: userID, guild: community })
        return this.#reply(ctx, text)
    }

    /** A plain message in the bot DM: an email if none is pending, otherwise a code. */
    async #onPrivateText(ctx, text) {
        const userID = key(TELEGRAM, ctx.from.id)
        const chatKey = await this.#contextFor(ctx.from.id)
        if (!chatKey) return this.#reply(ctx, await this.#noContextMessage(ctx.from.id))

        const { settings, community } = await this.#load(chatKey)
        const pending = await this.verification.peekPending(chatKey, userID)

        if (pending) {
            analytics.capture({ event: 'verification_code_submitted', userId: userID, guild: community })
            const result = await this.verification.submitCode({
                community, settings, userID, code: text, pending, passthrough: { ctx }
            })
            return this.#renderCodeOutcome(ctx, settings, community, result)
        }

        // The address is only ever needed as a hash; remove the message so it doesn't
        // sit in the user's Telegram history in plaintext.
        this.#deleteMessage(ctx).catch(() => {})
        analytics.capture({ event: 'verification_email_submitted', userId: userID, guild: community })
        const result = await this.verification.submitEmail({
            community, settings, userID, email: text, passthrough: { ctx }
        })
        return this.#renderEmailOutcome(ctx, settings, result)
    }

    async #onResend(ctx) {
        if (ctx.chat?.type !== 'private') return
        const userID = key(TELEGRAM, ctx.from.id)
        const chatKey = await this.#contextFor(ctx.from.id)
        if (!chatKey) return this.#reply(ctx, getLocale(defaultLanguage, 'telegramNoPending'))
        const { settings, community } = await this.#load(chatKey)
        const result = await this.verification.resendCode({
            community, settings, userID, passthrough: { ctx }
        })
        if (result.outcome === 'cooldown') {
            return this.#reply(ctx, getLocale(settings.language, 'telegramResendCooldown', String(result.waitSeconds)))
        }
        if (result.outcome === 'no_pending') {
            return this.#reply(ctx, getLocale(settings.language, 'telegramNoPending'))
        }
        return this.#renderEmailOutcome(ctx, settings, result)
    }

    async #onStatus(ctx) {
        if (ctx.chat?.type !== 'private') return
        const userID = key(TELEGRAM, ctx.from.id)
        const chatKey = await this.#contextFor(ctx.from.id)
        if (!chatKey) return this.#reply(ctx, getLocale(defaultLanguage, 'telegramStatusNone'))
        const { settings, community } = await this.#load(chatKey)
        const pending = await this.verification.peekPending(chatKey, userID)
        return this.#reply(ctx, pending
            ? getLocale(settings.language, 'telegramStatusPending', community.name)
            : getLocale(settings.language, 'telegramStatusNone'))
    }

    async #onCancel(ctx) {
        if (ctx.chat?.type !== 'private') return
        const userID = key(TELEGRAM, ctx.from.id)
        const chatKey = await this.#contextFor(ctx.from.id)
        if (chatKey) await database.deletePendingVerification(userID, chatKey).catch(() => {})
        this.context.delete(ctx.from.id)
        return this.#reply(ctx, getLocale(defaultLanguage, 'telegramCancelled'))
    }

    #renderEmailOutcome(ctx, settings, result) {
        const L = (k, ...v) => getLocale(settings.language, k, ...v)
        switch (result.outcome) {
            case 'code_sent':      return this.#reply(ctx, L('telegramCodeSent', result.email))
            case 'not_configured': return this.#reply(ctx, L('telegramNotConfigured'))
            case 'blacklisted':    return this.#reply(ctx, L('telegramBlacklisted'))
            case 'emaillist_locked': return this.#reply(ctx, L('emaillistLockedUserMessage'))
            case 'invalid_email':  return this.#reply(ctx, L(result.reason === 'invalid_format'
                                        ? 'telegramInvalidFormat' : 'telegramInvalidEmail'))
            case 'rate_limited':   return this.#reply(ctx, L('telegramRateLimited', String(result.waitSeconds)))
            case 'quota_denied':   return this.#reply(ctx, L('telegramQuotaDenied'))
            case 'mail_failed':    return this.#reply(ctx, L('telegramMailFailed', result.email))
            default:               return this.#reply(ctx, L('telegramGenericError'))
        }
    }

    async #renderCodeOutcome(ctx, settings, community, result) {
        const L = (k, ...v) => getLocale(settings.language, k, ...v)
        switch (result.outcome) {
            case 'success': {
                let text = L('telegramVerified', community.name)
                if (result.labels.length) text += '\n\n' + L('telegramVerifiedChats', result.labels.join(', '))
                await this.#reply(ctx, text)
                // inviteLink mode: the links are the access, so they go in their own
                // message and are never mixed into the confirmation.
                const links = result.grant?.links
                if (links && links.length) {
                    await this.#reply(ctx, L('telegramVerifiedLinks', links.map(l => `• ${l}`).join('\n')))
                }
                this.context.delete(ctx.from.id)
                return
            }
            case 'wrong_code':        return this.#reply(ctx, L('telegramWrongCode', String(result.attemptsRemaining)))
            case 'too_many_attempts': return this.#reply(ctx, L('telegramTooManyAttempts'))
            case 'expired':           return this.#reply(ctx, L('telegramCodeExpired'))
            case 'not_configured':    return this.#reply(ctx, L('telegramNotConfigured'))
            default:                  return this.#reply(ctx, L('telegramGenericError'))
        }
    }

    // ---------------------------------------------------------------------
    // gates
    // ---------------------------------------------------------------------

    async #onJoinRequest(ctx) {
        const chatKey = key(TELEGRAM, ctx.chatJoinRequest.chat.id)
        const userId = ctx.chatJoinRequest.from.id
        this.authorizer.noteJoinRequest(userId, ctx.chatJoinRequest.chat.id)

        const { settings, community } = await this.#load(chatKey)
        if (!settings.status) return

        this.#remember(userId, chatKey)
        analytics.capture({ event: 'member_joined', userId: key(TELEGRAM, userId), guild: community })

        // Failure is expected whenever they have never started the bot — there is no
        // way to reach them, which is exactly why admins publish the deep link.
        const text = getLocale(settings.language, 'telegramJoinRequestPrompt', community.name)
            + '\n\n' + getLocale(settings.language, 'telegramAskEmail')
        await this.#send(userId, text)
    }

    async #onChatMember(ctx) {
        const update = ctx.chatMember
        const wasOut = ['left', 'kicked'].includes(update.old_chat_member?.status)
        const isIn = update.new_chat_member?.status === 'member'
        if (!wasOut || !isIn) return

        const chatKey = key(TELEGRAM, update.chat.id)
        const { settings } = await this.#load(chatKey)
        if (!settings.status || settings.gateMode !== 'mute') return

        const userId = update.new_chat_member.user.id
        if (update.new_chat_member.user.is_bot) return
        await this.authorizer.mute(update.chat.id, userId).catch(() => {})
        this.#remember(userId, chatKey)
        const link = this.#linkFor(update.chat.id)
        if (link) {
            await this.#send(update.chat.id,
                getLocale(settings.language, 'telegramJoinRequestPrompt', update.chat.title) + `\n${link}`)
        }
    }

    // ---------------------------------------------------------------------
    // admin setup
    // ---------------------------------------------------------------------

    async #onSetup(ctx) {
        if (ctx.chat?.type === 'private') {
            return this.#reply(ctx, getLocale(defaultLanguage, 'telegramSetupNotGroup'))
        }
        if (!await this.#isAdmin(ctx)) {
            return this.#reply(ctx, getLocale(defaultLanguage, 'telegramAdminOnly'))
        }

        const me = await this.telegram.getChatMember(ctx.chat.id, ctx.botInfo.id).catch(() => null)
        if (!me || me.status !== 'administrator' || !me.can_invite_users) {
            return this.#reply(ctx, getLocale(defaultLanguage, 'telegramSetupNeedsAdmin'))
        }

        const chatKey = key(TELEGRAM, ctx.chat.id)
        await new Promise((resolve) => database.getServerSettings(chatKey, (settings) => {
            if (!settings.managedChats.includes(chatKey)) settings.managedChats.push(chatKey)
            database.updateServerSettings(chatKey, settings).then(resolve)
        }))

        const link = this.#linkFor(ctx.chat.id)
        analytics.capture({ event: 'guild_joined', guild: { id: chatKey, name: ctx.chat.title } })
        return this.#reply(ctx, getLocale(defaultLanguage, 'telegramSetupDone',
            ctx.chat.title, 'joinRequest', link || '(set telegram.botUsername in config)'))
    }

    async #onGateMode(ctx) {
        if (ctx.chat?.type === 'private') {
            return this.#reply(ctx, getLocale(defaultLanguage, 'telegramSetupNotGroup'))
        }
        if (!await this.#isAdmin(ctx)) {
            return this.#reply(ctx, getLocale(defaultLanguage, 'telegramAdminOnly'))
        }
        const mode = (ctx.message.text.split(/\s+/)[1] || '').trim()
        if (!GATE_MODES.includes(mode)) {
            return this.#reply(ctx, getLocale(defaultLanguage, 'telegramGateModeUnknown'))
        }
        const chatKey = key(TELEGRAM, ctx.chat.id)
        await new Promise((resolve) => database.getServerSettings(chatKey, (settings) => {
            settings.gateMode = mode
            if (!settings.managedChats.includes(chatKey)) settings.managedChats.push(chatKey)
            database.updateServerSettings(chatKey, settings).then(resolve)
        }))
        return this.#reply(ctx, getLocale(defaultLanguage, 'telegramGateModeSet', mode))
    }

    // ---------------------------------------------------------------------
    // list configuration
    //
    // Discord has a slash command per action with typed options; Telegram has bare
    // text, so these follow one shape: /<command> <add|remove|list|clear> <values>.
    // ---------------------------------------------------------------------

    #onDomain(ctx) {
        return this.#editList(ctx, {
            field: 'domains',
            normalize: parseDomains,
            emptyKey: 'telegramDomainsEmpty',
            listKey: 'telegramDomainsList',
            usageKey: 'telegramDomainUsage'
        })
    }

    #onBlacklist(ctx) {
        return this.#editList(ctx, {
            field: 'blacklist',
            // Blacklist entries are free-form wildcards ("*@tempmail.*", "*spam*"),
            // so they are taken as typed rather than normalized into domains.
            normalize: (raw) => String(raw).split(',').map(v => v.trim()).filter(Boolean),
            emptyKey: 'telegramBlacklistEmpty',
            listKey: 'telegramBlacklistList',
            usageKey: 'telegramBlacklistUsage'
        })
    }

    async #editList(ctx, { field, normalize, emptyKey, listKey, usageKey }) {
        const scope = await this.#adminScope(ctx)
        if (!scope) return
        const { chatKey } = scope

        const parts = ctx.message.text.trim().split(/\s+/)
        const action = (parts[1] || 'list').toLowerCase()
        const rest = parts.slice(2).join(' ')

        if (!['add', 'remove', 'list', 'clear'].includes(action)) {
            return this.#reply(ctx, getLocale(defaultLanguage, usageKey))
        }
        if ((action === 'add' || action === 'remove') && !rest) {
            return this.#reply(ctx, getLocale(defaultLanguage, usageKey))
        }

        const settings = await new Promise((resolve) => database.getServerSettings(chatKey, resolve))
        const current = settings[field] || []
        let next = current

        if (action === 'add') {
            const values = normalize(rest)
            if (values.length === 0) return this.#reply(ctx, getLocale(settings.language, usageKey))
            next = [...new Set([...current, ...values])]
        } else if (action === 'remove') {
            const values = normalize(rest)
            next = current.filter(v => !values.includes(v))
        } else if (action === 'clear') {
            next = []
        }

        if (action !== 'list') {
            settings[field] = next
            // Awaited: the reply below states what the list now is, and an un-awaited
            // write can still be in flight when the next command reads the row back.
            await database.updateServerSettings(chatKey, settings)
        }
        return this.#reply(ctx, next.length
            ? getLocale(settings.language, listKey, next.join(', '))
            : getLocale(settings.language, emptyKey))
    }

    async #onLanguage(ctx) {
        const scope = await this.#adminScope(ctx)
        if (!scope) return
        const requested = (ctx.message.text.split(/\s+/)[1] || '').toLowerCase()
        if (!requested || !languages.has(requested)) {
            return this.#reply(ctx, getLocale(defaultLanguage, 'telegramLanguageUsage',
                [...languages.keys()].join(', ')))
        }
        await new Promise((resolve) => database.getServerSettings(scope.chatKey, (settings) => {
            settings.language = requested
            database.updateServerSettings(scope.chatKey, settings).then(resolve)
        }))
        return this.#reply(ctx, getLocale(requested, 'telegramLanguageSet', requested))
    }

    async #onSettings(ctx) {
        const scope = await this.#adminScope(ctx)
        if (!scope) return
        const { settings, community } = await this.#load(scope.chatKey)
        const none = getLocale(settings.language, 'telegramNone')
        const text = getLocale(settings.language, 'telegramSettingsOverview',
            community.name,
            settings.gateMode || 'joinRequest',
            settings.domains.length ? settings.domains.join(', ') : none,
            settings.blacklist.length ? settings.blacklist.join(', ') : none,
            (settings.allowedEmails || []).length ? String(settings.allowedEmails.length) : '0',
            settings.language,
            this.#linkFor(Number(nativeId(scope.chatKey))) || none)
        return this.#reply(ctx, text)
    }

    /**
     * Admin commands only make sense inside the gated chat — that is also the only
     * place we can check who is an administrator. Returns null (having replied) when
     * the command was used somewhere it cannot work.
     */
    async #adminScope(ctx) {
        if (ctx.chat?.type === 'private') {
            await this.#reply(ctx, getLocale(defaultLanguage, 'telegramSetupNotGroup'))
            return null
        }
        if (!await this.#isAdmin(ctx)) {
            await this.#reply(ctx, getLocale(defaultLanguage, 'telegramAdminOnly'))
            return null
        }
        return { chatKey: key(TELEGRAM, ctx.chat.id) }
    }

    /**
     * Show the plans. Posted as payment *links* rather than invoices, because the bot
     * cannot open a conversation with an admin who has never started it, but it can
     * always post into the chat it gates.
     */
    async #onPremium(ctx) {
        if (!this.stars.enabled) {
            return this.#reply(ctx, getLocale(defaultLanguage, 'telegramStarsDisabled'))
        }
        const inGroup = ctx.chat?.type !== 'private'
        if (inGroup && !await this.#isAdmin(ctx)) {
            return this.#reply(ctx, getLocale(defaultLanguage, 'telegramAdminOnly'))
        }

        const chatKey = inGroup
            ? key(TELEGRAM, ctx.chat.id)
            : await this.#contextFor(ctx.from.id)
        if (!chatKey) return this.#reply(ctx, await this.#noContextMessage(ctx.from.id))

        // Billing is admin-only wherever it is asked from. In a DM the check has to run
        // against the gated chat, or any member who ever verified there could read the
        // community's usage, quota and credit balance.
        if (!inGroup && !await this.#isAdminOf(chatKey, ctx.from.id)) {
            return this.#reply(ctx, getLocale(defaultLanguage, 'telegramAdminOnly'))
        }

        const { settings, community } = await this.#load(chatKey)
        const status = await premiumManager.getPremiumStatus(chatKey, null)
        const lang = settings.language

        let text = getLocale(lang, 'telegramPremiumStatus',
            community.name,
            status.subscriptionTier || getLocale(lang, 'telegramPremiumNoPlan'),
            String(status.mailsSentMonth), String(status.freeLimit), String(status.bonusCredits))

        const buttons = []
        for (const item of this.stars.catalog()) {
            try {
                const url = await this.stars.createLink(item.id, chatKey)
                buttons.push([{ text: `${item.title} — ${item.stars} ⭐`, url }])
            } catch (err) {
                console.error(`[Stars] could not build a link for ${item.id}:`, err?.message || err)
            }
        }
        if (buttons.length === 0) {
            return this.#reply(ctx, text + '\n\n' + getLocale(lang, 'telegramStarsDisabled'))
        }
        text += '\n\n' + getLocale(lang, 'telegramPremiumPitch')
        return ctx.reply(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons },
            link_preview_options: { is_disabled: true }
        }).catch(() => {})
    }

    async #onSuccessfulPayment(ctx) {
        const payment = ctx.message.successful_payment
        const userKey = key(TELEGRAM, ctx.from.id)
        const result = await this.stars.applyPayment(payment, userKey)

        if (result.applied) {
            return this.#reply(ctx, getLocale(defaultLanguage, 'telegramPurchaseApplied'))
        }
        if (result.reason === 'duplicate') {
            // A redelivery of something already granted: say nothing new rather than
            // implying a second purchase happened.
            return
        }
        console.error('[Stars] payment not applied:', result.reason, payment.telegram_payment_charge_id)
        return this.#reply(ctx, getLocale(defaultLanguage, 'telegramPurchaseFailed'))
    }

    #isAdmin(ctx) {
        return this.#isAdminOf(ctx.chat.id, ctx.from.id)
    }

    /** Admin check against an arbitrary chat, so a DM can be authorized too. */
    async #isAdminOf(chatIdOrKey, userId) {
        try {
            const member = await this.telegram.getChatMember(Number(nativeId(chatIdOrKey)), userId)
            return ['creator', 'administrator'].includes(member.status)
        } catch {
            return false
        }
    }

    // ---------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------

    #remember(userId, chatKey) {
        this.context.set(userId, { chatKey, ts: Date.now() })
    }

    /** The community this DM is about: the remembered hint, else an in-flight code. */
    async #contextFor(userId) {
        const hint = this.context.get(userId)
        if (hint && Date.now() - hint.ts < CONTEXT_TTL_MS) return hint.chatKey
        return this.#resumeContext(userId)
    }

    /**
     * Recover the community from an outstanding code, so a restart (of the bot or of
     * the conversation) doesn't strand someone mid-verification.
     */
    async #resumeContext(userId) {
        const rows = await database.getPendingVerificationsForUser(key(TELEGRAM, userId))
        if (rows.length !== 1) return null
        this.#remember(userId, rows[0].guildID)
        return rows[0].guildID
    }

    /**
     * Why we don't know which community this DM is about. Two codes outstanding is a
     * different problem from none at all — telling someone to open a link they already
     * used is a dead end, so that case gets its own message.
     */
    async #noContextMessage(userId) {
        const rows = await database.getPendingVerificationsForUser(key(TELEGRAM, userId)).catch(() => [])
        return getLocale(defaultLanguage, rows.length > 1 ? 'telegramPickCommunity' : 'telegramNoContext')
    }

    async #load(chatKey) {
        const settings = await new Promise((resolve) => database.getServerSettings(chatKey, resolve))
        let name = String(chatKey)
        try {
            const chat = await this.telegram.getChat(Number(nativeId(chatKey)))
            name = chat?.title || name
        } catch { /* the bot may have been removed */ }
        return { settings, community: { id: chatKey, name } }
    }

    #linkFor(chatId) {
        try {
            return DeepLink.buildUrl(this.cfg.botUsername || this.username, chatId)
        } catch {
            return null
        }
    }

    #reply(ctx, text) {
        return ctx.reply(text, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } })
            .catch(() => ctx.reply(text).catch(() => {}))
    }

    /**
     * Same plain-text fallback as #reply, for the paths that send to a chat id rather
     * than answering an update. Chat titles go into these messages verbatim, and a
     * group called `Physics_2026` is enough to make Telegram reject the Markdown —
     * without the retry those prompts just never arrive.
     */
    #send(chatId, text) {
        return this.telegram.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            link_preview_options: { is_disabled: true }
        }).catch(() => this.telegram.sendMessage(chatId, text).catch(() => {}))
    }

    #deleteMessage(ctx) {
        return this.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id)
    }

    #sweep() {
        const now = Date.now()
        for (const [userId, v] of this.context) {
            if (now - v.ts > CONTEXT_TTL_MS) this.context.delete(userId)
        }
        for (const [k, ts] of this.authorizer.pendingJoinRequests) {
            if (now - ts > 24 * 60 * 60 * 1000) this.authorizer.pendingJoinRequests.delete(k)
        }
        // The service's rate-limiter map only drops an entry on a successful
        // verification; everyone who abandons the flow would otherwise stay in it for
        // the life of the process. Discord's shards prune the same map on their own.
        this.verification.pruneRateLimits(now)
        for (const [id, ts] of this.notifier.emaillistLockedLastNotify) {
            if (now - ts > 24 * 60 * 60 * 1000) this.notifier.emaillistLockedLastNotify.delete(id)
        }
        database.expireLapsedSubscriptions().catch(() => {})
    }
}

module.exports = TelegramBot
module.exports.GATE_MODES = GATE_MODES
module.exports.ALLOWED_UPDATES = ALLOWED_UPDATES
