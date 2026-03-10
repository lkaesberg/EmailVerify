const {SlashCommandBuilder} = require('@discordjs/builders');
const database = require("../database/Database");
const { MessageFlags, EmbedBuilder } = require('discord.js');
const premiumManager = require("../premium/PremiumManager");
const { getLocale } = require("../Language");
module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('status').setDescription('View bot configuration, verification statistics, and check setup issues').setDefaultMemberPermissions(0),
    
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
                
                // Check default roles
                const defaultRoles = serverSettings.defaultRoles || []
                const validDefaultRoles = defaultRoles
                    .map(id => interaction.guild.roles.cache.get(id))
                    .filter(role => role !== undefined)
                
                // Check domain roles
                const domainRoles = serverSettings.domainRoles || {}
                const domainRoleEntries = Object.entries(domainRoles)
                
                // Check unverified role
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
                
                // Format default roles
                const defaultRolesDisplay = validDefaultRoles.length > 0
                    ? validDefaultRoles.map(r => `<@&${r.id}>`).join(', ')
                    : '❌ *None set*'
                
                // Format domain-specific roles
                let domainRolesDisplay = '*None configured*'
                if (domainRoleEntries.length > 0) {
                    domainRolesDisplay = domainRoleEntries.map(([domain, roleIds]) => {
                        const roles = roleIds
                            .map(id => interaction.guild.roles.cache.get(id))
                            .filter(r => r)
                            .map(r => `<@&${r.id}>`)
                            .join(', ')
                        return `\`${domain.replaceAll("*", "✱")}\` → ${roles || '*invalid roles*'}`
                    }).join('\n')
                }
                
                // Determine status color and icon
                const statusColor = isConfigured ? 0x57F287 : 0xED4245
                const statusIcon = isConfigured ? '✅' : '❌'
                const statusText = isConfigured ? 'Ready' : 'Not Configured'
                
                // Build issues list
                const issues = []
                const hasAnyRoles = validDefaultRoles.length > 0 || domainRoleEntries.length > 0
                if (!hasAnyRoles) issues.push('• No verified roles configured (use `/role add` or `/domainrole add`)')
                if (serverSettings.domains.length === 0 && (serverSettings.allowedEmails || []).length === 0) issues.push('• No email domains or allowed emails configured')
                
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
                            name: '🎭 Default Roles (all verified users)',
                            value: defaultRolesDisplay,
                            inline: false
                        },
                        {
                            name: '🔗 Domain-Specific Roles',
                            value: domainRolesDisplay,
                            inline: false
                        },
                        {
                            name: '👤 Unverified Role',
                            value: roleUnverified ? `<@&${roleUnverified.id}>` : '➖ *Disabled*',
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
                            name: '📋 Allowed Email List',
                            value: (serverSettings.allowedEmails || []).length > 0 
                                ? `${serverSettings.allowedEmails.length} email address(es)` 
                                : '*None uploaded*'
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
                
                // Add premium info when monetization is enabled
                if (premiumManager.enabled) {
                    const premiumStatus = await premiumManager.getPremiumStatus(interaction.guildId, interaction.entitlements)
                    const lang = serverSettings.language || 'english'
                    const tierName = premiumStatus.subscriptionTier
                        ? getLocale(lang, premiumStatus.subscriptionTier === 'tier2' ? 'premiumPlanPro' : 'premiumPlanStandard')
                        : getLocale(lang, 'premiumPlanFree')
                    const mailsInfo = premiumStatus.hasUnlimitedMails
                        ? getLocale(lang, 'premiumMailsUnlimited', premiumStatus.mailsSentMonth.toString())
                        : getLocale(lang, 'premiumMailsLimited', premiumStatus.mailsSentMonth.toString(), premiumStatus.freeLimit.toString(), premiumStatus.freeRemaining.toString())
                    
                    statusEmbed.addFields({
                        name: '💳 Premium',
                        value:
                            `**${getLocale(lang, 'premiumFieldPlan')}:** ${tierName}\n` +
                            `**${getLocale(lang, 'premiumFieldEmails')}:** ${mailsInfo}\n` +
                            `**${getLocale(lang, 'premiumFieldCredits')}:** ${premiumStatus.bonusCredits}\n` +
                            `**${getLocale(lang, 'premiumFieldCsv')}:** ${premiumStatus.csvUnlocked || premiumStatus.subscriptionTier === 'tier2' ? getLocale(lang, 'premiumCsvUnlocked') : getLocale(lang, 'premiumCsvLocked')}`
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
