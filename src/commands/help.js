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

// AGPL-3.0 §13 requires that everyone interacting with this bot over the network
// is offered the corresponding source code, so /help is open to every member and
// always carries the source link. Admins additionally get the full setup guide.
const SOURCE_URL = 'https://github.com/lkaesberg/EmailVerify';
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

const sourceField = {
    name: '📜 Source Code & License',
    value:
        'This bot is free software under the ' +
        `[GNU AGPL v3.0 or later](${LICENSE_URL}). The complete corresponding ` +
        `source code is available at ${SOURCE_URL}\n` +
        '*If you run a modified version as a service, you must offer its source to your users.*'
};

/**
 * Help shown to members without Administrator permission: what they can do plus
 * the AGPL source offer. Setup instructions are admin-only.
 */
function buildMemberEmbed() {
    return new EmbedBuilder()
        .setTitle('📚 Email Verification Bot')
        .setDescription('This server uses email verification to grant access. Here is what you can do.')
        .setColor(0x5865F2)
        .addFields(
            {
                name: '👤 Your Commands',
                value:
                    '`/verify` - Start the email verification process\n' +
                    '`/data delete-user` - Delete your verification data'
            },
            {
                name: '🔐 How Verification Works',
                value:
                    '**1.** Start with `/verify` or the verification button\n' +
                    '**2.** Enter your email address in the popup\n' +
                    '**3.** Check your inbox (and spam folder) for the code\n' +
                    '**4.** Enter the code to receive your roles'
            },
            sourceField
        )
        .setFooter({ text: 'Server admins see setup instructions here • getemailverified.com' });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setDefaultPermission(true)
        .setName('help')
        .setDescription('Learn how to set up and use the email verification bot')
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        const isAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator) ?? false

        if (!isAdmin) {
            await interaction.reply({
                embeds: [buildMemberEmbed()],
                flags: MessageFlags.Ephemeral
            });
            return
        }

        const storeLink = appStoreUrl()
        const storeLine = storeLink
            ? `\n[Browse plans on Discord](${storeLink})\n📱 *On mobile? Purchases only work on desktop/browser — open the store link there.*`
            : ''
        const helpEmbed = new EmbedBuilder()
            .setTitle('📚 Email Verification Bot - Setup Guide')
            .setDescription('Follow these steps to set up email verification for your server.')
            .setColor(0x5865F2)
            .addFields(
                {
                    name: '✨ New here?',
                    value:
                        'Run **`/setup`** — a guided 3-step wizard that configures roles, email domains, ' +
                        'and posts the verification message for you. Then `/testmail` to confirm delivery.'
                },
                {
                    name: '🚀 Manual Setup (4 Steps)',
                    value:
                        '**1.** `/role add <role>` - Add a default role for verified users\n' +
                        '**2.** `/domain add <domains>` - Add allowed email domains\n' +
                        '**3.** `/button <channel>` - Create verification embed\n' +
                        '**4.** `/status` - Verify everything is configured'
                },
                {
                    name: '👥 Role Configuration',
                    value:
                        '`/role add` - Add a default role (given to all verified users)\n' +
                        '`/role remove` - Remove a default role\n' +
                        '`/role list` - View all default roles\n' +
                        '`/role unverified` - Set/view optional role for unverified members'
                },
                {
                    name: '🎭 Domain-Specific Roles',
                    value:
                        '`/domainrole add` - Assign roles for specific email domains\n' +
                        '`/domainrole remove` - Remove a role from a domain\n' +
                        '`/domainrole list` - View all domain-role mappings\n' +
                        '`/domainrole clear` - Remove all roles for a domain\n' +
                        '*Users get domain roles + default roles on verification*'
                },
                {
                    name: '📧 Domain Management',
                    value:
                        '`/domain add` - Add allowed domains (use `*` wildcard, e.g. `@*.edu`)\n' +
                        '`/domain remove` - Remove allowed domains\n' +
                        '`/domain list` - View all allowed domains\n' +
                        '`/domain clear` - Remove all allowed domains'
                },
                {
                    name: '🚫 Blacklist Management',
                    value:
                        '`/blacklist add` - Block patterns (use `*` wildcard, e.g. `*@tempmail.*`)\n' +
                        '`/blacklist remove` - Unblock patterns\n' +
                        '`/blacklist list` - View all blacklisted entries\n' +
                        '`/blacklist clear` - Remove all blacklist entries'
                },
                {
                    name: '⚙️ Settings',
                    value:
                        '`/settings language` - Change bot language\n' +
                        '`/settings log-channel` - Set verification log channel\n' +
                        '`/settings verify-message` - Custom message in emails\n' +
                        '`/settings auto-verify` - Auto-prompt new members\n' +
                        '`/settings auto-unverified` - Auto-assign unverified role\n' +
                        '`/settings email-style` - Plain text (default) or HTML rendering\n' +
                        '`/settings mail-mode` - `free` (25/month, self-SMTP) or `zeptomail` (credit-funded ZeptoMail)'
                },
                {
                    name: '🛡️ Moderation',
                    value:
                        '`/manualverify` - Manually verify a user without email\n' +
                        '`/testmail` - Send a test email to check delivery & spam placement\n' +
                        '`/set_error_notify` - Configure error notifications'
                },
                {
                    name: '📊 Information',
                    value:
                        '`/status` - View configuration & statistics\n' +
                        '`/help` - Show this help message'
                },
                {
                    name: '💎 Premium',
                    value:
                        '`/premium status` - View your plan, available upgrades, and buy buttons\n' +
                        '`/premium redeem` - Apply purchased credits or CSV unlock to this server\n' +
                        '**Standard** - Unlimited verifications + premium ZeptoMail delivery\n' +
                        '**Pro** - Standard + CSV import & export\n' +
                        '**Credit packs** - One-time top-up of 100 / 500 / 2000 verifications\n' +
                        '**CSV unlock** - One-time CSV features without a subscription\n' +
                        '**Pay-per-send ZeptoMail** - `/settings mail-mode zeptomail` routes every mail through ZeptoMail at 1 credit each; auto-disables when credits hit 0' +
                        storeLine
                },
                {
                    name: '👤 User Commands',
                    value:
                        '`/verify` - Start email verification process\n' +
                        '`/data delete-user` - Delete your verification data'
                },
                {
                    name: '⚠️ Danger Zone',
                    value:
                        '`/data delete-server` - Delete all data & remove bot'
                },
                sourceField
            )
            .setFooter({ text: 'Need more help? Visit getemailverified.com' });

        await interaction.reply({
            embeds: [helpEmbed],
            flags: MessageFlags.Ephemeral
        });
    }
};
