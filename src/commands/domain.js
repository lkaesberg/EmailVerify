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
const { getLocale } = require("../Language");
const { parseDomains } = require("../utils/parseDomains");
const { suggestFromList } = require("../utils/autocompleteList");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('domain')
        .setDescription('Manage allowed email domains for verification')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add allowed email domains (supports * wildcard, e.g. @*.edu)')
                .addStringOption(option =>
                    option
                        .setName('domains')
                        .setDescription('Domain(s) to allow, e.g. @gmail.com, @*.edu (comma-separated)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove one or more allowed email domains')
                .addStringOption(option =>
                    option
                        .setName('domains')
                        .setDescription('Domain(s) to remove (comma-separated for multiple)')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View all currently allowed email domains')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Remove all allowed domains (users won\'t be able to verify)')
        )
        .setDefaultMemberPermissions(0),

    /**
     * Suggest this guild's configured domains for `/domain remove`.
     *
     * This replaced per-guild command registration: the option used to carry static
     * `choices` PATCHed into each guild's copy of the command, which is the only thing
     * that forced guild-scoped commands (choices cannot vary per guild on a global
     * command). Autocomplete is resolved at type time instead, so one global
     * registration now serves every server — and it is not capped at 25 entries.
     */
    async autocomplete(interaction) {
        const serverSettings = await new Promise(resolve =>
            database.getServerSettings(interaction.guildId, resolve));
        await interaction.respond(
            suggestFromList(interaction.options.getFocused(), serverSettings.domains || [])
        ).catch(() => {});
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (subcommand === 'list') {
                if (serverSettings.domains.length === 0) {
                    await interaction.reply({
                        content: "📧 **No allowed domains configured.**\n\nAdd domains with `/domain add` to allow users with those email addresses to verify.\n\n**Examples:**\n• `@gmail.com` — Only Gmail addresses\n• `@company.com` — Specific company domain\n• `@*.edu` — Any .edu domain (wildcard)\n• `@*.harvard.edu` — Any Harvard subdomain\n\n**Wildcard (*) Explained:**\nThe `*` matches any text. So `@*.edu` allows `@stanford.edu`, `@mit.edu`, `@student.university.edu`, etc.",
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    const domainList = serverSettings.domains
                        .map(d => `\`${d.replaceAll("*", "✱")}\``)
                        .join('\n• ');
                    await interaction.reply({
                        content: `📧 **Allowed email domains:**\n• ${domainList}\n\n*Use \`/domain add\`, \`/domain remove\`, or \`/domain clear\` to modify.*\n\n💡 **Tip:** Use \`*\` as wildcard (e.g. \`@*.edu\` matches any .edu address)`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }

            if (subcommand === 'add') {
                const domainsInput = interaction.options.getString('domains', true);
                const addedDomains = [];

                for (const domain of parseDomains(domainsInput)) {
                    if (!serverSettings.domains.includes(domain)) {
                        serverSettings.domains.push(domain);
                        addedDomains.push(domain);
                    }
                }

                if (addedDomains.length !== 0) {
                    database.updateServerSettings(interaction.guildId, serverSettings);
                    
                    const addedList = addedDomains.map(d => `\`${d.replaceAll("*", "✱")}\``).join(', ');
                    await interaction.reply({
                        content: `✅ **Added domain(s):** ${addedList}\n\nUsers with email addresses matching these domains can now verify.\n\n💡 **Wildcard tip:** Use \`*\` to match any text (e.g. \`@*.edu\` allows all .edu emails)`,
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    await interaction.reply({
                        content: "❌ **No valid domains provided.**\n\n**Valid formats:**\n• `@gmail.com` or `gmail.com` — Specific domain\n• `@*.edu` — Wildcard (matches any .edu)\n• `@*.company.com` — Subdomain wildcard\n• `@domain1.com, @domain2.org` — Multiple domains\n\n**Wildcard (*) Explained:**\nThe `*` matches any text before the specified part.\n`@*.edu` → `@stanford.edu` ✓, `@mit.edu` ✓, `@cs.berkeley.edu` ✓",
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }

            if (subcommand === 'remove') {
                const domainsInput = interaction.options.getString('domains', true);
                const removeDomains = domainsInput.split(",").map(d => d.trim());
                
                // Also check for versions without @ prefix
                const expandedRemove = [];
                removeDomains.forEach(d => {
                    expandedRemove.push(d);
                    if (!d.startsWith("@")) {
                        expandedRemove.push("@" + d);
                    }
                });
                
                const deletedDomains = serverSettings.domains.filter(domain => 
                    expandedRemove.includes(domain)
                );
                serverSettings.domains = serverSettings.domains.filter(domain => 
                    !expandedRemove.includes(domain)
                );

                if (deletedDomains.length === 0) {
                    await interaction.reply({
                        content: "⚠️ **No matching domains found to remove.**\n\nUse `/domain list` to see current domains.",
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    database.updateServerSettings(interaction.guildId, serverSettings);
                    
                    const removedList = deletedDomains.map(d => `\`${d.replaceAll("*", "✱")}\``).join(', ');
                    await interaction.reply({
                        content: `🗑️ **Removed domain(s):** ${removedList}\n\nUsers with these email addresses can no longer verify.`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }

            if (subcommand === 'clear') {
                if (serverSettings.domains.length === 0) {
                    await interaction.reply({
                        content: "⚠️ **Domain list is already empty.**",
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const count = serverSettings.domains.length;
                serverSettings.domains = [];
                database.updateServerSettings(interaction.guildId, serverSettings);

                const language = serverSettings.language || 'english';
                const hasAllowedEmails = (serverSettings.allowedEmails || []).length > 0;
                const followup = hasAllowedEmails
                    ? '\n\n' + getLocale(language, 'domainClearStillRestricted')
                    : '\n\n' + getLocale(language, 'domainClearAcceptAll');

                await interaction.reply({
                    content: `🗑️ **All domains cleared!**\n\nRemoved ${count} ${count === 1 ? 'domain' : 'domains'}.${followup}`,
                    flags: MessageFlags.Ephemeral
                });
            }
        });
    }
};
