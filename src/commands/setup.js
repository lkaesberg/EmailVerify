// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const { SlashCommandBuilder } = require("@discordjs/builders");
const {
    MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType,
    ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, TextDisplayBuilder,
    PermissionsBitField
} = require('discord.js');
const database = require("../database/Database.js");
const { parseDomains } = require("../utils/parseDomains");
const { buildVerifyEmbed, buildVerifyButtons } = require("../bot/verifyMessage");
const permissions = require("../utils/permissions");
const { getLocale } = require("../Language");
const { getWebsiteUrl } = require("../utils/premiumButtons");
const analytics = require("../utils/Analytics");

const WIZARD_COLOR = 0x5865F2;

// Roles /setup can create. The name is localised to the server's language; the English
// name is also matched so re-running setup (or switching language) reuses the role
// instead of creating a second one.
const ROLE_KINDS = {
    verified: { nameKey: 'setupRoleVerifiedName', english: 'Verified', color: 0x57F287 },
    unverified: { nameKey: 'setupRoleUnverifiedName', english: 'Unverified', color: 0x99AAB5 }
};

// The wizard is stateless: every step writes straight to the database and the
// ephemeral wizard message itself carries the flow. Components on an ephemeral
// reply can only be used by the invoking admin, and handleComponent re-checks
// Administrator as belt-and-braces.

function getSettings(guildId) {
    return new Promise(resolve => database.getServerSettings(guildId, resolve));
}

function roleName(kind, language) {
    return getLocale(language, ROLE_KINDS[kind].nameKey);
}

/**
 * The role of this kind for the guild: an existing one with the same name, or a newly
 * created one.
 *
 * A created role lands at the bottom of the role list, below the bot's own role, so
 * the bot can always assign it — the hierarchy problem behind most failed
 * verifications cannot occur. It carries no permissions of its own.
 *
 * @returns {Promise<{role: ?import('discord.js').Role, created: boolean, error?: string}>}
 */
async function ensureRole(guild, kind, language) {
    const { english, color } = ROLE_KINDS[kind];
    const name = roleName(kind, language);
    const wanted = new Set([name.toLowerCase(), english.toLowerCase()]);
    const existing = guild.roles.cache.find(r =>
        r.id !== guild.id && !r.managed && wanted.has(r.name.toLowerCase()));
    if (existing) return { role: existing, created: false };

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return { role: null, created: false, error: 'missing_manage_roles' };
    }
    try {
        const role = await guild.roles.create({
            name,
            colors: { primaryColor: color },
            permissions: [],
            hoist: false,
            mentionable: false,
            reason: `EmailVerify /setup: ${english} role`
        });
        return { role, created: true };
    } catch (e) {
        return { role: null, created: false, error: String(e?.message || e).slice(0, 200) };
    }
}

/** Reply for a role that could not be created: the Manage Roles fix, or the raw error. */
function roleCreateFailedReply(result, language) {
    if (result.error === 'missing_manage_roles') {
        return {
            content: `${getLocale(language, 'permWarnNoManageRolesTitle')}\n\n${getLocale(language, 'permWarnNoManageRoles', permissions.buildInviteUrl())}`,
            components: [permissions.buildReinviteRow(language)],
            flags: MessageFlags.Ephemeral
        };
    }
    return {
        content: `❌ Creating the role failed: ${result.error}\nYou can create it yourself and pick it from the menu instead.`,
        flags: MessageFlags.Ephemeral
    };
}

function trackRole(interaction, kind, result) {
    analytics.capture({
        event: 'setup_role_created',
        userId: interaction.user.id,
        guild: interaction.guild,
        properties: { kind, created: result.created, reused: !!result.role && !result.created, ok: !!result.role, error: result.error ?? null }
    });
}

function roleMention(role, created) {
    return `<@&${role.id}>` + (created ? ' *(created)*' : '');
}

function step1Message(language) {
    const embed = new EmbedBuilder()
        .setTitle('🧭 Setup — Step 1 of 4: Verified role')
        .setDescription(
            'Which role should every verified member receive?\n\n' +
            `• **Create one for me** — a new **${roleName('verified', language)}** role. The bot can always hand out a role it created, so there is nothing to fix in the role order.\n` +
            '• **Or pick existing roles** from the menu (1–5).\n\n' +
            '*You can refine this later with `/role` and `/domainrole` (per-domain roles).*'
        )
        .setColor(WIZARD_COLOR);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('setupCreateVerified')
            .setLabel(`Create a "${roleName('verified', language)}" role for me`)
            .setEmoji('✨')
            .setStyle(ButtonStyle.Primary)
    );
    const select = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
            .setCustomId('setupRoles')
            .setPlaceholder('…or select 1–5 existing roles')
            .setMinValues(1)
            .setMaxValues(5)
    );
    return { embeds: [embed], components: [buttons, select] };
}

