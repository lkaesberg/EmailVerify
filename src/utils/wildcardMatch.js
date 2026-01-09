/**
 * Escape a string for use in a regular expression
 * Uses RegExp.escape() if available (Node.js 23+), otherwise provides a polyfill
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/escape
 * @param {string} str - The string to escape
 * @returns {string} The escaped string safe for use in RegExp
 */
function escapeRegExp(str) {
    if (typeof RegExp.escape === 'function') {
        return RegExp.escape(str);
    }
    // Polyfill: escape all regex special characters
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a wildcard pattern to a RegExp
 * Supports * as a wildcard that matches any characters
 * @param {string} pattern - The pattern with optional * wildcards
 * @param {Object} options - Options for the regex
 * @param {boolean} options.fullMatch - If true, pattern must match entire string (default: false)
 * @param {boolean} options.caseInsensitive - If true, match is case-insensitive (default: true)
 * @returns {RegExp} The compiled regular expression
 */
function wildcardToRegex(pattern, options = {}) {
    const { fullMatch = false, caseInsensitive = true } = options;
    
    // Split by * to get literal parts
    const parts = pattern.split('*');
    
    // Escape each part and join with .* (match any characters)
    const regexPattern = parts.map(part => escapeRegExp(part)).join('.*');
    
    // Build final pattern
    const finalPattern = fullMatch ? `^${regexPattern}$` : regexPattern;
    const flags = caseInsensitive ? 'i' : '';
    
    return new RegExp(finalPattern, flags);
}

/**
 * Check if a string matches a wildcard pattern
 * @param {string} str - The string to test
 * @param {string} pattern - The pattern with optional * wildcards
 * @param {Object} options - Options passed to wildcardToRegex
 * @returns {boolean} True if the string matches the pattern
 */
function matchesWildcard(str, pattern, options = {}) {
    const regex = wildcardToRegex(pattern, options);
    return regex.test(str);
}

/**
 * Check if a string matches any of the given wildcard patterns
 * @param {string} str - The string to test
 * @param {string[]} patterns - Array of patterns with optional * wildcards
 * @param {Object} options - Options passed to wildcardToRegex
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
        // Domain patterns should match at the end of the email
        const regex = wildcardToRegex(pattern, { fullMatch: false, caseInsensitive: true });
        
        // Ensure it matches at the end (domain part)
        const endPattern = new RegExp(regex.source + '$', regex.flags);
        if (endPattern.test(email)) {
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
        if (matchesWildcard(email, pattern, { fullMatch: false, caseInsensitive: true })) {
            return true;
        }
    }
    return false;
}

module.exports = {
    escapeRegExp,
    wildcardToRegex,
    matchesWildcard,
    matchesAnyWildcard,
    emailMatchesDomains,
    emailIsBlacklisted
};
