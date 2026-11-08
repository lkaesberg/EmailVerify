// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Patterns come from guild admins and the strings from members, so matching must
// not be a backtracking regex: `a*a*a*a*a*a*a*b` compiled to `a.*a.*…b` takes
// time exponential in the number of wildcards on a 254-character input and
// blocks the whole shard. globMatch below walks the string once and keeps the
// set of pattern positions that can still match, so it runs in
// O(string length × pattern length) whatever the pattern. It matches exactly
// what the old `.*` regexes matched: every other character is literal, the
// comparison folds case the way a RegExp with the `i` flag does, and `*` does not
// cross a line break (as `.` did not).

// An address is at most 254 characters, so a longer pattern is a mistake.
// Matching stays linear without these limits; they keep stored lists sane.
const MAX_PATTERN_LENGTH = 254;
const MAX_PATTERN_WILDCARDS = 10;

const STAR = 0x2a;
const WILDCARD = -1;

/**
 * Whether a pattern may be stored in a blacklist, domain or domain-role list
 * @param {string} pattern - The pattern with optional * wildcards
 * @returns {boolean} True if the pattern is within the length and wildcard limits
 */
function isAcceptablePattern(pattern) {
    return typeof pattern === 'string'
        && pattern.length <= MAX_PATTERN_LENGTH
        && pattern.split('*').length - 1 <= MAX_PATTERN_WILDCARDS;
}

/** The line terminators `.` never matched without the `s` flag. */
function isLineTerminator(code) {
    return code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;
}

/** Case folding of a RegExp with the `i` flag and no `u` flag (ECMAScript Canonicalize). */
function canonicalize(code) {
    const upper = String.fromCharCode(code).toUpperCase();
    if (upper.length !== 1) return code;
    const folded = upper.charCodeAt(0);
    if (code >= 128 && folded < 128) return code;
    return folded;
}

/** Marks every state reachable by letting a wildcard match nothing. */
function closeOverWildcards(units, states) {
    for (let j = 0; j < units.length; j++) {
        if (states[j] && units[j] === WILDCARD) states[j + 1] = 1;
    }
}

/**
 * Match a string against a wildcard pattern in linear time
 * @param {string} str - The string to test
 * @param {string} pattern - The pattern with optional * wildcards
 * @param {Object} options - Options for the match
 * @param {'contains'|'suffix'|'full'} options.anchor - Match anywhere, at the end, or the whole string (default: contains)
 * @param {boolean} options.caseInsensitive - If true, match is case-insensitive (default: true)
 * @returns {boolean} True if the string matches the pattern
 */
function globMatch(str, pattern, options = {}) {
    const { anchor = 'contains', caseInsensitive = true } = options;
    const units = [];
    for (let j = 0; j < pattern.length; j++) {
        const code = pattern.charCodeAt(j);
        units.push(code === STAR ? WILDCARD : (caseInsensitive ? canonicalize(code) : code));
    }
    const end = units.length;
    const anchoredStart = anchor === 'full';
    const anchoredEnd = anchor !== 'contains';

    // live[j] is set when the first j pattern units match a run of str ending here.
    let live = new Uint8Array(end + 1);
    let next = new Uint8Array(end + 1);
    live[0] = 1;
    closeOverWildcards(units, live);
    if (!anchoredEnd && live[end]) return true;

    for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if (caseInsensitive) code = canonicalize(code);
        const lineBreak = isLineTerminator(code);
        next.fill(0);
        for (let j = 0; j < end; j++) {
            if (!live[j]) continue;
            if (units[j] === WILDCARD) {
                if (!lineBreak) next[j] = 1;
            } else if (units[j] === code) {
                next[j + 1] = 1;
            }
        }
        if (!anchoredStart) next[0] = 1;
        closeOverWildcards(units, next);
        if (!anchoredEnd && next[end]) return true;
        [live, next] = [next, live];
    }
    return live[end] === 1;
}

/**
 * Check if a string matches a wildcard pattern
 * @param {string} str - The string to test
 * @param {string} pattern - The pattern with optional * wildcards
 * @param {Object} options - Options for the match
 * @param {boolean} options.fullMatch - If true, pattern must match entire string (default: false)
 * @param {boolean} options.caseInsensitive - If true, match is case-insensitive (default: true)
 * @returns {boolean} True if the string matches the pattern
 */
function matchesWildcard(str, pattern, options = {}) {
    const { fullMatch = false, caseInsensitive = true } = options;
    return globMatch(str, pattern, { anchor: fullMatch ? 'full' : 'contains', caseInsensitive });
}

/**
 * Check if a string matches any of the given wildcard patterns
 * @param {string} str - The string to test
 * @param {string[]} patterns - Array of patterns with optional * wildcards
 * @param {Object} options - Options passed to matchesWildcard
 * @returns {boolean} True if the string matches any pattern
 */
function matchesAnyWildcard(str, patterns, options = {}) {
    return patterns.some(pattern => matchesWildcard(str, pattern, options));
}

/**
 * Check if an email matches any of the allowed domain patterns
 * Domain patterns can include * wildcards (e.g., @*.edu, @*.harvard.edu)
 * @param {string} email - The email address to check
 * @param {string[]} domainPatterns - Array of domain patterns (e.g., @gmail.com, @*.edu)
 * @returns {boolean} True if the email matches any domain pattern
 */
function emailMatchesDomains(email, domainPatterns) {
    email = email.toLowerCase();

    for (const pattern of domainPatterns) {
        // Domain patterns should match at the end of the email (domain part)
        if (globMatch(email, pattern, { anchor: 'suffix' })) {
            return true;
        }
    }
    return false;
}

/**
 * Check if an email is blacklisted
 * Blacklist patterns can include * wildcards and match anywhere in the email
 * @param {string} email - The email address to check
 * @param {string[]} blacklistPatterns - Array of blacklist patterns
 * @returns {boolean} True if the email is blacklisted
 */
function emailIsBlacklisted(email, blacklistPatterns) {
    email = email.toLowerCase();

    for (const pattern of blacklistPatterns) {
        // Blacklist patterns match anywhere in the email (contains match)
        if (globMatch(email, pattern, { anchor: 'contains' })) {
            return true;
        }
    }
    return false;
}

/**
 * Get all domain patterns that match an email address
 * Returns all matching patterns (not just the first or most specific)
 * @param {string} email - The email address to check
 * @param {string[]} domainPatterns - Array of domain patterns (e.g., @gmail.com, @*.edu)
 * @returns {string[]} Array of all matching domain patterns
 */
function getMatchingDomainPatterns(email, domainPatterns) {
    email = email.toLowerCase();
    // Domain patterns should match at the end of the email (domain part)
    return domainPatterns.filter(pattern => globMatch(email, pattern, { anchor: 'suffix' }));
}

module.exports = {
    MAX_PATTERN_LENGTH,
    MAX_PATTERN_WILDCARDS,
    isAcceptablePattern,
    globMatch,
    matchesWildcard,
    matchesAnyWildcard,
    emailMatchesDomains,
    emailIsBlacklisted,
    getMatchingDomainPatterns
};
