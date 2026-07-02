const { getMatchingDomainPatterns } = require('./wildcardMatch')
const { getLocale } = require('../Language')
const database = require('../database/Database')

/**
 * Resolve which roles a verified member should receive, given the guild config
 * and the email they verified with. Combines the always-on default roles with
 * any roles mapped to domain patterns the email matches, deduplicates them, and
 * resolves them to live role objects (dropping any that no longer exist).
 *
 * This is the single source of truth for verification role assignment, shared by
 * the email-verification flow and `/manualverify` so both honour defaultRoles and
 * domainRoles identically. The guild's roles cache must be populated.
 *
 * @param {import('discord.js').Guild} guild
 * @param {Object} serverSettings - parsed ServerSettings (defaultRoles, domainRoles, unverifiedRoleName)
 * @param {string} email - lowercased email address used for verification
 * @returns {{ rolesToAdd: import('discord.js').Role[], roleUnverified: import('discord.js').Role|null }}
 */
function resolveVerificationRoles(guild, serverSettings, email) {
    const defaultRoles = serverSettings.defaultRoles || []
    const domainRoles = serverSettings.domainRoles || {}

    const matchingPatterns = getMatchingDomainPatterns(email, Object.keys(domainRoles))
    const domainRoleIds = []
    for (const pattern of matchingPatterns) {
        if (domainRoles[pattern]) {
            domainRoleIds.push(...domainRoles[pattern])
        }
    }

    const allRoleIds = [...new Set([...defaultRoles, ...domainRoleIds])]
    const rolesToAdd = allRoleIds
        .map(id => guild.roles.cache.get(id))
        .filter(role => role !== undefined)

    const roleUnverified = serverSettings.unverifiedRoleName
        ? (guild.roles.cache.find(role => role.id === serverSettings.unverifiedRoleName) || null)
        : null

    return { rolesToAdd, roleUnverified }
}

/**
 * Unverify whoever previously verified with this email in the guild: strip the
 * verification roles, re-apply the unverified role, and DM them why. Fire-and-forget —
 * shared by the email-verification flow and `/manualverify` so both behave identically.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} emailHash - MD5 hash of the (lowercased) email
 * @param {string} newUserId - the user who just verified; skipped if they're the previous holder
 * @param {import('discord.js').Role[]} rolesToAdd - roles the new verification grants (removed from the previous holder)
 * @param {import('discord.js').Role|null} roleUnverified
 * @param {string} language - guild language for the DM
 */
function unverifyPreviousHolder(guild, emailHash, newUserId, rolesToAdd, roleUnverified, language) {
    database.getEmailUser(emailHash, guild.id, async (currentUserEmail) => {
        if (!currentUserEmail || currentUserEmail.userID === newUserId) return
        const member = await guild.members.fetch(currentUserEmail.userID).catch(() => null)
        if (!member) return
        try {
            for (const role of rolesToAdd) {
                await member.roles.remove(role).catch(() => {})
            }
            if (roleUnverified) {
                await member.roles.add(roleUnverified).catch(() => {})
            }
        } catch (e) {
            console.log(e)
        }
        member.send(getLocale(language, 'unverifiedByOtherDm', guild.name)).catch(() => {})
    })
}

module.exports = { resolveVerificationRoles, unverifyPreviousHolder }
