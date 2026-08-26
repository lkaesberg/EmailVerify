// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const database = require("../database/Database");
const {getLocale} = require("../Language");
const {ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder} = require('discord.js');
const ErrorNotifier = require("../utils/ErrorNotifier");

/**
 * Send verification DM to user (used for autoVerify on member join)
 */
module.exports = async function sendVerifyMessage(guild, user) {
    await database.getServerSettings(guild.id, (async serverSettings => {
        if (!serverSettings.status) {
            // Send generic error to user
            try {
                const embed = new EmbedBuilder()
                    .setTitle(getLocale(serverSettings.language, 'errorGenericTitle'))
                    .setDescription(getLocale(serverSettings.language, 'errorGenericDescription'))
                    .setColor(0xED4245);
                await user.send({ embeds: [embed] });
            } catch {}
            // Notify admin about configuration issue
            await ErrorNotifier.notify({
                guild: guild,
                errorTitle: getLocale(serverSettings.language, 'errorBotNotConfiguredTitle'),
                errorMessage: getLocale(serverSettings.language, 'errorBotNotConfiguredMessage'),
                user: user,
                language: serverSettings.language
            });
            return
        }

        // Build verification DM message
        const embed = new EmbedBuilder()
            .setTitle(getLocale(serverSettings.language, 'verifyEmbedTitle'))
            .setDescription(getLocale(serverSettings.language, 'verifyDmDescription', guild.name))
            .setColor(0x5865F2)
            .setThumbnail(guild.iconURL({ dynamic: true }))
        
        if (serverSettings.logChannel !== "") {
            embed.setFooter({ text: getLocale(serverSettings.language, 'verifyDmAdminWarning') })
        }
        
        // These buttons are clicked in the user's DMs, where the interaction lands on
        // shard 0 with no guild context. Encode the guild id in the customId so the
        // handler knows which guild the verification belongs to.
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`openEmailModal:${guild.id}`)
                .setLabel(getLocale(serverSettings.language, 'verifyDmButton'))
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📧'),
            new ButtonBuilder()
                .setCustomId(`openCodeModal:${guild.id}`)
                .setLabel(getLocale(serverSettings.language, 'enterCodeButton'))
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔑')
        )
        
        await user.send({ embeds: [embed], components: [row] }).catch(() => {})
    }))
}
