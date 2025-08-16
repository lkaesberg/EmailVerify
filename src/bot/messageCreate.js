require("../database/ServerSettings");
const UserTimeout = require("../UserTimeout");
const database = require("../database/Database");
const EmailUser = require("../database/EmailUser");
const {getLocale} = require("../Language");
const md5hash = require("../crypto/Crypto");
const {ChannelType} = require("discord.js");

module.exports = async function (message, bot, userGuilds, userCodes, userTimeouts, mailSender, emailNotify) {

    if (message.channel.type !== ChannelType.DM || message.author.id === bot.user.id) {
        return
    }
    const userGuild = userGuilds.get(message.author.id)
    if (!userGuild) {
        return
    }

    await database.getServerSettings(userGuild.id, async serverSettings => {
        if (!serverSettings.status) {
            return
        }
        const text = message.content
        if (serverSettings.blacklist.some((element) => text.includes(element)))
            return await message.reply(getLocale(serverSettings.language, "mailBlacklisted"));
        let userTimeout = userTimeouts.get(message.author.id)
        if (!userTimeout) {
            userTimeout = new UserTimeout()
            userTimeouts.set(message.author.id, userTimeout)
        }
        const userGuildRef = userGuilds.get(message.author.id)
        let userCode = userCodes.get(message.author.id + (userGuildRef && userGuildRef.id ? userGuildRef.id : userGuildRef))
        if (userCode && userCode.code === text) {
            userTimeout.resetWaitTime()
            const guildId = userGuildRef && userGuildRef.id ? userGuildRef.id : userGuildRef

            // Prepare role IDs
            const roleVerifiedId = serverSettings.verifiedRoleName
            const roleUnverifiedId = serverSettings.unverifiedRoleName

            // Unverify previous owner of the email, if any, on the shard that owns the guild
            await database.getEmailUser(userCode.email, guildId, async (currentUserEmail) => {
                if (currentUserEmail && message.author.id !== currentUserEmail.userID) {
                    if (bot.shard && typeof bot.shard.count === 'number' && bot.shard.count > 1) {
                        await bot.shard.broadcastEval(async (client, context) => {
                            const { guildId, prevUserId, roleVerifiedId, roleUnverifiedId, guildName } = context
                            const guild = client.guilds.cache.get(guildId)
                            if (!guild) return
                            try {
                                const member = await guild.members.fetch(prevUserId).catch(() => null)
                                if (!member) return
                                const roleVerified = guild.roles.cache.get(roleVerifiedId)
                                const roleUnverified = roleUnverifiedId ? guild.roles.cache.get(roleUnverifiedId) : null
                                if (roleVerified) await member.roles.remove(roleVerified).catch(() => {})
                                if (roleUnverified) await member.roles.add(roleUnverified).catch(() => {})
                                try { await member.send("You got unverified on " + guildName + " because somebody else used that email!").catch(() => {}) } catch {}
                            } catch {}
                        }, { context: { guildId, prevUserId: currentUserEmail.userID, roleVerifiedId, roleUnverifiedId, guildName: userGuildRef.name } }).catch(() => {})
                    } else {
                        try {
                            const guild = bot.guilds.cache.get(guildId)
                            if (guild) {
                                const member = await guild.members.fetch(currentUserEmail.userID).catch(() => null)
                                if (member) {
                                    const roleVerified = guild.roles.cache.get(roleVerifiedId)
                                    const roleUnverified = roleUnverifiedId ? guild.roles.cache.get(roleUnverifiedId) : null
                                    if (roleVerified) await member.roles.remove(roleVerified).catch(() => {})
                                    if (roleUnverified) await member.roles.add(roleUnverified).catch(() => {})
                                    try { await member.send("You got unverified on " + guild.name + " because somebody else used that email!").catch(() => {}) } catch {}
                                }
                            }
                        } catch {}
                    }
                }
            })

            // Update DB for the new owner
            database.updateEmailUser(new EmailUser(userCode.email, message.author.id, guildId, serverSettings.verifiedRoleName, 0))

            // Verify current user on the correct shard and log
            if (bot.shard && typeof bot.shard.count === 'number' && bot.shard.count > 1) {
                await bot.shard.broadcastEval(async (client, context) => {
                    const { guildId, userId, roleVerifiedId, roleUnverifiedId, logChannelId } = context
                    const guild = client.guilds.cache.get(guildId)
                    if (!guild) return
                    try {
                        const member = await guild.members.fetch(userId).catch(() => null)
                        if (!member) return
                        const roleVerified = guild.roles.cache.get(roleVerifiedId)
                        const roleUnverified = roleUnverifiedId ? guild.roles.cache.get(roleUnverifiedId) : null
                        if (roleVerified) await member.roles.add(roleVerified).catch(() => {})
                        if (roleUnverified) await member.roles.remove(roleUnverified).catch(() => {})
                        if (logChannelId) {
                            guild.channels.cache.get(logChannelId)?.send(`Authorized: <@${userId}>\t →\t ${member.user.tag}`).catch(() => {})
                        }
                    } catch {}
                }, { context: { guildId, userId: message.author.id, roleVerifiedId, roleUnverifiedId, logChannelId: serverSettings.logChannel } }).catch(() => {})
            } else {
                try {
                    const guild = bot.guilds.cache.get(guildId)
                    if (guild) {
                        const member = await guild.members.fetch(message.author.id).catch(() => null)
                        if (!member) throw new Error('member not found')
                        const roleVerified = guild.roles.cache.get(roleVerifiedId)
                        const roleUnverified = roleUnverifiedId ? guild.roles.cache.get(roleUnverifiedId) : null
                        if (roleVerified) await member.roles.add(roleVerified).catch(() => {})
                        if (roleUnverified) await member.roles.remove(roleUnverified).catch(() => {})
                        if (serverSettings.logChannel) {
                            guild.channels.cache.get(serverSettings.logChannel)?.send(`Authorized: <@${message.author.id}>\t →\t ${userCode.logEmail}`).catch(() => {})
                        }
                    }
                } catch (e) {
                    message.author.send(getLocale(serverSettings.language, "userCantFindRole")).catch(() => {})
                    return
                }
            }

            await message.reply(getLocale(serverSettings.language, "roleAdded", "verified")).catch(() => {})
            userCodes.delete(message.author.id + guildId)
        } else {
            let validEmail = false
            for (const domain of serverSettings.domains) {
                let regex = new RegExp(domain.replace(/\./g, "\\.").replace(/\*/g, ".+").concat("$"))
                if (regex.test(text)) {
                    validEmail = true
                }
            }
            if (text.split("@").length - 1 !== 1) {
                validEmail = false
            }
            if (text.includes(' ') || !validEmail) {
                await message.reply(getLocale(serverSettings.language, "mailInvalid"))
            } else {
                let timeoutSeconds = userTimeout.timestamp + userTimeout.waitseconds * 1000 - Date.now()
                if (timeoutSeconds > 0) {
                    await message.author.send(getLocale(serverSettings.language, "mailTimeout", (timeoutSeconds / 1000).toFixed(2)))
                    return
                }
                userTimeout.timestamp = Date.now()
                userTimeout.increaseWaitTime()
                let code = Math.floor((Math.random() + 1) * 100000).toString()

                await mailSender.sendEmail(text.toLowerCase(), code, userGuilds.get(message.author.id).name, message, emailNotify, (email) => userCodes.set(message.author.id + userGuilds.get(message.author.id).id, {
                    code: code,
                    email: md5hash(email),
                    logEmail: email
                }), { serverId: userGuilds.get(message.author.id).id })
            }
        }
    })

}
