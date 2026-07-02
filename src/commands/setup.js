const { SlashCommandBuilder } = require("@discordjs/builders");
const {
    MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType,
    ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, TextDisplayBuilder,
    PermissionsBitField
} = require('discord.js');
const database = require("../database/Database.js");
const registerRemoveDomain = require("../bot/registerRemoveDomain");
const { parseDomains } = require("../utils/parseDomains");
const { buildVerifyEmbed, buildVerifyButtons } = require("../bot/verifyMessage");

const WIZARD_COLOR = 0x5865F2;

// The wizard is stateless: every step writes straight to the database and the
// ephemeral wizard message itself carries the flow. Components on an ephemeral
// reply can only be used by the invoking admin, and handleComponent re-checks
// Administrator as belt-and-braces.

function getSettings(guildId) {
    return new Promise(resolve => database.getServerSettings(guildId, resolve));
}

function step1Message() {
    const embed = new EmbedBuilder()
        .setTitle('🧭 Setup — Step 1 of 3: Verified roles')
        .setDescription(
            'Pick the role(s) every verified member should receive.\n\n' +
            '*You can refine this later with `/role` and `/domainrole` (per-domain roles).*'
        )
        .setColor(WIZARD_COLOR);
    const row = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
            .setCustomId('setupRoles')
            .setPlaceholder('Select 1–5 roles for verified members')
            .setMinValues(1)
            .setMaxValues(5)
    );
    return { embeds: [embed], components: [row] };
}

function step2Message(savedRoleMentions, hierarchyWarning) {
    let description = `Saved default role(s): ${savedRoleMentions}\n\n` +
        'Should verification be limited to specific email domains?\n' +
        '• **Restrict domains** — e.g. only `@company.com` or `@*.edu` addresses\n' +
        '• **Allow any email** — every valid address can verify';
    if (hierarchyWarning) {
        description = `⚠️ ${hierarchyWarning}\n\n${description}`;
    }
    const embed = new EmbedBuilder()
        .setTitle('🧭 Setup — Step 2 of 3: Email domains')
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

function step3Message(domainsNote) {
    const embed = new EmbedBuilder()
        .setTitle('🧭 Setup — Step 3 of 3: Verification channel')
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
    const embed = new EmbedBuilder()
        .setTitle('✅ Setup complete!')
        .setDescription(
            `**Verified roles:** ${roleMentions}\n` +
            `**Allowed domains:** ${domainsDisplay}\n` +
            `**Verification message:** posted in <#${channel.id}>\n\n` +
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
        .setDescription('Guided 3-step setup: verified roles, email domains, and the verification channel')
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        await interaction.reply({ ...step1Message(), flags: MessageFlags.Ephemeral });
    },

    /** Buttons and select menus with a `setup*` customId are routed here. */
    async handleComponent(interaction) {
        if (!interaction.guild || !interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
            await interaction.reply({ content: 'Administrator permission required.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }

        // Step 1 → save roles, show step 2
        if (interaction.customId === 'setupRoles' && interaction.isRoleSelectMenu()) {
            const me = interaction.guild.members.me;
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

            // Pre-empt the most common failure: a selected role above the bot's highest
            // role can never be assigned.
            const tooHigh = me ? selected.filter(role => role.position >= me.roles.highest.position) : [];
            const warning = tooHigh.length > 0
                ? `The role(s) ${tooHigh.map(r => `<@&${r.id}>`).join(', ')} are **above my highest role**, so I can't assign them. ` +
                  'Move my role higher in **Server Settings → Roles**, or verification will fail.'
                : null;

            const mentions = selected.map(r => `<@&${r.id}>`).join(', ');
            await interaction.update(step2Message(mentions, warning)).catch(() => {});
            return;
        }

        // Step 2a → open the domains modal
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

        // Step 2b → allow any email, straight to step 3
        if (interaction.customId === 'setupDomainsAny') {
            await interaction.update(step3Message('Allowing **any email address** to verify (you can restrict later with `/domain add`).')).catch(() => {});
            return;
        }

        // Step 3 → post the verification message
        if (interaction.customId === 'setupChannel' && interaction.isChannelSelectMenu()) {
            const channel = interaction.channels.first();
            const me = interaction.guild.members.me;
            const perms = channel && me ? channel.permissionsFor(me) : null;
            if (!perms || !perms.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages])) {
                const retry = step3Message(`⚠️ I can't send messages in <#${channel?.id}>. Give me **View Channel** and **Send Messages** there, or pick another channel.`);
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
                const retry = step3Message(`⚠️ Posting in <#${channel.id}> failed. Check my permissions there or pick another channel.`);
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
            // Keep the wizard message (still on step 2) intact and just tell the admin.
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
        await registerRemoveDomain(interaction.guildId);

        const display = domains.map(d => `\`${d.replaceAll('*', '✱')}\``).join(', ');
        const next = step3Message(`Allowed domains saved: ${display}`);
        if (interaction.isFromMessage()) {
            await interaction.update(next).catch(() => {});
        } else {
            await interaction.reply({ ...next, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
};
