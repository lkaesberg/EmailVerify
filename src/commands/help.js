// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { appStoreUrl } = require("../utils/premiumButtons");
const database = require("../database/Database");
const { getLocale, defaultLanguage, discordLocalizations } = require("../Language");

// AGPL-3.0 §13 requires that everyone interacting with this bot over the network
// is offered the corresponding source code, so /help is open to every member and
// always carries the source link. Admins additionally get the full setup guide.
const SOURCE_URL = 'https://github.com/lkaesberg/EmailVerify';
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

// Discord rejects a field value over 1024 characters and an embed over 6000.
const FIELD_LIMIT = 1024;

function sourceField(language) {
    return {
        name: getLocale(language, 'helpSourceTitle'),
        value: getLocale(language, 'helpSourceBody', LICENSE_URL, SOURCE_URL)
    };
}

function field(language, key) {
    return { name: getLocale(language, `help${key}Title`), value: getLocale(language, `help${key}Body`) };
}

/**
 * Help shown to members without Administrator permission: what they can do plus
 * the AGPL source offer. Setup instructions are admin-only.
 */
function buildMemberEmbed(language) {
    return new EmbedBuilder()
        .setTitle(getLocale(language, 'helpMemberTitle'))
        .setDescription(getLocale(language, 'helpMemberDescription'))
        .setColor(0x5865F2)
        .addFields(
            { name: getLocale(language, 'helpMemberCommandsTitle'), value: getLocale(language, 'helpMemberCommandsBody') },
            field(language, 'How'),
            sourceField(language)
        )
        .setFooter({ text: getLocale(language, 'helpMemberFooter') });
}

/** The full setup guide for admins. */
function buildAdminEmbed(language) {
    // The store link joins the premium field while it fits; a long translation gets
    // it as a field of its own rather than being cut off by Discord.
    const premium = field(language, 'Premium');
    const storeLink = appStoreUrl();
    const storeLine = storeLink ? getLocale(language, 'helpStoreLine', storeLink) : null;
    const premiumFields = [premium];
    if (storeLine && premium.value.length + 1 + storeLine.length <= FIELD_LIMIT) {
        premium.value += '\n' + storeLine;
    } else if (storeLine) {
        premiumFields.push({ name: '​', value: storeLine });
    }

    return new EmbedBuilder()
        .setTitle(getLocale(language, 'helpAdminTitle'))
        .setDescription(getLocale(language, 'helpAdminDescription'))
        .setColor(0x5865F2)
        .addFields(
            field(language, 'New'),
            field(language, 'Manual'),
            field(language, 'Roles'),
            field(language, 'DomainRoles'),
            field(language, 'Domains'),
            field(language, 'Blacklist'),
            field(language, 'Settings'),
            field(language, 'Moderation'),
            field(language, 'Info'),
            ...premiumFields,
            field(language, 'User'),
            field(language, 'Danger'),
            sourceField(language)
        )
        .setFooter({ text: getLocale(language, 'helpAdminFooter') });
}

function getLanguage(guildId) {
    return new Promise(resolve => database.getServerSettings(guildId, s => resolve(s?.language || defaultLanguage)));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setDefaultPermission(true)
        .setName('help')
        .setDescription(getLocale(defaultLanguage, 'helpCommandDescription'))
        .setDescriptionLocalizations(discordLocalizations('helpCommandDescription'))
        .setDefaultMemberPermissions(null),

    buildMemberEmbed,
    buildAdminEmbed,

    async execute(interaction) {
        const isAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator) ?? false
        const language = await getLanguage(interaction.guildId)

        await interaction.reply({
            embeds: [isAdmin ? buildAdminEmbed(language) : buildMemberEmbed(language)],
            flags: MessageFlags.Ephemeral
        });
    }
};
