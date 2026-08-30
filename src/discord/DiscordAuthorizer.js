// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const { resolveVerificationRoles, unverifyPreviousHolder } = require('../utils/resolveVerificationRoles')

/**
 * How a verified member is granted access on Discord: roles.
 *
 * This is the seam VerificationService uses instead of hard-coding role assignment,
 * because Telegram has no roles — its authorizer approves a join request, lifts a
 * mute, or hands out a single-use invite link instead.
 */
class DiscordAuthorizer {
    /**
     * @returns {{targets: {rolesToAdd: Array, roleUnverified: Object|null}, count: number, expected: boolean, primaryId: string}}
     */
    resolve(guild, settings, email) {
        const { rolesToAdd, roleUnverified } = resolveVerificationRoles(guild, settings, email)
        // "Expected" means the config names roles; combined with count === 0 that
        // identifies a guild whose configured roles have since been deleted, which
        // must fail loudly instead of verifying someone into nothing.
        const expected = (settings.defaultRoles || []).length > 0
            || Object.keys(settings.domainRoles || {}).length > 0
        return {
            targets: { rolesToAdd, roleUnverified },
            count: rolesToAdd.length,
            expected,
            // First default role kept in the legacy EmailUser.groupID field.
            primaryId: (settings.defaultRoles && settings.defaultRoles[0]) || (rolesToAdd[0] && rolesToAdd[0].id) || ''
        }
    }

    async grant(guild, settings, userID, targets) {
        const { rolesToAdd, roleUnverified } = targets
        const labels = []
        try {
            const member = await guild.members.fetch(userID)
            for (const role of rolesToAdd) {
                await member.roles.add(role)
                labels.push(role.name)
            }
            if (roleUnverified) {
                await member.roles.remove(roleUnverified).catch(() => {})
            }
        } catch (e) {
            return { ok: false, detail: 'role_add_error', labels }
        }
        return { ok: true, labels }
    }

    revokePrevious(guild, settings, emailHash, newUserID, targets, language) {
        unverifyPreviousHolder(guild, emailHash, newUserID, targets.rolesToAdd, targets.roleUnverified, language)
    }
}

module.exports = DiscordAuthorizer
