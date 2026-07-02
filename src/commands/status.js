const {SlashCommandBuilder} = require('@discordjs/builders');
const database = require("../database/Database");
const { MessageFlags, EmbedBuilder } = require('discord.js');
const premiumManager = require("../premium/PremiumManager");
const { buildPlanButtons, mobileHintLine } = require("../utils/premiumButtons");
const { getLocale } = require("../Language");

const MONTH_KEYS = [
    'statusMonthJan', 'statusMonthFeb', 'statusMonthMar', 'statusMonthApr',
    'statusMonthMay', 'statusMonthJun', 'statusMonthJul', 'statusMonthAug',
    'statusMonthSep', 'statusMonthOct', 'statusMonthNov', 'statusMonthDec'
]

// Discord caps embed field values at 1024 chars. A guild with many domains/roles can
// exceed that and make the whole /status reply throw. Trim at a separator boundary and
// flag the truncation so the command that diagnoses problems doesn't itself break.
function clampField(value, max = 1024) {
    if (typeof value !== 'string' || value.length <= max) return value
    const ellipsis = ' …'
    const budget = max - ellipsis.length
    let cut = value.slice(0, budget)
    const lastSep = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('\n'))
    if (lastSep > budget * 0.5) cut = cut.slice(0, lastSep)
    return cut + ellipsis
}

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('status').setDescription('View bot configuration, verification statistics, and check setup issues').setDefaultMemberPermissions(0),

    async getErrorNotifyStatus(guild, serverSettings, language) {
        const explicitChannelId = serverSettings.errorNotifyChannel;
        const fallbackChannelId = !explicitChannelId ? serverSettings.logChannel : '';
        const lines = [];

        if (explicitChannelId) {
            const ch = guild.channels.cache.get(explicitChannelId);
            lines.push(ch
                ? getLocale(language, 'statusErrorNotifyChannel', `<#${ch.id}>`)
                : getLocale(language, 'statusErrorNotifyChannelMissing'));
        } else if (fallbackChannelId) {
            const ch = guild.channels.cache.get(fallbackChannelId);
            if (ch) lines.push(getLocale(language, 'statusErrorNotifyChannelFallback', `<#${ch.id}>`));
            else lines.push(getLocale(language, 'statusErrorNotifyChannelNone'));
        } else {
            lines.push(getLocale(language, 'statusErrorNotifyChannelNone'));
        }

        const subscribers = Array.isArray(serverSettings.errorNotifyUsers) ? serverSettings.errorNotifyUsers.slice() : [];
        const owner = await guild.fetchOwner().catch(() => null);
        const ownerOptedIn = !serverSettings.errorNotifyOwnerOptedOut;
        if (owner && ownerOptedIn && !subscribers.includes(owner.id)) {
            subscribers.unshift(owner.id);
        }
        if (subscribers.length > 0) {
            lines.push(getLocale(language, 'statusErrorNotifySubscribers', subscribers.map(id => `<@${id}>`).join(', ')));
        } else {
            lines.push(getLocale(language, 'statusErrorNotifyNoSubscribers'));
        }

        return lines.join('\n');
    },

    async execute(interaction) {
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            const language = serverSettings.language || 'english'
            database.getGuildStats(interaction.guildId, async (guildStats) => {
                const isConfigured = serverSettings.status

                const defaultRoles = serverSettings.defaultRoles || []
                const validDefaultRoles = defaultRoles
                    .map(id => interaction.guild.roles.cache.get(id))
                    .filter(role => role !== undefined)

                const domainRoles = serverSettings.domainRoles || {}
                const domainRoleEntries = Object.entries(domainRoles)

                const roleUnverified = interaction.guild.roles.cache.find(r => r.id === serverSettings.unverifiedRoleName)
                const logChannel = serverSettings.logChannel ? interaction.guild.channels.cache.get(serverSettings.logChannel) : null

                const hasAllowedEmails = (serverSettings.allowedEmails || []).length > 0
                const domainsDisplay = serverSettings.domains.length > 0
                    ? serverSettings.domains.map(d => `\`${d.replaceAll("*", "✱")}\``).join(', ')
                    : (hasAllowedEmails ? getLocale(language, 'statusDomainsOnlyAllowedList') : getLocale(language, 'statusDomainsAllAccepted'))

                const blacklistDisplay = serverSettings.blacklist.length > 0
                    ? serverSettings.blacklist.map(b => `\`${b}\``).join(', ')
                    : getLocale(language, 'statusValueNone')

                const defaultRolesDisplay = validDefaultRoles.length > 0
                    ? validDefaultRoles.map(r => `<@&${r.id}>`).join(', ')
                    : getLocale(language, 'statusValueNoneSet')

                let domainRolesDisplay = getLocale(language, 'statusValueNoneConfigured')
                if (domainRoleEntries.length > 0) {
                    domainRolesDisplay = domainRoleEntries.map(([domain, roleIds]) => {
                        const roles = roleIds
                            .map(id => interaction.guild.roles.cache.get(id))
                            .filter(r => r)
                            .map(r => `<@&${r.id}>`)
                            .join(', ')
                        return `\`${domain.replaceAll("*", "✱")}\` → ${roles || getLocale(language, 'statusValueInvalidRoles')}`
                    }).join('\n')
                }

                const statusColor = isConfigured ? 0x57F287 : 0xED4245
                const statusIcon = isConfigured ? '✅' : '❌'
                const statusText = getLocale(language, isConfigured ? 'statusStateReady' : 'statusStateNotConfigured')

                const issues = []
                const hasAnyRoles = validDefaultRoles.length > 0 || domainRoleEntries.length > 0
                if (!hasAnyRoles) issues.push('• ' + getLocale(language, 'statusIssueNoRoles'))
                // Quota & error warnings need at least one reachable destination —
                // otherwise upsell/quota alerts silently go nowhere.
                const hasWarningDestination = !!serverSettings.errorNotifyChannel
                    || !!serverSettings.logChannel
                    || !serverSettings.errorNotifyOwnerOptedOut
                    || (serverSettings.errorNotifyUsers || []).length > 0
                if (!hasWarningDestination) issues.push('• ' + getLocale(language, 'statusIssueNoErrorDestination'))

                const currentMonth = getLocale(language, MONTH_KEYS[new Date().getMonth()])
                const enabledLabel = getLocale(language, 'statusValueEnabled')
                const disabledLabel = getLocale(language, 'statusValueDisabled')

                const statusEmbed = new EmbedBuilder()
                    .setTitle(`${getLocale(language, 'statusTitle')} - ${statusIcon} ${statusText}`)
                    .setColor(statusColor)
                    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                    .addFields(
                        {
                            name: getLocale(language, 'statusFieldDefaultRoles'),
                            value: clampField(defaultRolesDisplay),
                            inline: false
                        },
                        {
                            name: getLocale(language, 'statusFieldDomainRoles'),
                            value: clampField(domainRolesDisplay),
                            inline: false
                        },
                        {
                            name: getLocale(language, 'statusFieldUnverifiedRole'),
                            value: roleUnverified ? `<@&${roleUnverified.id}>` : `➖ *${disabledLabel}*`,
                            inline: true
                        },
                        {
                            name: getLocale(language, 'statusFieldLanguage'),
                            value: `${serverSettings.language || 'english'}`,
                            inline: true
                        },
                        {
                            name: getLocale(language, 'statusFieldLogChannel'),
                            value: logChannel ? `<#${logChannel.id}>` : `*${disabledLabel}*`,
                            inline: true
                        },
                        {
                            name: getLocale(language, 'statusFieldAllowedDomains'),
                            value: clampField(domainsDisplay)
                        },
                        {
                            name: getLocale(language, 'statusFieldAllowedEmailList'),
                            value: (serverSettings.allowedEmails || []).length > 0
                                ? getLocale(language, 'statusValueEmailCount', serverSettings.allowedEmails.length.toString())
                                : getLocale(language, 'statusValueNoneUploaded')
                        },
                        {
                            name: getLocale(language, 'statusFieldBlacklist'),
                            value: clampField(blacklistDisplay)
                        },
                        {
                            name: getLocale(language, 'statusFieldEmailsSent'),
                            value:
                                `**${currentMonth}:** ${guildStats.mailsSentMonth.toLocaleString()}\n` +
                                `**${getLocale(language, 'statusTotalLabel')}:** ${guildStats.mailsSentTotal.toLocaleString()}`,
                            inline: true
                        },
                        {
                            name: getLocale(language, 'statusFieldVerifications'),
                            value:
                                `**${currentMonth}:** ${guildStats.verificationsMonth.toLocaleString()}\n` +
                                `**${getLocale(language, 'statusTotalLabel')}:** ${guildStats.verificationsTotal.toLocaleString()}`,
                            inline: true
                        },
                        {
                            name: getLocale(language, 'statusFieldAutoSettings'),
                            value:
                                `**${getLocale(language, 'statusAutoVerifyLabel')}:** ${serverSettings.autoVerify ? '✅ ' + enabledLabel : '❌ ' + disabledLabel}\n` +
                                `**${getLocale(language, 'statusAutoAddUnverifiedLabel')}:** ${serverSettings.autoAddUnverified ? '✅ ' + enabledLabel : '❌ ' + disabledLabel}`,
                            inline: false
                        },
                        {
                            name: getLocale(language, 'statusFieldErrorNotify'),
                            value: await this.getErrorNotifyStatus(interaction.guild, serverSettings, language),
                            inline: false
                        },
                        {
                            name: getLocale(language, 'statusFieldVerifyMessage'),
                            value: serverSettings.verifyMessage ? `"${serverSettings.verifyMessage}"` : `*${getLocale(language, 'statusValueDefaultMessage')}*`
                        },
                        {
                            name: getLocale(language, 'statusFieldEmailStyle'),
                            value: getLocale(language, serverSettings.emailStyle === 'styled' ? 'statusEmailStyleStyled' : 'statusEmailStylePlain'),
                            inline: true
                        }
                    )

                if (issues.length > 0) {
                    statusEmbed.addFields({
                        name: getLocale(language, 'statusFieldIssues'),
                        value: issues.join('\n')
                    })
                }

                let components = []
                if (premiumManager.enabled) {
                    const premiumStatus = await premiumManager.getPremiumStatus(interaction.guildId, interaction.entitlements)
                    const tierName = premiumStatus.subscriptionTier
                        ? getLocale(language, premiumStatus.subscriptionTier === 'tier2' ? 'premiumPlanPro' : 'premiumPlanStandard')
                        : getLocale(language, 'premiumPlanFree')
                    const mailsInfo = premiumStatus.hasUnlimitedMails
                        ? getLocale(language, 'premiumMailsUnlimited', premiumStatus.mailsSentMonth.toString())
                        : (premiumStatus.mailMode === 'zeptomail' && !premiumStatus.subscriptionTier
                            ? getLocale(language, 'premiumMailsZeptoMode', premiumStatus.bonusCredits.toString())
                            : getLocale(language, 'premiumMailsLimited', premiumStatus.mailsSentMonth.toString(), premiumStatus.freeLimit.toString(), premiumStatus.freeRemaining.toString()))
                    const modeLabel = premiumStatus.subscriptionTier
                        ? getLocale(language, 'premiumMailModeSubscription')
                        : (premiumStatus.mailMode === 'zeptomail'
                            ? getLocale(language, 'premiumMailModeZepto')
                            : getLocale(language, 'premiumMailModeFree'))

                    let premiumValue =
                        `**${getLocale(language, 'premiumFieldPlan')}:** ${tierName}\n` +
                        `**${getLocale(language, 'premiumFieldMailMode')}:** ${modeLabel}\n` +
                        `**${getLocale(language, 'premiumFieldEmails')}:** ${mailsInfo}\n` +
                        `**${getLocale(language, 'premiumFieldCredits')}:** ${premiumStatus.bonusCredits}\n` +
                        `**${getLocale(language, 'premiumFieldCsv')}:** ${premiumStatus.csvUnlocked || premiumStatus.subscriptionTier === 'tier2' ? getLocale(language, 'premiumCsvUnlocked') : getLocale(language, 'premiumCsvLocked')}`

                    // Lost demand + run-out forecast: the two numbers that actually
                    // drive an upgrade decision, surfaced where admins diagnose problems.
                    if (premiumStatus.mailsDeniedMonth > 0) {
                        premiumValue += `\n${getLocale(language, 'premiumBlockedThisMonth', premiumStatus.mailsDeniedMonth.toString())}`
                    }
                    if (!premiumStatus.subscriptionTier && premiumStatus.mailMode !== 'zeptomail') {
                        const forecast = premiumManager.forecastLine(language, premiumStatus.mailsSentMonth)
                        if (forecast) premiumValue += `\n${forecast}`
                    }

                    components = buildPlanButtons(premiumStatus, { context: 'status' })

                    // Discord mobile can't complete SKU purchases — when buy buttons are
                    // shown, tell mobile admins to switch to desktop/browser.
                    if (components.length > 0) {
                        const mobileHint = mobileHintLine(language)
                        if (mobileHint) premiumValue += `\n${mobileHint}`
                    }

                    statusEmbed.addFields({
                        name: getLocale(language, 'statusFieldPremium'),
                        value: premiumValue
                    })
                }

                statusEmbed.setFooter({
                    text: getLocale(language, 'statusFooterServer', interaction.guild.name),
                    iconURL: interaction.guild.iconURL({ dynamic: true })
                })

                try {
                    await interaction.reply({ embeds: [statusEmbed], components, flags: MessageFlags.Ephemeral })
                } catch (err) {
                    // SKU may be unavailable/unpublished – retry without premium buttons
                    if (components.length > 0 && err.code === 50035) {
                        await interaction.reply({ embeds: [statusEmbed], components: [], flags: MessageFlags.Ephemeral })
                    } else {
                        throw err
                    }
                }
            })
        })
    }
}
