// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags, PermissionsBitField } = require('discord.js');
const database = require("../database/Database.js");
const { removeVerifiedStatus, removeVerifiedStatusEverywhere } = require("../utils/removeVerifiedStatus");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('data')
        .setDescription('Manage stored data for privacy and compliance')
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete-user')
                .setDescription('Delete your personal verification data and remove your verified status')
                .addStringOption(option =>
                    option
                        .setName('confirm')
                        .setDescription('Type "delete" to confirm deletion of your data')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete-server')
                .setDescription('Delete all server data and remove the bot from this server (requires administrator permissions)')
                .addStringOption(option =>
                    option
                        .setName('confirm')
                        .setDescription('Type "delete" to confirm - THIS WILL REMOVE THE BOT')
                        .setRequired(true)
                )
        )
        .setDefaultMemberPermissions(null), // null allows everyone to use delete-user, but delete-server is admin-only in execute

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'delete-user') {
            const confirm = interaction.options.getString('confirm', true);
            
            if (confirm !== 'delete') {
                await interaction.reply({
                    content: "❌ **Confirmation failed.**\n\nTo delete your data, type `delete` in the confirm field.\n\n⚠️ This will:\n• Remove your verified status on every server where you verified\n• Delete your stored email hash\n• Require you to verify again",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            // Role removal can take longer than the 3 seconds Discord allows before a reply.
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const userId = interaction.user.id;
            // The rows go in every server, so the verified roles must go there too: roles
            // kept without a row let a second account verify with the same mailbox.
            const guildIds = await database.getUserGuildIDs(userId);
            database.deleteUserData(userId);

            await removeVerifiedStatus(interaction.guild, userId);
            const otherGuildIds = guildIds.filter(id => id !== interaction.guildId);
            removeVerifiedStatusEverywhere(interaction.client, otherGuildIds, userId)
                .catch(err => console.error('Error removing verified status on other servers:', err));

            await interaction.editReply({
                content: "✅ **Your data has been deleted.**\n\n• Your verified status has been removed on every server where you verified\n• Your stored email hash has been deleted\n• You can verify again at any time with `/verify`"
            });
            return;
        }

        if (subcommand === 'delete-server') {
            // Check admin permissions for server deletion
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await interaction.reply({
                    content: "❌ **Permission denied.**\n\nOnly server administrators can delete server data.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const confirm = interaction.options.getString('confirm', true);
            
            if (confirm !== 'delete') {
                await interaction.reply({
                    content: "❌ **Confirmation failed.**\n\nTo delete server data, type `delete` in the confirm field.\n\n⚠️ **Warning:** This will:\n• Delete all server configuration\n• Delete all verification records\n• Remove the bot from this server",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            database.deleteServerData(interaction.guildId);
            await interaction.reply({
                content: "✅ **Server data deleted.**\n\nThe bot will now leave this server. Thank you for using Email Verify Bot!",
                flags: MessageFlags.Ephemeral
            });
            await interaction.guild.leave();
        }
    }
};
