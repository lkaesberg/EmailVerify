// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// A bot cannot open a conversation: sendMessage to someone who has never pressed
// Start fails with "chat not found". So the public entry point to verification is a
// link to the *bot*, not to the group — pressing Start creates the chat, and this
// payload tells us which community they came for.
//
// Telegram allows 1–64 characters matching [A-Za-z0-9_-], which rules out the
// leading minus of a supergroup id; 'n' stands in for it.

const PREFIX = 'v'
const MAX_PAYLOAD = 64

/** Chat id (number or string, possibly negative) → start payload. */
function encode(chatId) {
    const raw = String(chatId).trim()
    if (!/^-?\d+$/.test(raw)) throw new Error(`not a chat id: ${raw}`)
    const payload = PREFIX + raw.replace('-', 'n')
    if (payload.length > MAX_PAYLOAD) throw new Error('chat id too long for a start payload')
    return payload
}

/** Start payload → chat id as a string, or null if it isn't one of ours. */
function decode(payload) {
    if (typeof payload !== 'string') return null
    const trimmed = payload.trim()
    if (!trimmed.startsWith(PREFIX)) return null
    const body = trimmed.slice(PREFIX.length)
    if (!/^n?\d+$/.test(body)) return null
    return body.startsWith('n') ? '-' + body.slice(1) : body
}

/** The link an admin shares so members can start verifying. */
function buildUrl(botUsername, chatId) {
    const name = String(botUsername || '').replace(/^@/, '')
    if (!name) throw new Error('telegram.botUsername is not configured')
    return `https://t.me/${name}?start=${encode(chatId)}`
}

module.exports = { encode, decode, buildUrl }
