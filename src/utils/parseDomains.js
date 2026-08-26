// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

/**
 * Parse a comma-separated domain input string into normalized domain patterns.
 * Accepts entries with or without a leading '@' ("gmail.com" → "@gmail.com"),
 * supports '*' wildcards (e.g. "@*.edu"), and drops anything without a dot or
 * containing a user part. Single source of truth shared by `/domain add` and
 * the `/setup` wizard.
 *
 * @param {string} input - raw comma-separated user input
 * @returns {string[]} normalized, deduplicated domain patterns (may be empty)
 */
function parseDomains(input) {
    const domains = []
    for (let domain of String(input || '').split(',')) {
        domain = domain.trim()
        if (domain.startsWith('@') && domain.includes('.')) {
            if (!domains.includes(domain)) domains.push(domain)
        } else if (domain.length > 0 && !domain.includes('@') && domain.includes('.')) {
            const formatted = '@' + domain
            if (!domains.includes(formatted)) domains.push(formatted)
        }
    }
    return domains
}

module.exports = { parseDomains }
