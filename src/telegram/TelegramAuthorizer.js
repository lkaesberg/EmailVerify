// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const database = require('../database/Database')
const { getLocale } = require('../Language')
const { nativeId } = require('../core/PlatformKey')
const { getMatchingDomainPatterns } = require('../utils/wildcardMatch')

// Permissions a muted member is left with: none. Restoring them means putting the
// chat's own defaults back, which is why grant() reads the chat before unmuting.
const MUTED = {
    can_send_messages: false,
    can_send_audios: false,
    can_send_documents: false,
    can_send_photos: false,
    can_send_videos: false,
    can_send_video_notes: false,
    can_send_voice_notes: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
    can_change_info: false,
    can_invite_users: false,
    can_pin_messages: false,
    can_manage_topics: false
}

// Fallback when getChat gives us no default permissions to restore.
const DEFAULT_MEMBER_PERMISSIONS = {
    can_send_messages: true,
    can_send_audios: true,
    can_send_documents: true,
    can_send_photos: true,
    can_send_videos: true,
    can_send_video_notes: true,
    can_send_voice_notes: true,
    can_send_polls: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
    can_change_info: false,
    can_invite_users: true,
    can_pin_messages: false,
    can_manage_topics: false
}

/**
 * How a verified member is granted access on Telegram.
 *
 * Telegram has no roles, so "the verified role" is membership itself and the admin
 * picks *how* an unverified person is held back:
 *
 *   joinRequest — the chat requires approval; we approve the pending request
 *   mute        — they joined already but can't speak; we restore their permissions
 *   inviteLink  — the chat is private; we hand them a single-use, expiring link
 *
 * Domain-specific roles become domain-specific *chats*: the existing `domainRoles`
 * column is reused verbatim, with chat ids where role ids used to be, so one
 * verification can route staff and students into different groups.
 */
class TelegramAuthorizer {
    /**
     * @param {import('telegraf').Telegram} telegram
     * @param {{inviteLinkTtlMinutes?: number}} [opts]
     */
    constructor(telegram, { inviteLinkTtlMinutes = 15 } = {}) {
        this.telegram = telegram
        this.inviteLinkTtlMs = inviteLinkTtlMinutes * 60 * 1000
        // Pending join requests we have seen, so approval knows which chats to act on
        // even when the person started the bot from a deep link instead.
        this.pendingJoinRequests = new Map()   // `${userId}:${chatId}` -> timestamp
    }

    noteJoinRequest(userId, chatId) {
        this.pendingJoinRequests.set(`${userId}:${chatId}`, Date.now())
    }

    hasJoinRequest(userId, chatId) {
        return this.pendingJoinRequests.has(`${userId}:${chatId}`)
    }

    /**
     * Which chats this email earns access to: the always-on chats plus any mapped to
     * a domain pattern the address matches, deduplicated.
     *
     * `defaultRoles` holds the always-on chats (same column, same meaning as Discord's
     * default roles). When an admin has only registered gated chats and set no
     * explicit defaults, every managed chat is the default — that is the whole point
     * of pointing the bot at a group.
     */
    resolve(community, settings, email) {
        const managed = (settings.managedChats || []).map(String)
        const defaults = (settings.defaultRoles || []).map(String)

        const domainChats = []
        const domainRoles = settings.domainRoles || {}
        for (const pattern of getMatchingDomainPatterns(email, Object.keys(domainRoles))) {
            for (const chat of domainRoles[pattern] || []) domainChats.push(String(chat))
        }

        // Has the admin said anything about *which* chats, or only which chats to gate?
        const routed = defaults.length > 0 || Object.keys(domainRoles).length > 0

        let chats = [...new Set([...defaults, ...domainChats])]
        // Never grant access to a chat this configuration doesn't actually gate.
        // This filter runs before the fallback: applying it afterwards would let a
        // single stale entry collapse the whole set and grant nothing.
        if (managed.length > 0) chats = chats.filter(c => managed.includes(c))
        // No routing configured at all: gating a chat *is* the instruction to let
        // verified people into it. With routing configured, an empty result means the
        // mapping is broken, and the caller fails loudly rather than over-granting.
        if (chats.length === 0 && !routed) chats = [...managed]

        return {
            targets: { chats },
            count: chats.length,
            // The config implies access should exist as soon as a chat is gated;
            // count 0 against that means the mapping points at chats that are gone.
            expected: managed.length > 0,
            primaryId: chats[0] || ''
        }
    }

