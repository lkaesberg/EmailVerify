require("../database/ServerSettings");
const UserTimeout = require("../UserTimeout");
const database = require("../database/Database");
const EmailUser = require("../database/EmailUser");
const {getLocale} = require("../Language");
const md5hash = require("../crypto/Crypto");
const {ChannelType} = require("discord.js");

module.exports = async function (message, bot, userGuilds, userCodes, userTimeouts, mailSender, emailNotify) {

    // Ensure we can receive DM messages across shards
    if (message.channel.type !== ChannelType.DM || message.author.bot) {
        return
    }
    // Debug log for DM receipt
    try { console.log(`[DM] From ${message.author.id}: ${message.content}`) } catch {}
    let userGuild = userGuilds.get(message.author.id)
    // If not on this shard, try to retrieve from other shards and mirror locally
    if (!userGuild && bot.shard) {
        try {
            const results = await bot.shard.broadcastEval(c => {
                const g = c.userGuilds ? c.userGuilds.get?.(message.author.id) : null;
                return g ? { id: g.id, name: g.name } : null;
            });
            const found = results.find(r => r);
            if (found) {
                try {
                    userGuild = await bot.guilds.fetch(found.id);
                    userGuilds.set(message.author.id, userGuild);
                } catch {}
            }
        } catch {}
    }
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
        let userCode = userCodes.get(message.author.id + userGuilds.get(message.author.id).id)
        // If missing, attempt to pull code from other shards
        if (!userCode && bot.shard) {
            try {
                const results = await bot.shard.broadcastEval(c => {
                    const key = message.author.id + (c.userGuilds?.get?.(message.author.id)?.id || '');
                    const value = c.userCodes?.get?.(key);
                    return value || null;
                });
                userCode = results.find(r => r);
                if (userCode) {
                    userCodes.set(message.author.id + userGuild.id, userCode);
                }
            } catch {}
        }
        if (userCode && userCode.code === text) {
            userTimeout.resetWaitTime()
            const roleVerified = userGuilds.get(message.author.id).roles.cache.find(role => role.id === serverSettings.verifiedRoleName);
            const roleUnverified = userGuilds.get(message.author.id).roles.cache.find(role => role.id === serverSettings.unverifiedRoleName);

            database.getEmailUser(userCode.email, userGuilds.get(message.author.id).id, async (currentUserEmail) => {
                let member = await bot.guilds.cache.get(currentUserEmail.guildID).members.fetch(currentUserEmail.userID)
                if (message.author.id === currentUserEmail.userID) {
                    return
                }
                if (member) {
                    try {
                        await member.roles.remove(roleVerified)
                        if (roleUnverified) {
                            await member.roles.add(roleUnverified)
                        }
                    } catch (e) {
                        console.log(e)
                    }
                    try {
                        await member.send("You got unverified on " + userGuilds.get(message.author.id).name + " because somebody else used that email!")
                    } catch {
                    }
                }

            })
            database.updateEmailUser(new EmailUser(userCode.email, message.author.id, userGuilds.get(message.author.id).id, serverSettings.verifiedRoleName, 0))
            let verify_client
            try {
                verify_client = userGuilds.get(message.author.id).members.cache.get(message.author.id)
                await verify_client.roles.add(roleVerified);

            } catch (e) {
                message.author.send(getLocale(serverSettings.language, "userCantFindRole")).catch(() => {
                })
                return
            }
            try {
                if (serverSettings.unverifiedRoleName !== "") {
                    await verify_client.roles.remove(roleUnverified);
                }
            } catch {
            }
            try {
                if (serverSettings.logChannel !== "") {
                    userGuilds.get(message.author.id).channels.cache.get(serverSettings.logChannel).send(`Authorized: <@${message.author.id}>\t →\t ${userCode.logEmail}`).catch(() => {
                    })
                }
            } catch {
            }
            // Track successful verification
            if (bot.serverStatsAPI) {
                bot.serverStatsAPI.increaseVerifiedUsers()
            }
            await message.reply(getLocale(serverSettings.language, "roleAdded", roleVerified.name))
            userCodes.delete(message.author.id + userGuilds.get(message.author.id).id)
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
                }))
            }
        }
    })

}
