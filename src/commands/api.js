// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const { SlashCommandBuilder } = require('@discordjs/builders')
const { MessageFlags, EmbedBuilder } = require('discord.js')
const database = require('../database/Database')
const { getLocale } = require('../Language')
const premiumManager = require('../premium/PremiumManager')
const { generateToken } = require('../api/ApiTokens')
const { buildPlanButtons } = require('../utils/premiumButtons')
const analytics = require('../utils/Analytics')
const config = require('../../config/config.json')

// The API is served by the same Express app as the public stats endpoints, so its
// base URL is that host plus /api/v1. Self-hosters set `apiBaseUrl` in config.json;
// the default is the hosted deployment.
const API_BASE_URL = (config.apiBaseUrl && String(config.apiBaseUrl).trim())
    || 'https://stats.getemailverified.com/api/v1'

/** Public base URL of the API, for the copy/paste examples in the reply. */
function apiBaseUrl() {
    return API_BASE_URL.replace(/\/+$/, '')
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('api')
        .setDescription('Manage the API access token for the allowed-email list')
        .addSubcommandGroup(group =>
            group
                .setName('token')
                .setDescription('Manage this server\'s API access token')
                .addSubcommand(sub =>
                    sub
                        .setName('generate')
                        .setDescription('Create a new API token (invalidates the previous one)')
                )
                .addSubcommand(sub =>
                    sub
                        .setName('revoke')
                        .setDescription('Permanently disable this server\'s API token')
                )
                .addSubcommand(sub =>
                    sub
                        .setName('status')
                        .setDescription('Show whether a token exists and when it was last used')
                )
        )
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand()
        const guildId = interaction.guildId

        const language = await new Promise(resolve =>
            database.getServerSettings(guildId, s => resolve(s.language || 'english'))
        )

        // Tier 2 only. The one-time CSV unlock deliberately does not grant API access
        // -- see PremiumManager#canUseApiFeature.
        const check = await premiumManager.canUseApiFeature(guildId, interaction.entitlements)
        if (!check.allowed) {
            const premiumStatus = await premiumManager.getPremiumStatus(guildId, interaction.entitlements)
            const components = buildPlanButtons(premiumStatus, { context: 'apiRequired' })
            const embed = new EmbedBuilder()
                .setTitle(getLocale(language, 'apiTierRequiredTitle'))
                .setDescription(getLocale(language, 'apiTierRequiredDescription'))
                .setColor(0xFFA500)
            analytics.capture({
                event: 'api_token_denied',
                userId: interaction.user?.id || null,
                guildId,
                guild: interaction.guild,
                properties: { reason: 'tier2_required' }
            })
            await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral }).catch(() => {})
            return
        }

        if (subcommand === 'generate') {
            const { token, tokenHash } = generateToken()
            try {
                await database.setGuildApiToken(guildId, tokenHash, interaction.user.id)
            } catch (e) {
                console.error('[api] Failed to store API token:', e)
                await interaction.reply({
                    content: getLocale(language, 'apiTokenStoreError'),
                    flags: MessageFlags.Ephemeral
                }).catch(() => {})
                return
            }

            const base = apiBaseUrl()
            const embed = new EmbedBuilder()
                .setTitle(getLocale(language, 'apiTokenGeneratedTitle'))
                .setDescription(getLocale(language, 'apiTokenGeneratedDescription'))
                .addFields(
                    { name: getLocale(language, 'apiTokenFieldToken'), value: `\`\`\`\n${token}\n\`\`\``, inline: false },
                    { name: getLocale(language, 'apiTokenFieldBaseUrl'), value: `\`${base}\``, inline: false },
                    {
                        name: getLocale(language, 'apiTokenFieldQuickstart'),
                        value: [
                            '```bash',
                            `curl -H "Authorization: Bearer ${token}" \\`,
                            `  ${base}/me`,
                            '```'
                        ].join('\n'),
                        inline: false
                    },
                    { name: getLocale(language, 'apiTokenFieldDocs'), value: getLocale(language, 'apiTokenDocsValue'), inline: false }
                )
                .setColor(0x57F287)

            analytics.capture({
                event: 'api_token_generated',
                userId: interaction.user?.id || null,
                guildId,
                guild: interaction.guild
            })
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {})
            return
        }

        if (subcommand === 'revoke') {
            const existed = await database.revokeGuildApiToken(guildId)
            analytics.capture({
                event: 'api_token_revoked',
                userId: interaction.user?.id || null,
                guildId,
                guild: interaction.guild,
                properties: { existed }
            })
            await interaction.reply({
                content: getLocale(language, existed ? 'apiTokenRevoked' : 'apiTokenNoneToRevoke'),
                flags: MessageFlags.Ephemeral
            }).catch(() => {})
            return
        }

        if (subcommand === 'status') {
            const meta = await database.getGuildApiTokenMeta(guildId)
            if (!meta) {
                await interaction.reply({
                    content: getLocale(language, 'apiTokenStatusNone'),
                    flags: MessageFlags.Ephemeral
                }).catch(() => {})
                return
            }
            const count = await database.getAllowedEmailCount(guildId)
            // Discord timestamps localize themselves to each reader's timezone.
            const created = `<t:${Math.floor(meta.createdAt / 1000)}:f>`
            const lastUsed = meta.lastUsedAt
                ? `<t:${Math.floor(meta.lastUsedAt / 1000)}:R>`
                : getLocale(language, 'apiTokenNeverUsed')

            const embed = new EmbedBuilder()
                .setTitle(getLocale(language, 'apiTokenStatusTitle'))
                .setDescription(getLocale(language, 'apiTokenStatusDescription'))
                .addFields(
                    { name: getLocale(language, 'apiTokenFieldCreated'), value: created, inline: true },
                    { name: getLocale(language, 'apiTokenFieldLastUsed'), value: lastUsed, inline: true },
                    { name: getLocale(language, 'apiTokenFieldListSize'), value: String(count ?? 0), inline: true },
                    { name: getLocale(language, 'apiTokenFieldBaseUrl'), value: `\`${apiBaseUrl()}\``, inline: false }
                )
                .setColor(0x5865F2)
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {})
        }
    }
}