/**
 * Step 2: an optional role new members hold until they verify. Offered as a one-click
 * create, since a hand-picked role above the bot's own is the usual failure.
 */
function step2Message(guild, serverSettings, savedRoleMentions, hierarchyWarning) {
    const language = serverSettings.language;
    const current = serverSettings.unverifiedRoleName
        ? guild.roles.cache.get(serverSettings.unverifiedRoleName)
        : null;

    let description = `Verified role(s): ${savedRoleMentions}\n\n`;
    // The warning arrives already prefixed and formatted (see utils/permissions).
    if (hierarchyWarning) description = `${hierarchyWarning}\n\n${description}`;

    const row = new ActionRowBuilder();
    if (current) {
        description += `Unverified role already set: <@&${current.id}> ` +
            `(given to new members on join: **${serverSettings.autoAddUnverified ? 'yes' : 'no'}**). ` +
            'Change it later with `/role unverified` and `/settings auto-unverified`.';
        row.addComponents(
            new ButtonBuilder().setCustomId('setupSkipUnverified').setLabel('Continue').setStyle(ButtonStyle.Primary)
        );
    } else {
        description +=
            `Should new members get an **${roleName('unverified', language)}** role until they verify? ` +
            'You can then hide your channels from that role.\n\n' +
            '*Optional — most servers skip it: hiding channels from @everyone and showing them to the verified role does the same, ' +
            'and also covers members who joined before today. The unverified role only reaches members who join from now on.*';
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('setupCreateUnverified')
                .setLabel(`Create "${roleName('unverified', language)}" & give it to new members`)
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('setupSkipUnverified').setLabel('Skip').setStyle(ButtonStyle.Primary)
        );
    }

    const embed = new EmbedBuilder()
        .setTitle('🧭 Setup — Step 2 of 4: Unverified role (optional)')
        .setDescription(description)
        .setColor(WIZARD_COLOR);
    return { embeds: [embed], components: [row] };
}

function step3Message(note) {
    const description = (note ? `${note}\n\n` : '') +
        'Should verification be limited to specific email domains?\n' +
        '• **Restrict domains** — e.g. only `@company.com` or `@*.edu` addresses\n' +
        '• **Allow any email** — every valid address can verify';
    const embed = new EmbedBuilder()
        .setTitle('🧭 Setup — Step 3 of 4: Email domains')
        .setDescription(description)
        .setColor(WIZARD_COLOR);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('setupDomainsRestrict')
            .setLabel('Restrict domains')
            .setEmoji('📧')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('setupDomainsAny')
            .setLabel('Allow any email')
            .setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
}

