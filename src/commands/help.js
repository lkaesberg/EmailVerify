const {SlashCommandBuilder} = require("@discordjs/builders");
const { MessageFlags, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('help').setDescription('show instructions on how to use the bot').setDefaultMemberPermissions(0),
    async execute(interaction) {
        const helpEmbed = new EmbedBuilder()
            .setTitle('📚 Email Verification Bot - Setup Guide')
            .setDescription('Follow these steps to set up email verification for your server.')
            .setColor(0x5865F2)
            .addFields(
                {
                    name: '🚀 Quick Setup',
                    value: 
                        '**Step 1:** `/verifiedrole` - Set the role users get after verification\n' +
                        '**Step 2:** `/domains` - Add allowed email domains\n' +
                        '**Step 3:** `/button` - Create the verification button in a channel\n' +
                        '**Step 4:** `/status` - Verify everything is configured correctly'
                },
                {
                    name: '⚙️ Configuration Commands',
                    value:
                        '`/domains` - Add allowed email domains (e.g. @gmail.com)\n' +
                        '`/removedomain` - Remove an allowed domain\n' +
                        '`/verifiedrole` - Set/view the verified role\n' +
                        '`/unverifiedrole` - Set/view the unverified role (optional)\n' +
                        '`/verifymessage` - Set a custom verification message\n' +
                        '`/language` - Change the bot language'
                },
                {
                    name: '🛡️ Moderation Commands',
                    value:
                        '`/blacklist` - Block specific emails from verifying\n' +
                        '`/manualverify` - Manually verify a user\n' +
                        '`/set_log_channel` - Set a channel to log verifications'
                },
                {
                    name: '🔧 Advanced Settings',
                    value:
                        '`/add_unverified_on_join` - Auto-assign unverified role to new members\n' +
                        '`/verify_on_join` - Auto request user to verify on join\n' +
                        '`/delete_server_data` - Remove all bot data and leave server'
                },
                {
                    name: '📊 Other Commands',
                    value:
                        '`/status` - View current configuration\n' +
                        '`/help` - Show this help message\n' +
                        '`/verify` - Start verification (for users)'
                }
            )
            .setFooter({ text: 'Need more help? Visit our documentation or support server.' })

        await interaction.reply({
            embeds: [helpEmbed],
            flags: MessageFlags.Ephemeral
        })
    }
}