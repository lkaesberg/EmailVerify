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
