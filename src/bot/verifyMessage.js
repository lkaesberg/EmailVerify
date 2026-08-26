// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js')
const { getLocale } = require('../Language')

/**
 * Build the persistent verification embed posted into a guild channel.
 * Shared by `/button` (with custom overrides) and the `/setup` wizard (defaults).
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} language
 * @param {{ title?: string, description?: string, color?: number }} [overrides]
 * @returns {EmbedBuilder}
 */
function buildVerifyEmbed(guild, language, overrides = {}) {
    return new EmbedBuilder()
        .setTitle(overrides.title || getLocale(language, 'verifyEmbedTitle'))
        .setDescription(overrides.description || getLocale(language, 'verifyEmbedInstructions'))
        .setColor(overrides.color ?? 0x5865F2)
        .setFooter({
            text: `${guild.name} • ${getLocale(language, 'verifyEmbedFooter')}`,
            iconURL: guild.iconURL({ dynamic: true })
        })
}

/**
 * Build the button row for the persistent verification embed.
 * In-guild interactions resolve the guild from interaction.guildId, so these
 * customIds stay in the legacy bare form (no guild suffix needed).
 *
 * @param {string} language
 * @param {string} [buttonText] - custom label for the verify button
 * @returns {ActionRowBuilder}
 */
function buildVerifyButtons(language, buttonText = null) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('verifyButton')
            .setLabel(buttonText || getLocale(language, 'verifyDmButton'))
            .setEmoji('📧')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('openCodeModal')
            .setLabel(getLocale(language, 'enterCodeButton'))
            .setEmoji('🔑')
            .setStyle(ButtonStyle.Secondary)
    )
}

module.exports = { buildVerifyEmbed, buildVerifyButtons }
