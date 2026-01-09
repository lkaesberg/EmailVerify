const {SlashCommandBuilder} = require("@discordjs/builders");
const {MessageFlags} = require('discord.js');
const database = require("../database/Database.js");
const {getLocale} = require("../Language");
const md5hash = require("../crypto/Crypto");
const EmailUser = require("../database/EmailUser");
const ErrorNotifier = require("../utils/ErrorNotifier");

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

            const roleVerified = interaction.guild.roles.cache.find(role => role.id === serverSettings.verifiedRoleName);
            const roleUnverified = interaction.guild.roles.cache.find(role => role.id === serverSettings.unverifiedRoleName);

            if (!roleVerified) {
                await interaction.reply({
                    content: "❌ **Verified role not found!**\n\nPlease set a verified role first using `/role verified`",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const emailHash = md5hash(email);

            // Check if another user already has this email and unverify them
            database.getEmailUser(emailHash, interaction.guildId, async (currentUserEmail) => {
                if (currentUserEmail && currentUserEmail.userID !== targetUser.id) {
                    let member = await interaction.guild.members.fetch(currentUserEmail.userID).catch(() => null);
                    if (member) {
                        try {
                            await member.roles.remove(roleVerified);
                            if (roleUnverified) {
                                await member.roles.add(roleUnverified);
                            }
                        } catch (e) {
                            console.log(e);
                        }
                        try {
                            await member.send("You got unverified on " + interaction.guild.name + " because somebody else used that email!").catch(() => {});
                        } catch {}
                    }
                }
            });

            // Update the database with the new user
            database.updateEmailUser(new EmailUser(emailHash, targetUser.id, interaction.guildId, serverSettings.verifiedRoleName, 0));

            // Assign roles to the target user
            try {
                const verifyMember = await interaction.guild.members.fetch(targetUser.id);
                await verifyMember.roles.add(roleVerified);
                if (serverSettings.unverifiedRoleName !== "" && roleUnverified) {
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
                    interaction.guild.channels.cache.get(serverSettings.logChannel).send(
                        `🔧 <@${targetUser.id}> → \`${email}\` (by <@${interaction.user.id}>)`
                    ).catch(() => {});
                }
            } catch {}

            await interaction.reply({
                content: `✅ **Manual verification complete!**\n\n👤 **User:** <@${targetUser.id}>\n📧 **Email:** \`${email}\`\n🎭 **Role:** <@&${roleVerified.id}>`,
                flags: MessageFlags.Ephemeral
            });
        });
    }
};

