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

/**
 * Creates a verification log embed for the log channel
 * @param {Object} options - Options for the embed
 * @param {Object} options.user - The Discord user who was verified
 * @param {string} options.email - The email address used for verification
 * @param {string} options.type - Type of verification: 'email' or 'manual'
 * @param {Object} [options.admin] - The admin who performed manual verification (for manual type)
 * @param {Object} [options.role] - The verified role that was assigned
 * @returns {EmbedBuilder}
 */
function createVerificationLogEmbed({ user, email, type, admin, role }) {
    const isManual = type === 'manual';
    
    const embed = new EmbedBuilder()
        .setAuthor({
            name: user.tag || user.username,
            iconURL: user.displayAvatarURL({ dynamic: true })
        })
        .setColor(isManual ? 0xFFA500 : 0x57F287)
        .setTimestamp();

    if (isManual) {
        embed.setTitle('🔧 Manual Verification');
        embed.setDescription(`<@${user.id}> was manually verified by an administrator.`);
        embed.addFields(
            { name: '👤 User', value: `<@${user.id}>\n\`${user.id}\``, inline: true },
            { name: '📧 Email', value: `\`${email}\``, inline: true },
            { name: '👮 Verified By', value: admin ? `<@${admin.id}>` : 'Unknown', inline: true }
        );
    } else {
        embed.setTitle('✅ Email Verification');
        embed.setDescription(`<@${user.id}> has successfully verified their email.`);
        embed.addFields(
            { name: '👤 User', value: `<@${user.id}>\n\`${user.id}\``, inline: true },
            { name: '📧 Email', value: `\`${email}\``, inline: true }
        );
    }

    if (role) {
        embed.addFields({ name: '🎭 Role Assigned', value: `<@&${role.id}>`, inline: true });
    }

    embed.setFooter({ 
        text: isManual ? 'Manual verification' : 'Email verification'
    });

    return embed;
}

/**
 * Creates a verification failed log embed for the log channel
 * @param {Object} options - Options for the embed
 * @param {Object} options.user - The Discord user who failed verification
 * @param {string} options.email - The email address attempted
 * @param {string} options.reason - Reason for failure
 * @returns {EmbedBuilder}
 */
function createVerificationFailedLogEmbed({ user, email, reason }) {
    return new EmbedBuilder()
        .setTitle('❌ Verification Failed')
        .setAuthor({
            name: user.tag || user.username,
            iconURL: user.displayAvatarURL({ dynamic: true })
        })
        .setDescription(`<@${user.id}> failed to verify.`)
        .addFields(
            { name: '👤 User', value: `<@${user.id}>\n\`${user.id}\``, inline: true },
            { name: '📧 Email Attempted', value: email ? `\`${email}\`` : 'N/A', inline: true },
            { name: '❓ Reason', value: reason, inline: false }
        )
        .setColor(0xED4245)
        .setTimestamp()
        .setFooter({ text: 'Verification attempt failed' });
}

module.exports = {
    createSessionExpiredEmbed,
    createInvalidCodeEmbed,
    createInvalidEmailEmbed,
    createVerificationSuccessEmbed,
    createCodeSentEmbed,
    createVerificationLogEmbed,
    createVerificationFailedLogEmbed
};
