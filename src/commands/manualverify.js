const {SlashCommandBuilder} = require("@discordjs/builders");
const {MessageFlags} = require('discord.js');
const database = require("../database/Database.js");
const {getLocale} = require("../Language");
const md5hash = require("../crypto/Crypto");
const EmailUser = require("../database/EmailUser");
const ErrorNotifier = require("../utils/ErrorNotifier");
const { resolveVerificationRoles, unverifyPreviousHolder } = require("../utils/resolveVerificationRoles");

module.exports = {
    data: new SlashCommandBuilder()
        .setDefaultPermission(true)
        .setName('manualverify')
        .setDescription('Bypass email verification and manually verify a user (Admin only)')
        .addUserOption(option => option
            .setName('user')
            .setDescription('The member to verify - they will receive the verified role')
            .setRequired(true))
        .addStringOption(option => option
            .setName('email')
            .setDescription('Email address to associate')
            .setRequired(true))
        .setDefaultMemberPermissions(0),
    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const email = interaction.options.getString('email').trim().toLowerCase();

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (!serverSettings.status) {
                await ErrorNotifier.notify({
                    guild: interaction.guild,
                    errorTitle: getLocale(serverSettings.language, 'errorBotNotConfiguredTitle'),
                    errorMessage: getLocale(serverSettings.language, 'errorBotNotConfiguredMessage'),
                    user: interaction.user,
                    interaction: interaction,
                    language: serverSettings.language
                });
                return;
            }

            // Resolve roles the same way the email-verification flow does: default roles
            // plus any roles mapped to domains this email matches. Fixes the old behaviour
            // that only honoured the legacy single verifiedRoleName.
            const { rolesToAdd, roleUnverified } = resolveVerificationRoles(interaction.guild, serverSettings, email);

            if (rolesToAdd.length === 0) {
                await interaction.reply({
                    content: "❌ **No role to assign.**\n\nThis email doesn't match any configured role. Set default roles with `/role add` or domain-specific roles with `/domainrole add`.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const emailHash = md5hash(email);

            // Check if another user already has this email and unverify them
            unverifyPreviousHolder(interaction.guild, emailHash, targetUser.id, rolesToAdd, roleUnverified, serverSettings.language);

            // Update the database with the new user (first role kept in the legacy field)
            const primaryRoleId = (serverSettings.defaultRoles && serverSettings.defaultRoles[0]) || rolesToAdd[0].id || '';
            database.updateEmailUser(new EmailUser(emailHash, targetUser.id, interaction.guildId, primaryRoleId, 0));

            // Assign roles to the target user
            const assignedRoleNames = [];
            try {
                const verifyMember = await interaction.guild.members.fetch(targetUser.id);
                for (const role of rolesToAdd) {
                    await verifyMember.roles.add(role);
                    assignedRoleNames.push(role.name);
                }
                if (roleUnverified) {
                    await verifyMember.roles.remove(roleUnverified).catch(() => {});
                }
            } catch (e) {
                await interaction.reply({
                    content: `Failed to assign role to user. Make sure the user is in the server and the bot has proper permissions.\nError: ${e.message}`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            // Log to the log channel if configured
            try {
                if (serverSettings.logChannel !== "") {
                    const logChannel = interaction.guild.channels.cache.get(serverSettings.logChannel);
                    if (logChannel) {
                        logChannel.send(
                            `🔧 <@${targetUser.id}> → \`${email}\` (by <@${interaction.user.id}>)`
                        ).catch(() => {});
                    }
                }
            } catch {}

            await interaction.reply({
                content: `✅ **Manual verification complete!**\n\n👤 **User:** <@${targetUser.id}>\n📧 **Email:** \`${email}\`\n🎭 **Roles:** ${assignedRoleNames.map(n => `\`${n}\``).join(', ') || '—'}`,
                flags: MessageFlags.Ephemeral
            });
        });
    }
};

