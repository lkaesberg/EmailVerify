const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags, EmbedBuilder } = require('discord.js');
const { appStoreUrl } = require("../utils/premiumButtons");

module.exports = {
    data: new SlashCommandBuilder()
        .setDefaultPermission(true)
        .setName('help')
        .setDescription('Learn how to set up and use the email verification bot')
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        const storeLink = appStoreUrl()
        const storeLine = storeLink ? `\n[Browse plans on Discord](${storeLink})` : ''
        const helpEmbed = new EmbedBuilder()
            .setTitle('📚 Email Verification Bot - Setup Guide')
            .setDescription('Follow these steps to set up email verification for your server.')
            .setColor(0x5865F2)
            .addFields(
                {
                    name: '🚀 Quick Setup (4 Steps)',
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
                }
            )
            .setFooter({ text: 'Need more help? Visit emailbot.larskaesberg.de' });

        await interaction.reply({
            embeds: [helpEmbed],
            flags: MessageFlags.Ephemeral
        });
    }
};
