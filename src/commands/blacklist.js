// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags } = require('discord.js');
const database = require("../database/Database.js");
const registerBlacklistChoices = require("../bot/registerBlacklistChoices");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Block specific email addresses or patterns from verifying')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add email addresses or patterns to the blacklist (supports * wildcard)')
                .addStringOption(option =>
                    option
                        .setName('emails')
                        .setDescription('Pattern(s) to block, e.g. *@tempmail.*, spam* (comma-separated)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove email addresses or patterns from the blacklist')
                .addStringOption(option =>
                    option
                        .setName('emails')
                        .setDescription('Pattern to unblock (select from list or type manually)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View all blacklisted email addresses and patterns')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Remove all entries from the blacklist')
        )
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (subcommand === 'list') {
                if (serverSettings.blacklist.length === 0) {
                    await interaction.reply({
                        content: "🚫 **No blacklisted emails.**\n\nAdd entries with `/blacklist add` to block email addresses or patterns.\n\n**Examples (supports `*` wildcard):**\n• `spam@example.com` — Block specific email\n• `*@tempmail.*` — Block all tempmail domains\n• `*spam*` — Block any email containing 'spam'\n• `test*@*` — Block emails starting with 'test'",
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    const blacklistDisplay = serverSettings.blacklist
                        .map(b => `\`${b.replaceAll("*", "✱")}\``)
                        .join('\n• ');
                    await interaction.reply({
                        content: `🚫 **Blacklisted patterns:**\n• ${blacklistDisplay}\n\n💡 **Tip:** Use \`*\` as wildcard (e.g. \`*@tempmail.*\` blocks all tempmail domains)\n\n*Use \`/blacklist add\`, \`/blacklist remove\`, or \`/blacklist clear\` to modify.*`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }

            if (subcommand === 'add') {
                const emailsInput = interaction.options.getString('emails', true);
                const newEntries = emailsInput.split(",").map(name => name.trim()).filter(name => name.length > 0);
                
                if (newEntries.length === 0) {
                    await interaction.reply({
                        content: "❌ **No valid entries provided.**\n\nPlease provide email addresses or patterns to blacklist.",
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                // Filter out duplicates
                const addedEntries = newEntries.filter(entry => !serverSettings.blacklist.includes(entry));
                
                if (addedEntries.length === 0) {
                    await interaction.reply({
                        content: "⚠️ **All provided entries are already blacklisted.**",
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                serverSettings.blacklist = serverSettings.blacklist.concat(addedEntries);
                database.updateServerSettings(interaction.guildId, serverSettings);
                await registerBlacklistChoices(interaction.guildId, { data: this.data });

                const addedDisplay = addedEntries.map(e => `\`${e.replaceAll("*", "✱")}\``).join(', ');
                await interaction.reply({
                    content: `✅ **Added to blacklist:** ${addedDisplay}\n\nEmails matching these patterns will be blocked from verifying.\n\n💡 **Tip:** \`*\` matches any characters (e.g. \`*@tempmail.*\` blocks all tempmail domains)`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (subcommand === 'remove') {
                const emailsInput = interaction.options.getString('emails', true);
                const removeEntries = emailsInput.split(",").map(name => name.trim()).filter(name => name.length > 0);
                
                const removedEntries = serverSettings.blacklist.filter(entry => removeEntries.includes(entry));
                serverSettings.blacklist = serverSettings.blacklist.filter(entry => !removeEntries.includes(entry));

                if (removedEntries.length === 0) {
                    await interaction.reply({
                        content: "⚠️ **No matching entries found in blacklist.**\n\nUse `/blacklist list` to see current entries.",
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    database.updateServerSettings(interaction.guildId, serverSettings);
                    await registerBlacklistChoices(interaction.guildId, { data: this.data });
                    
                    const removedDisplay = removedEntries.map(e => `\`${e.replaceAll("*", "✱")}\``).join(', ');
                    await interaction.reply({
                        content: `🗑️ **Removed from blacklist:** ${removedDisplay}\n\nThese patterns are no longer blocked.`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }

            if (subcommand === 'clear') {
                if (serverSettings.blacklist.length === 0) {
                    await interaction.reply({
                        content: "⚠️ **Blacklist is already empty.**",
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const count = serverSettings.blacklist.length;
                serverSettings.blacklist = [];
                database.updateServerSettings(interaction.guildId, serverSettings);
                await registerBlacklistChoices(interaction.guildId, { data: this.data });

                await interaction.reply({
                    content: `🗑️ **Blacklist cleared!**\n\nRemoved ${count} ${count === 1 ? 'entry' : 'entries'} from the blacklist.`,
                    flags: MessageFlags.Ephemeral
                });
            }
        });
    }
};
