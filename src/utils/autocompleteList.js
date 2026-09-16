// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Autocomplete for the comma-separated "remove" options (`/domain remove`,
// `/blacklist remove`).
//
// These used to carry static `choices` that were PATCHed into every guild's own copy of
// the command — the single reason the bot had to register commands per guild instead of
// once globally. Autocomplete gives the same pick-from-your-list experience, resolved
// when the admin types, and drops the 25-entry ceiling `choices` imposed.
//
// The one thing that would have been lost is removing several entries in one go, since
// picking a suggestion replaces the whole option value. So suggestions complete only the
// segment after the last comma and carry the earlier segments along unchanged.

// Discord's hard limits on an autocomplete response.
const MAX_RESULTS = 25
const MAX_LENGTH = 100

/** `*` is shown as `✱` everywhere else in the UI so it cannot be mistaken for markdown. */
function display(entry) {
    return entry.replaceAll('*', '✱')
}

/**
 * Build the autocomplete choices for a comma-separated option.
 *
 * @param {string} focused   the option's current raw text, e.g. `"@a.com, @b"`
 * @param {string[]} entries everything configured for this guild
 * @returns {{name: string, value: string}[]} at most 25 choices, each within Discord's
 *          100-character limit for both fields
 */
function suggestFromList(focused, entries) {
    const raw = typeof focused === 'string' ? focused : ''
    const lastComma = raw.lastIndexOf(',')
    const prefix = lastComma === -1 ? '' : raw.slice(0, lastComma + 1) + ' '
    const term = raw.slice(lastComma + 1).trim().toLowerCase()

    // Entries already named earlier in the input would be no-ops if picked again.
    const alreadyChosen = new Set(
        prefix.split(',').map(part => part.trim().toLowerCase()).filter(Boolean)
    )

    const choices = []
    for (const entry of entries) {
        if (choices.length >= MAX_RESULTS) break
        // Discord rejects a choice whose name is empty, and rejects the whole response
        // with it — on a path that runs per keystroke.
        if (typeof entry !== 'string' || entry.length === 0) continue
        const lower = entry.toLowerCase()
        if (alreadyChosen.has(lower)) continue
        if (term && !lower.includes(term)) continue

        const value = prefix + entry
        // A suggestion Discord would reject, or that cannot be sent back as a value, is
        // worse than no suggestion: skip it rather than offering a truncated entry that
        // would then match nothing on submit.
        if (value.length > MAX_LENGTH) continue

        const name = display(value)
        if (name.length > MAX_LENGTH) continue

        choices.push({ name, value })
    }
    return choices
}

module.exports = { suggestFromList }
