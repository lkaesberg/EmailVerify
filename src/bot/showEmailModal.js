const {ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, TextDisplayBuilder, MessageFlags} = require('discord.js');
const database = require("../database/Database");
const {getLocale} = require("../Language");
const {createSessionExpiredEmbed} = require("../utils/embeds");

/**
 * Checks if a domain is a full wildcard (accepts all emails)
 * Matches: *, @*, @*.*, *.*, etc.
 * @param {string} domain - The domain string
 * @returns {boolean}
 */
function isFullWildcard(domain) {
    const trimmed = domain.trim().replace('@', '')
    // Check for patterns that accept all emails:
    // "*", "*.*", "**", etc. - anything that's only wildcards and dots
    return /^[\*\.]+$/.test(trimmed)
}

/**
 * Creates a pattern description with [any] placeholders
 * @param {string} pattern - Domain pattern without @ (e.g., "*.edu", "gmail.*")
 * @returns {string} - Pattern like "[any].edu" or "gmail.[any]"
 */
function createPatternDescription(pattern) {
    return pattern.replace(/\*/g, '[any]')
}

/**
 * Creates an example domain by replacing wildcards with realistic placeholders
 * @param {string} pattern - Domain pattern without @ (e.g., "*.edu", "gmail.*", "*.*.de")
 * @returns {string} - Example domain (e.g., "company.edu", "gmail.com", "mail.company.de")
 */
function createExampleDomain(pattern) {
    const parts = pattern.split('.')
    const exampleWords = ['company', 'mail', 'example']
    let wordIndex = 0
    
    return parts.map(part => {
        if (part === '*') {
            const word = exampleWords[wordIndex % exampleWords.length]
            wordIndex++
            return word
        }
        return part
    }).join('.')
}

/**
 * Formats a domain for display with pattern and example
 * @param {string} domain - The domain string (e.g., "@example.com", "@*.edu", "@gmail.*")
 * @param {string} language - The language code for localization
 * @returns {string} - Formatted domain string
 */
function formatDomain(domain, language) {
    const trimmed = domain.trim()
    const withoutAt = trimmed.replace('@', '')
    
    // If no wildcards, show as simple code-formatted domain
    if (!withoutAt.includes('*')) {
        return `\`[name]${trimmed}\``
    }
    
    // Create pattern description and example
    const pattern = '[name]@' + createPatternDescription(withoutAt)
    const example = 'name@' + createExampleDomain(withoutAt)
    
    return getLocale(language, "emailModalDomainExample", pattern, example)
}

/**
 * Shows the email verification modal in response to an interaction
 * @param {Interaction} interaction - The Discord interaction to respond to
 * @param {Guild} guild - The guild context for verification
 * @param {Map} userGuilds - Map to store user-guild associations
 */
async function showEmailModal(interaction, guild, userGuilds) {
    if (!guild) {
        await interaction.reply({ embeds: [createSessionExpiredEmbed(false)], flags: MessageFlags.Ephemeral }).catch(() => {})
        return false
    }
    userGuilds.set(interaction.user.id, guild)
    
    await database.getServerSettings(guild.id, async serverSettings => {
        const language = serverSettings.language
        const domains = serverSettings.domains || []
        
        // Build header text
        let headerText = getLocale(language, "emailModalHeader")
        
        // Check if all domains are accepted (if ANY domain is a full wildcard, all emails are accepted)
        const hasNoDomains = domains.length === 0
        const hasAnyFullWildcard = domains.some(d => isFullWildcard(d))
        const allDomainsAccepted = hasNoDomains || hasAnyFullWildcard
        
        if (allDomainsAccepted) {
            // All domains accepted
            headerText += `\n\n${getLocale(language, "emailModalAllDomainsAccepted")}`
        } else {
            // Show formatted domain list
            headerText += `\n\n${getLocale(language, "emailModalAcceptedDomains")}`
            domains.forEach((domain, index) => {
                const formatted = formatDomain(domain, language)
                headerText += `\n${index + 1}. ${formatted}`
            })
        }
        
        // Add custom verify message if set
        if (serverSettings.verifyMessage !== "") {
            headerText += `\n\n${serverSettings.verifyMessage}`
        }
        
        // Add admin warning if log channel is enabled
        if (serverSettings.logChannel !== "") {
            headerText += getLocale(language, "emailModalAdminWarning")
        }
        
        const modal = new ModalBuilder()
            .setCustomId('emailModal')
            .setTitle(getLocale(language, "emailModalTitle"))
        
        // Build placeholder with smart domain hint
        let placeholder = getLocale(language, "emailModalPlaceholder")
        const firstDomain = domains[0] || '@example.com'
        if (isFullWildcard(firstDomain)) {
            placeholder += 'example.com'
        } else if (firstDomain.includes('*')) {
            // For wildcard like "@*.edu", show "example.edu"
            placeholder += 'example' + firstDomain.replace('@', '').replace('*', '')
        } else {
            // Domain already has @, so just remove it for placeholder
            placeholder += firstDomain.replace('@', '')
        }
        
        const emailInput = new TextInputBuilder()
            .setCustomId('emailInput')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(placeholder)
            .setRequired(true)
        
        const emailLabel = new LabelBuilder()
            .setLabel(getLocale(language, "emailModalLabel"))
            .setTextInputComponent(emailInput)
        
        const headerDisplay = new TextDisplayBuilder().setContent(headerText)
        
        modal
            .addTextDisplayComponents(headerDisplay)
            .addLabelComponents(emailLabel)
        
        await interaction.showModal(modal).catch(() => {})
    })
    return true
}

module.exports = { showEmailModal }

