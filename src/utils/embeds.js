const { EmbedBuilder } = require('discord.js');
const { getLocale } = require('../Language');

/**
 * Creates a "Session Expired" embed for when user is not linked to a guild
 * @param {boolean} includeEmailStep - Whether to include step 3 about entering email
 * @returns {EmbedBuilder}
 */
function createSessionExpiredEmbed(includeEmailStep = true) {
    let description = 'Your verification session has expired or was not started properly.\n\n**How to fix:**\n1. Go back to the server\'s verification channel\n2. Click the verification button to start fresh';
    if (includeEmailStep) {
        description += '\n3. Enter your email to receive a new code';
    }
    
    return new EmbedBuilder()
        .setTitle('❌ Session Expired')
        .setDescription(description)
        .setColor(0xED4245);
}

/**
 * Creates an "Invalid Code" embed
 * @param {string} language - Language code for localization
 * @returns {EmbedBuilder}
 */
function createInvalidCodeEmbed(language) {
    return new EmbedBuilder()
        .setTitle(getLocale(language, 'invalidCodeTitle'))
        .setDescription(getLocale(language, 'invalidCodeDescription'))
        .setColor(0xED4245);
}

/**
 * Creates an "Invalid Email" embed
 * @param {string} language - Language code for localization
 * @returns {EmbedBuilder}
 */
function createInvalidEmailEmbed(language) {
    return new EmbedBuilder()
        .setTitle(getLocale(language, 'mailInvalidTitle'))
        .setDescription(getLocale(language, 'mailInvalidDescription'))
        .setColor(0xED4245);
}

/**
 * Creates a "Verification Success" embed
 * @param {string} language - Language code for localization
 * @param {string} roleName - Name of the verified role
 * @param {string} serverName - Name of the server
 * @param {string} serverIconURL - URL of the server icon
 * @returns {EmbedBuilder}
 */
function createVerificationSuccessEmbed(language, roleName, serverName, serverIconURL) {
    return new EmbedBuilder()
        .setTitle(getLocale(language, 'verificationSuccessTitle'))
        .setDescription(getLocale(language, 'verificationSuccessDescription', roleName, serverName))
        .setColor(0x57F287)
        .setThumbnail(serverIconURL);
}

/**
 * Creates a "Code Sent" embed
 * @param {string} language - Language code for localization
 * @param {string} email - Email address the code was sent to
 * @returns {EmbedBuilder}
 */
function createCodeSentEmbed(language, email) {
    return new EmbedBuilder()
        .setTitle(getLocale(language, 'codePromptTitle'))
        .setDescription(getLocale(language, 'codePromptDescription', email))
        .setColor(0x57F287)
        .addFields({
            name: getLocale(language, 'codePromptTip'),
            value: getLocale(language, 'codePromptTipValue')
        });
}

module.exports = {
    createSessionExpiredEmbed,
    createInvalidCodeEmbed,
    createInvalidEmailEmbed,
    createVerificationSuccessEmbed,
    createCodeSentEmbed
};