function step4Message(domainsNote) {
    const embed = new EmbedBuilder()
        .setTitle('🧭 Setup — Step 4 of 4: Verification channel')
        .setDescription(
            `${domainsNote}\n\n` +
            'Pick the channel where the verification message (with the **Verify** button) should be posted. ' +
            'Members click it to start verifying.'
        )
        .setColor(WIZARD_COLOR);
    const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('setupChannel')
            .setPlaceholder('Select the verification channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    );
    return { embeds: [embed], components: [row] };
}

async function buildSummaryMessage(guild, serverSettings, channel) {
    const roleMentions = (serverSettings.defaultRoles || [])
        .map(id => guild.roles.cache.get(id))
        .filter(Boolean)
        .map(r => `<@&${r.id}>`)
        .join(', ') || '*none*';
    const domains = (serverSettings.domains || []);
    const domainsDisplay = domains.length > 0
        ? domains.map(d => `\`${d.replaceAll('*', '✱')}\``).join(', ')
        : '*any email address*';
    const unverified = serverSettings.unverifiedRoleName
        ? guild.roles.cache.get(serverSettings.unverifiedRoleName)
        : null;
    const firstRole = (serverSettings.defaultRoles || []).map(id => guild.roles.cache.get(id)).find(Boolean);

    // A role grants and hides nothing by itself, and the bot has no Manage Channels
    // permission to do it for the admin. Without this step members verify, get the
    // role and see exactly what they saw before.
    const website = getWebsiteUrl();
    const lockSteps =
        '**🔒 One thing left: hide your channels until members verify.**\n' +
        'A role doesn\'t hide anything by itself. For each members-only category or channel: **Edit → Permissions**, ' +
        `turn **View Channel** off for \`@everyone\` and on for ${firstRole ? `<@&${firstRole.id}>` : 'your verified role'}. ` +
        `Keep <#${channel.id}> visible to everyone.` +
        (unverified ? ` (Or deny **View Channel** to <@&${unverified.id}> instead.)` : '') +
        (website ? `\n[Step-by-step guide](${website.replace(/\/$/, '')}/setup/#lock-the-server-down-until-someone-verifies)` : '');

    const embed = new EmbedBuilder()
        .setTitle('✅ Setup complete!')
        .setDescription(
            `**Verified roles:** ${roleMentions}\n` +
            (unverified ? `**Unverified role:** <@&${unverified.id}> (given to new members: ${serverSettings.autoAddUnverified ? 'yes' : 'no'})\n` : '') +
            `**Allowed domains:** ${domainsDisplay}\n` +
            `**Verification message:** posted in <#${channel.id}>\n\n` +
            `${lockSteps}\n\n` +
            '**Recommended next steps:**\n' +
            '• `/status` — check the full configuration\n' +
            '• `/testmail` — send yourself a test email to confirm delivery\n' +
            '• `/settings auto-verify` — DM new members a verification prompt\n' +
            '• `/settings log-channel` — log verifications for your mods\n' +
            '• `/blacklist add` — block disposable-email patterns'
        )
        .setColor(0x57F287);
    return { embeds: [embed], components: [] };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setDefaultPermission(true)
        .setName('setup')
        .setDescription('Guided setup: verified role (can create it for you), email domains, and the verification channel')
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        const serverSettings = await getSettings(interaction.guildId);
        await interaction.reply({ ...step1Message(serverSettings.language), flags: MessageFlags.Ephemeral });
    },

    /** Buttons and select menus with a `setup*` customId are routed here. */
    async handleComponent(interaction) {
        if (!interaction.guild || !interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
            await interaction.reply({ content: 'Administrator permission required.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }

        // Step 1 → save roles, show step 2
        if (interaction.customId === 'setupRoles' && interaction.isRoleSelectMenu()) {
            const selected = interaction.values
                .map(id => interaction.guild.roles.cache.get(id))
                .filter(role => role && role.id !== interaction.guild.id && !role.managed);

            if (selected.length === 0) {
                await interaction.reply({
                    content: '❌ None of the selected roles can be used (@everyone and bot-managed roles are not assignable). Please pick different roles.',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
                return;
            }

            const serverSettings = await getSettings(interaction.guildId);
            for (const role of selected) {
                if (!serverSettings.defaultRoles.includes(role.id)) {
                    serverSettings.defaultRoles.push(role.id);
                }
            }
            // Keep the legacy single-role field in sync (same convention as /role add)
            if (!serverSettings.verifiedRoleName && serverSettings.defaultRoles.length > 0) {
                serverSettings.verifiedRoleName = serverSettings.defaultRoles[0];
            }
            database.updateServerSettings(interaction.guildId, serverSettings);

            // Pre-empt the most common failure: a role the bot cannot hand out (above its
            // own role, or owned by another integration) can never be assigned. Shares the
            // wording and the step-by-step fix with /role, /domainrole and the failure path.
            const warning = await permissions.buildRoleWarning(
                interaction.guild, selected, serverSettings.language
            );

            const mentions = selected.map(r => `<@&${r.id}>`).join(', ');
            await interaction.update(step2Message(interaction.guild, serverSettings, mentions, warning)).catch(() => {});
            return;
        }

        // Step 1 (alternative) → create or reuse the verified role, show step 2
        if (interaction.customId === 'setupCreateVerified') {
            const serverSettings = await getSettings(interaction.guildId);
            const language = serverSettings.language;
            const result = await ensureRole(interaction.guild, 'verified', language);
            trackRole(interaction, 'verified', result);
            if (!result.role) {
                await interaction.reply(roleCreateFailedReply(result, language)).catch(() => {});
                return;
            }

            if (!serverSettings.defaultRoles.includes(result.role.id)) {
                serverSettings.defaultRoles.push(result.role.id);
            }
            if (!serverSettings.verifiedRoleName) serverSettings.verifiedRoleName = result.role.id;
            database.updateServerSettings(interaction.guildId, serverSettings);

            // A reused role may sit above the bot; a created one never does, but checking
            // both costs nothing and also catches a missing Manage Roles.
            const warning = await permissions.buildRoleWarning(interaction.guild, [result.role], language);
            await interaction.update(step2Message(interaction.guild, serverSettings, roleMention(result.role, result.created), warning)).catch(() => {});
            return;
        }

        // Step 2a → create or reuse the unverified role, hand it out on join, show step 3
        if (interaction.customId === 'setupCreateUnverified') {
            const serverSettings = await getSettings(interaction.guildId);
            const language = serverSettings.language;
            const result = await ensureRole(interaction.guild, 'unverified', language);
            trackRole(interaction, 'unverified', result);
            if (!result.role) {
                await interaction.reply(roleCreateFailedReply(result, language)).catch(() => {});
                return;
            }
            // The same role can't be both: verifying would add it and remove it again.
            if (serverSettings.defaultRoles.includes(result.role.id)) {
                await interaction.reply({
                    content: `❌ <@&${result.role.id}> is already a verified role, so it can't also be the unverified role. Skip this step or set one later with \`/role unverified\`.`,
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
                return;
            }

            serverSettings.unverifiedRoleName = result.role.id;
            serverSettings.autoAddUnverified = 1;
            database.updateServerSettings(interaction.guildId, serverSettings);

            const warning = await permissions.buildRoleWarning(interaction.guild, [result.role], language);
            const note = `Unverified role: ${roleMention(result.role, result.created)}, given to new members when they join.` +
                (warning ? `\n\n${warning}` : '');
            await interaction.update(step3Message(note)).catch(() => {});
            return;
        }

        // Step 2b → no unverified role (or keep the current one), show step 3
        if (interaction.customId === 'setupSkipUnverified') {
            await interaction.update(step3Message(null)).catch(() => {});
            return;
        }

        // Step 3a → open the domains modal
        if (interaction.customId === 'setupDomainsRestrict') {
            const domainsInput = new TextInputBuilder()
                .setCustomId('setupDomainsInput')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('@company.com, @*.edu')
                .setRequired(true);
            const label = new LabelBuilder()
                .setLabel('Allowed domains (comma-separated)')
                .setTextInputComponent(domainsInput);
            const header = new TextDisplayBuilder().setContent(
                '**Which email domains may verify?**\nUse `*` as a wildcard — `@*.edu` matches any .edu address.'
            );
            const modal = new ModalBuilder()
                .setCustomId('setupDomainsModal')
                .setTitle('📧 Allowed email domains')
                .addTextDisplayComponents(header)
                .addLabelComponents(label);
            await interaction.showModal(modal).catch(() => {});
            return;
        }

        // Step 3b → allow any email, straight to step 4
        if (interaction.customId === 'setupDomainsAny') {
            await interaction.update(step4Message('Allowing **any email address** to verify (you can restrict later with `/domain add`).')).catch(() => {});
            return;
        }

        // Step 4 → post the verification message
        if (interaction.customId === 'setupChannel' && interaction.isChannelSelectMenu()) {
            const channel = interaction.channels.first();
            const me = interaction.guild.members.me;
            const perms = channel && me ? channel.permissionsFor(me) : null;
            if (!perms || !perms.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages])) {
                const retry = step4Message(`⚠️ I can't send messages in <#${channel?.id}>. Give me **View Channel** and **Send Messages** there, or pick another channel.`);
                await interaction.update(retry).catch(() => {});
                return;
            }

            const serverSettings = await getSettings(interaction.guildId);
            const language = serverSettings.language;
            const sent = await channel.send({
                embeds: [buildVerifyEmbed(interaction.guild, language)],
                components: [buildVerifyButtons(language)]
            }).catch(() => null);
            if (!sent) {
                const retry = step4Message(`⚠️ Posting in <#${channel.id}> failed. Check my permissions there or pick another channel.`);
                await interaction.update(retry).catch(() => {});
                return;
            }

            await interaction.update(await buildSummaryMessage(interaction.guild, serverSettings, channel)).catch(() => {});
            return;
        }
    },

    /** The setupDomainsModal submit is routed here. */
    async handleModal(interaction) {
        if (!interaction.guild || !interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
            await interaction.reply({ content: 'Administrator permission required.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }

        const domains = parseDomains(interaction.fields.getTextInputValue('setupDomainsInput'));
        if (domains.length === 0) {
            // Keep the wizard message (still on step 3) intact and just tell the admin.
            await interaction.reply({
                content: '❌ No valid domains found. Formats: `@gmail.com`, `gmail.com`, or wildcards like `@*.edu` — comma-separated. Click **Restrict domains** to try again.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        const serverSettings = await getSettings(interaction.guildId);
        for (const domain of domains) {
            if (!serverSettings.domains.includes(domain)) {
                serverSettings.domains.push(domain);
            }
        }
        database.updateServerSettings(interaction.guildId, serverSettings);

        const display = domains.map(d => `\`${d.replaceAll('*', '✱')}\``).join(', ');
        const next = step4Message(`Allowed domains saved: ${display}`);
        if (interaction.isFromMessage()) {
            await interaction.update(next).catch(() => {});
        } else {
            await interaction.reply({ ...next, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
};
