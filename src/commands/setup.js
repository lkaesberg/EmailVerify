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
const { getLocale, defaultLanguage, discordLocalizations } = require("../Language");
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
        content: getLocale(language, 'setupRoleCreateFailed', result.error),
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

function roleMention(role, created, language) {
    return `<@&${role.id}>` + (created ? ' ' + getLocale(language, 'setupCreatedSuffix') : '');
}

function yesNo(value, language) {
    return getLocale(language, value ? 'setupYes' : 'setupNo');
}

function step1Message(language) {
    const embed = new EmbedBuilder()
        .setTitle(getLocale(language, 'setupStep1Title'))
        .setDescription(getLocale(language, 'setupStep1Body', roleName('verified', language)))
        .setColor(WIZARD_COLOR);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('setupCreateVerified')
            .setLabel(getLocale(language, 'setupCreateVerifiedButton', roleName('verified', language)))
            .setEmoji('✨')
            .setStyle(ButtonStyle.Primary)
    );
    const select = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
            .setCustomId('setupRoles')
            .setPlaceholder(getLocale(language, 'setupRolesPlaceholder'))
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

    let description = getLocale(language, 'setupStep2Saved', savedRoleMentions) + '\n\n';
    // The warning arrives already prefixed and formatted (see utils/permissions).
    if (hierarchyWarning) description = `${hierarchyWarning}\n\n${description}`;

    const row = new ActionRowBuilder();
    if (current) {
        description += getLocale(language, 'setupStep2Existing', `<@&${current.id}>`, yesNo(serverSettings.autoAddUnverified, language));
        row.addComponents(
            new ButtonBuilder().setCustomId('setupSkipUnverified').setLabel(getLocale(language, 'setupContinueButton')).setStyle(ButtonStyle.Primary)
        );
    } else {
        description += getLocale(language, 'setupStep2Offer', roleName('unverified', language));
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('setupCreateUnverified')
                .setLabel(getLocale(language, 'setupCreateUnverifiedButton', roleName('unverified', language)))
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('setupSkipUnverified').setLabel(getLocale(language, 'setupSkipButton')).setStyle(ButtonStyle.Primary)
        );
    }

    const embed = new EmbedBuilder()
        .setTitle(getLocale(language, 'setupStep2Title'))
        .setDescription(description)
        .setColor(WIZARD_COLOR);
    return { embeds: [embed], components: [row] };
}

function step3Message(language, note) {
    const description = (note ? `${note}\n\n` : '') + getLocale(language, 'setupStep3Body');
    const embed = new EmbedBuilder()
        .setTitle(getLocale(language, 'setupStep3Title'))
        .setDescription(description)
        .setColor(WIZARD_COLOR);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('setupDomainsRestrict')
            .setLabel(getLocale(language, 'setupRestrictButton'))
            .setEmoji('📧')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('setupDomainsAny')
            .setLabel(getLocale(language, 'setupAnyButton'))
            .setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
}

function step4Message(language, domainsNote) {
    const embed = new EmbedBuilder()
        .setTitle(getLocale(language, 'setupStep4Title'))
        .setDescription(`${domainsNote}\n\n` + getLocale(language, 'setupStep4Body'))
        .setColor(WIZARD_COLOR);
    const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('setupChannel')
            .setPlaceholder(getLocale(language, 'setupChannelPlaceholder'))
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    );
    return { embeds: [embed], components: [row] };
}

