// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

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

const OWNERSHIP_SWAP_ATTEMPTS = 5

/**
 * Make `emailUser.userID` the owner of the address in the guild and report whose
 * ownership that write actually replaced. The owner is read and then swapped only if
 * it is unchanged (Database.swapEmailOwner); if another verification of the same
 * address (another member, possibly on another shard) wrote in between, the owner is
 * re-read and the swap retried against them. So of two members verifying one address
 * at once, the later write always names the earlier one as its previous holder and
 * displaces them, instead of both keeping the roles with only one record.
 *
 * Call it after the new owner's roles are assigned, and displace the returned
 * previous holder only after it succeeds.
 *
 * @param {import('../database/EmailUser')} emailUser
 * @returns {Promise<{ owned: boolean, previousHolderId: ?string }>} owned is false on a
 *   DB error or when the swap kept losing; nothing was written in that case
 */
async function takeEmailOwnership(emailUser) {
    for (let attempt = 0; attempt < OWNERSHIP_SWAP_ATTEMPTS; attempt++) {
        let ownerId
        try {
            ownerId = await database.getEmailOwnerId(emailUser.email, emailUser.guildID)
        } catch (e) {
            console.error('Error reading previous email holder:', e)
            return { owned: false, previousHolderId: null }
        }
        const result = await database.swapEmailOwner(emailUser, ownerId)
        if (result === 'ok') {
            return { owned: true, previousHolderId: ownerId && ownerId !== emailUser.userID ? ownerId : null }
        }
        if (result === 'error') return { owned: false, previousHolderId: null }
    }
    console.error(`Email ownership in guild ${emailUser.guildID} kept changing; gave up after ${OWNERSHIP_SWAP_ATTEMPTS} attempts`)
    return { owned: false, previousHolderId: null }
}

/**
 * Unverify the previous holder of an email once the new owner has their roles and the
 * ownership change is stored: strip the verification roles, re-apply the unverified
 * role, and DM them why. Shared by the email-verification flow and `/manualverify`.
 *
 * Skipped when the previous holder still owns another address in this guild: they are
 * still verified through that one, and stripping roles would leave them unverified
 * with a valid record.
 *
 * @param {import('discord.js').Guild} guild
 * @param {?string} previousUserId - from takeEmailOwnership
 * @param {import('discord.js').Role[]} rolesToAdd - roles the new verification grants (removed from the previous holder)
 * @param {import('discord.js').Role|null} roleUnverified
 * @param {string} language - guild language for the DM
 */
async function displacePreviousHolder(guild, previousUserId, rolesToAdd, roleUnverified, language) {
    if (!previousUserId) return
    if (await database.userHasEmailInGuild(previousUserId, guild.id)) return
    const member = await guild.members.fetch(previousUserId).catch(() => null)
    if (!member) return
    for (const role of rolesToAdd) {
        await member.roles.remove(role).catch(() => {})
    }
    if (roleUnverified) {
        await member.roles.add(roleUnverified).catch(() => {})
    }
    member.send(getLocale(language, 'unverifiedByOtherDm', guild.name)).catch(() => {})
}

module.exports = { resolveVerificationRoles, takeEmailOwnership, displacePreviousHolder }