    /**
     * Let the member in, by whichever mechanism the admin chose. Partial success is
     * still success: getting into two of three chats beats being told to start over,
     * and the failures are reported back for the admin notification.
     */
    async grant(community, settings, userID, targets) {
        const mode = settings.gateMode || 'joinRequest'
        const userId = Number(nativeId(userID))
        const labels = []
        const links = []
        const failures = []

        for (const chatKey of targets.chats) {
            const chatId = Number(nativeId(chatKey))
            try {
                if (mode === 'inviteLink') {
                    links.push(await this.#issueInviteLink(chatId))
                } else if (mode === 'mute') {
                    await this.#unmute(chatId, userId)
                } else {
                    await this.#approveJoin(chatId, userId)
                }
                labels.push(await this.#chatTitle(chatId))
            } catch (err) {
                failures.push({ chat: chatKey, error: err?.message || String(err) })
            }
        }

        if (labels.length === 0) {
            return {
                ok: false,
                detail: failures[0]?.error ? `grant_error: ${failures[0].error}` : 'grant_error',
                labels: [],
                failures
            }
        }
        return { ok: true, labels, links, failures }
    }

    /**
     * Remove whoever previously verified with this email, so one address can't hold
     * seats in the same community under two accounts. Fire-and-forget, matching
     * Discord's behaviour.
     */
    revokePrevious(community, settings, emailHash, newUserID, targets, language) {
        database.getEmailUser(emailHash, community.id, async (previous) => {
            if (!previous || previous.userID === newUserID) return
            const previousId = Number(nativeId(previous.userID))
            if (!Number.isFinite(previousId)) return

            for (const chatKey of targets.chats) {
                const chatId = Number(nativeId(chatKey))
                try {
                    if ((settings.gateMode || 'joinRequest') === 'mute') {
                        await this.telegram.restrictChatMember(chatId, previousId, { permissions: MUTED })
                    } else {
                        // banChatMember + unban removes them without a lasting ban, which
                        // is Telegram's idiom for "kick".
                        await this.telegram.banChatMember(chatId, previousId)
                        await this.telegram.unbanChatMember(chatId, previousId, { only_if_banned: true })
                    }
                } catch { /* they may have left already */ }
            }
            this.telegram.sendMessage(previousId, getLocale(language, 'unverifiedByOtherDm', community.name))
                .catch(() => { /* they may never have started the bot */ })
        })
    }

    /** Hold a newly-joined member: used by the `mute` gate when someone walks in. */
    async mute(chatId, userId) {
        return this.telegram.restrictChatMember(Number(chatId), Number(userId), { permissions: MUTED })
    }

    async #approveJoin(chatId, userId) {
        try {
            await this.telegram.approveChatJoinRequest(chatId, userId)
        } catch (err) {
            // No pending request (they were never gated, or an admin already let them
            // in) is a success from the member's point of view.
            const desc = err?.description || err?.message || ''
            if (/USER_ALREADY_PARTICIPANT|HIDE_REQUESTER_MISSING|not found/i.test(desc)) return
            throw err
        }
    }

    async #unmute(chatId, userId) {
        let permissions = DEFAULT_MEMBER_PERMISSIONS
        try {
            const chat = await this.telegram.getChat(chatId)
            if (chat && chat.permissions) permissions = chat.permissions
        } catch { /* fall back to a sane default set */ }
        await this.telegram.restrictChatMember(chatId, userId, { permissions })
    }

    async #issueInviteLink(chatId) {
        const link = await this.telegram.createChatInviteLink(chatId, {
            member_limit: 1,
            expire_date: Math.floor((Date.now() + this.inviteLinkTtlMs) / 1000),
            name: 'EmailVerify'
        })
        return link.invite_link
    }

    async #chatTitle(chatId) {
        try {
            const chat = await this.telegram.getChat(chatId)
            return chat?.title || String(chatId)
        } catch {
            return String(chatId)
        }
    }
}

module.exports = TelegramAuthorizer
module.exports.MUTED = MUTED
module.exports.DEFAULT_MEMBER_PERMISSIONS = DEFAULT_MEMBER_PERMISSIONS