async function buildSummaryMessage(guild, serverSettings, channel) {
    const language = serverSettings.language;
    const roleMentions = (serverSettings.defaultRoles || [])
        .map(id => guild.roles.cache.get(id))
        .filter(Boolean)
        .map(r => `<@&${r.id}>`)
        .join(', ') || getLocale(language, 'setupNone');
    const domains = (serverSettings.domains || []);
    const domainsDisplay = domains.length > 0
        ? domains.map(d => `\`${d.replaceAll('*', '✱')}\``).join(', ')
        : getLocale(language, 'setupAnyEmailAddress');
    const unverified = serverSettings.unverifiedRoleName
        ? guild.roles.cache.get(serverSettings.unverifiedRoleName)
        : null;
    const firstRole = (serverSettings.defaultRoles || []).map(id => guild.roles.cache.get(id)).find(Boolean);

    // A role grants and hides nothing by itself, and the bot has no Manage Channels
    // permission to do it for the admin. Without this step members verify, get the
    // role and see exactly what they saw before.
    const website = getWebsiteUrl();
    const lockSteps =
        getLocale(language, 'setupLockTitle') + '\n' +
        getLocale(language, 'setupLockBody',
            firstRole ? `<@&${firstRole.id}>` : getLocale(language, 'setupLockYourRole'),
            `<#${channel.id}>`) +
        (unverified ? ' ' + getLocale(language, 'setupLockUnverified', `<@&${unverified.id}>`) : '') +
        (website ? '\n' + getLocale(language, 'setupLockGuide', `${website.replace(/\/$/, '')}/setup/#lock-the-server-down-until-someone-verifies`) : '');

    const embed = new EmbedBuilder()
        .setTitle(getLocale(language, 'setupSummaryTitle'))
        .setDescription(
            getLocale(language, 'setupSummaryRoles', roleMentions) + '\n' +
            (unverified ? getLocale(language, 'setupSummaryUnverified', `<@&${unverified.id}>`, yesNo(serverSettings.autoAddUnverified, language)) + '\n' : '') +
            getLocale(language, 'setupSummaryDomains', domainsDisplay) + '\n' +
            getLocale(language, 'setupSummaryChannel', `<#${channel.id}>`) + '\n\n' +
            `${lockSteps}\n\n` +
            getLocale(language, 'setupNextSteps')
        )
        .setColor(0x57F287);
    return { embeds: [embed], components: [] };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setDefaultPermission(true)
        .setName('setup')
        .setDescription(getLocale(defaultLanguage, 'setupCommandDescription'))
        .setDescriptionLocalizations(discordLocalizations('setupCommandDescription'))
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        const serverSettings = await getSettings(interaction.guildId);
        await interaction.reply({ ...step1Message(serverSettings.language), flags: MessageFlags.Ephemeral });
    },

    /** Buttons and select menus with a `setup*` customId are routed here. */
    async handleComponent(interaction) {
        // One read per click: the language for every reply below, and the settings the
        // role steps change and save.
        const serverSettings = interaction.guild ? await getSettings(interaction.guildId) : null;
        const language = serverSettings?.language || defaultLanguage;
        if (!interaction.guild || !interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
            await interaction.reply({ content: getLocale(language, 'setupAdminRequired'), flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }

        // Step 1 → save roles, show step 2
        if (interaction.customId === 'setupRoles' && interaction.isRoleSelectMenu()) {
            const selected = interaction.values
                .map(id => interaction.guild.roles.cache.get(id))
                .filter(role => role && role.id !== interaction.guild.id && !role.managed);

            if (selected.length === 0) {
                await interaction.reply({
                    content: getLocale(language, 'setupNoUsableRoles'),
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
                return;
            }

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
            const warning = await permissions.buildRoleWarning(interaction.guild, selected, language);

            const mentions = selected.map(r => `<@&${r.id}>`).join(', ');
            await interaction.update(step2Message(interaction.guild, serverSettings, mentions, warning)).catch(() => {});
            return;
        }

        // Step 1 (alternative) → create or reuse the verified role, show step 2
        if (interaction.customId === 'setupCreateVerified') {
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
            await interaction.update(step2Message(interaction.guild, serverSettings, roleMention(result.role, result.created, language), warning)).catch(() => {});
            return;
        }

        // Step 2a → create or reuse the unverified role, hand it out on join, show step 3
        if (interaction.customId === 'setupCreateUnverified') {
            const result = await ensureRole(interaction.guild, 'unverified', language);
            trackRole(interaction, 'unverified', result);
            if (!result.role) {
                await interaction.reply(roleCreateFailedReply(result, language)).catch(() => {});
                return;
            }
            // The same role can't be both: verifying would add it and remove it again.
            if (serverSettings.defaultRoles.includes(result.role.id)) {
                await interaction.reply({
                    content: getLocale(language, 'setupRoleBothKinds', `<@&${result.role.id}>`),
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
                return;
            }

            serverSettings.unverifiedRoleName = result.role.id;
            serverSettings.autoAddUnverified = 1;
            database.updateServerSettings(interaction.guildId, serverSettings);

            const warning = await permissions.buildRoleWarning(interaction.guild, [result.role], language);
            const note = getLocale(language, 'setupUnverifiedSaved', roleMention(result.role, result.created, language)) +
                (warning ? `\n\n${warning}` : '');
            await interaction.update(step3Message(language, note)).catch(() => {});
            return;
        }

        // Step 2b → no unverified role (or keep the current one), show step 3
        if (interaction.customId === 'setupSkipUnverified') {
            await interaction.update(step3Message(language, null)).catch(() => {});
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
                .setLabel(getLocale(language, 'setupDomainsModalLabel'))
                .setTextInputComponent(domainsInput);
            const header = new TextDisplayBuilder().setContent(getLocale(language, 'setupDomainsModalHeader'));
            const modal = new ModalBuilder()
                .setCustomId('setupDomainsModal')
                .setTitle(getLocale(language, 'setupDomainsModalTitle'))
                .addTextDisplayComponents(header)
                .addLabelComponents(label);
            await interaction.showModal(modal).catch(() => {});
            return;
        }

        // Step 3b → allow any email, straight to step 4
        if (interaction.customId === 'setupDomainsAny') {
            await interaction.update(step4Message(language, getLocale(language, 'setupAnyEmailNote'))).catch(() => {});
            return;
        }

        // Step 4 → post the verification message
        if (interaction.customId === 'setupChannel' && interaction.isChannelSelectMenu()) {
            const channel = interaction.channels.first();
            const me = interaction.guild.members.me;
            const perms = channel && me ? channel.permissionsFor(me) : null;
            if (!perms || !perms.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages])) {
                const retry = step4Message(language, getLocale(language, 'setupChannelNoPerms', `<#${channel?.id}>`));
                await interaction.update(retry).catch(() => {});
                return;
            }

            const sent = await channel.send({
                embeds: [buildVerifyEmbed(interaction.guild, language)],
                components: [buildVerifyButtons(language)]
            }).catch(() => null);
            if (!sent) {
                const retry = step4Message(language, getLocale(language, 'setupChannelPostFailed', `<#${channel.id}>`));
                await interaction.update(retry).catch(() => {});
                return;
            }

            await interaction.update(await buildSummaryMessage(interaction.guild, serverSettings, channel)).catch(() => {});
            return;
        }
    },

    /** The setupDomainsModal submit is routed here. */
    async handleModal(interaction) {
        const serverSettings = interaction.guild ? await getSettings(interaction.guildId) : null;
        const language = serverSettings?.language || defaultLanguage;
        if (!interaction.guild || !interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
            await interaction.reply({ content: getLocale(language, 'setupAdminRequired'), flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }

        const domains = parseDomains(interaction.fields.getTextInputValue('setupDomainsInput'));
        if (domains.length === 0) {
            // Keep the wizard message (still on step 3) intact and just tell the admin.
            await interaction.reply({
                content: getLocale(language, 'setupNoValidDomains'),
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        for (const domain of domains) {
            if (!serverSettings.domains.includes(domain)) {
                serverSettings.domains.push(domain);
            }
        }
        database.updateServerSettings(interaction.guildId, serverSettings);

        const display = domains.map(d => `\`${d.replaceAll('*', '✱')}\``).join(', ');
        const next = step4Message(language, getLocale(language, 'setupDomainsSaved', display));
        if (interaction.isFromMessage()) {
            await interaction.update(next).catch(() => {});
        } else {
            await interaction.reply({ ...next, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
};
