const {SlashCommandBuilder} = require('@discordjs/builders');
const database = require("../database/Database");
const { MessageFlags, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('status').setDescription('returns whether the bot is properly configured or not').setDefaultMemberPermissions(0),
    
    async getErrorNotifyStatus(guild, serverSettings) {
        const notifyType = serverSettings.errorNotifyType || 'owner';
        const notifyTarget = serverSettings.errorNotifyTarget || '';
        
        if (notifyType === 'owner') {
            const owner = await guild.fetchOwner().catch(() => null);
            return `📤 Sent to: **Server Owner** ${owner ? `(<@${owner.id}>)` : ''} via DM`;
        } else if (notifyType === 'channel') {
            const channel = guild.channels.cache.get(notifyTarget);
            if (channel) {
                return `📤 Sent to: **Channel** <#${channel.id}>`;
            } else {
                return `⚠️ Sent to: **Channel** (not found - will fallback to owner)`;
            }
        } else if (notifyType === 'user') {
            const member = await guild.members.fetch(notifyTarget).catch(() => null);
            if (member) {
                return `📤 Sent to: **User** <@${member.id}> via DM`;
            } else {
                return `⚠️ Sent to: **User** (not found - will fallback to owner)`;
            }
        }
        return '*Default (owner)*';
    },
    
    async execute(interaction) {
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            // Get guild statistics
            database.getGuildStats(interaction.guildId, async (guildStats) => {
                const isConfigured = serverSettings.status
                
                // Check roles
                const roleVerified = interaction.guild.roles.cache.find(r => r.id === serverSettings.verifiedRoleName)
                const roleUnverified = interaction.guild.roles.cache.find(r => r.id === serverSettings.unverifiedRoleName)
                
                // Check log channel
                const logChannel = serverSettings.logChannel ? interaction.guild.channels.cache.get(serverSettings.logChannel) : null
                
                // Format domains
                const domainsDisplay = serverSettings.domains.length > 0 
                    ? serverSettings.domains.map(d => `\`${d.replaceAll("*", "✱")}\``).join(', ')
                    : '*None configured*'
                
                // Format blacklist
                const blacklistDisplay = serverSettings.blacklist.length > 0
                    ? serverSettings.blacklist.map(b => `\`${b}\``).join(', ')
                    : '*None*'
                
                // Determine status color and icon
                const statusColor = isConfigured ? 0x57F287 : 0xED4245
                const statusIcon = isConfigured ? '✅' : '❌'
                const statusText = isConfigured ? 'Ready' : 'Not Configured'
                
                // Build issues list
                const issues = []
                if (!roleVerified) issues.push('• Verified role not set or not found')
                if (serverSettings.domains.length === 0) issues.push('• No email domains configured')
                
                // Get current month name for display
                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                                    'July', 'August', 'September', 'October', 'November', 'December']
                const currentMonth = monthNames[new Date().getMonth()]
                
                const statusEmbed = new EmbedBuilder()
                    .setTitle(`📊 Bot Status - ${statusIcon} ${statusText}`)
                    .setColor(statusColor)
                    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                    .addFields(
                        {
                            name: '👥 Roles',
                            value: 
                                `**Verified:** ${roleVerified ? `<@&${roleVerified.id}>` : '❌ *Not set*'}\n` +
                                `**Unverified:** ${roleUnverified ? `<@&${roleUnverified.id}>` : '➖ *Disabled*'}`,
                            inline: true
                        },
                        {
                            name: '🌐 Language',
                            value: `${serverSettings.language || 'english'}`,
                            inline: true
                        },
                        {
                            name: '📝 Log Channel',
                            value: logChannel ? `<#${logChannel.id}>` : '*Disabled*',
                            inline: true
                        },
                        {
                            name: '📧 Allowed Domains',
                            value: domainsDisplay
                        },
                        {
                            name: '🚫 Blacklisted Emails',
                            value: blacklistDisplay
                        },
                        {
                            name: '📬 Emails Sent',
                            value: 
                                `**${currentMonth}:** ${guildStats.mailsSentMonth.toLocaleString()}\n` +
                                `**Total:** ${guildStats.mailsSentTotal.toLocaleString()}`,
                            inline: true
                        },
                        {
                            name: '✅ Successful Verifications',
                            value: 
                                `**${currentMonth}:** ${guildStats.verificationsMonth.toLocaleString()}\n` +
                                `**Total:** ${guildStats.verificationsTotal.toLocaleString()}`,
                            inline: true
                        },
                        {
                            name: '⚙️ Auto Settings',
                            value: 
                                `**Auto-verify on join:** ${serverSettings.autoVerify ? '✅ Enabled' : '❌ Disabled'}\n` +
                                `**Auto-add unverified role:** ${serverSettings.autoAddUnverified ? '✅ Enabled' : '❌ Disabled'}`,
                            inline: false
                        },
                        {
                            name: '🔔 Error Notifications',
                            value: await this.getErrorNotifyStatus(interaction.guild, serverSettings),
                            inline: false
                        },
                        {
                            name: '💬 Custom Verify Message',
                            value: serverSettings.verifyMessage ? `"${serverSettings.verifyMessage}"` : '*Default message*'
                        }
                    )
                
                // Add issues field if there are problems
                if (issues.length > 0) {
                    statusEmbed.addFields({
                        name: '⚠️ Issues to Fix',
                        value: issues.join('\n')
                    })
                }
                
                statusEmbed.setFooter({ 
                    text: `Server: ${interaction.guild.name}`,
                    iconURL: interaction.guild.iconURL({ dynamic: true })
                })
                
                await interaction.reply({ embeds: [statusEmbed], flags: MessageFlags.Ephemeral })
            })
        })
    }
}
