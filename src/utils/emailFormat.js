// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Longest address SMTP can carry (RFC 5321: a 256-octet path minus the brackets).
const MAX_EMAIL_LENGTH = 254

// One @, a dotted domain, and none of the characters that carry meaning in RFC 5322
// address syntax: comments ( ), angle brackets < >, lists and groups , ; :, quotes
// and escapes " \, domain literals [ ], whitespace and control characters. Real
// mailboxes never contain them, but the mail library honours them: it reads
// "x@evil.com(.edu" as x@evil.com with a comment, so that address would pass an
// "@*.edu" domain rule while the code went to evil.com.
const EMAIL_FORMAT = /^[^\s\x00-\x1f\x7f@()<>[\],;:\\"]+@[^\s\x00-\x1f\x7f@()<>[\],;:\\"]+\.[^\s\x00-\x1f\x7f@()<>[\],;:\\"]+$/

/**
 * Whether a string is a plain email address that is safe to match against domain
 * rules and hand to a mail provider. Unicode is allowed; RFC 5322 syntax is not.
 */
function isValidEmailAddress(email) {
    return typeof email === 'string' && email.length <= MAX_EMAIL_LENGTH && EMAIL_FORMAT.test(email)
}

module.exports = { isValidEmailAddress, MAX_EMAIL_LENGTH }
