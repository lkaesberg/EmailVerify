// Operator-facing Discord webhook for important lifecycle and revenue events.
// Configured via `operatorWebhookUrl` in config.json. If empty/missing, this
// module no-ops silently. All send failures are swallowed (logged) so a flaky
// webhook never crashes the bot.

const { WebhookClient, EmbedBuilder } = require('discord.js')
const config = require('../../config/config.json')

const COLORS = {
    info: 0x5865F2,
    success: 0x57F287,
    warn: 0xFFA500,
    error: 0xED4245
}

let webhook = null
const url = config.operatorWebhookUrl
if (url && typeof url === 'string' && url.trim().length > 0) {
    try {
        webhook = new WebhookClient({ url })
    } catch (err) {
        console.error('[OperatorWebhook] Invalid webhook URL — disabled:', err.message)
    }
}

/**
 * Send an operator notification embed to the configured Discord webhook.
 * Safe to call when no webhook is configured (no-op).
 *
 * @param {Object} opts
 * @param {string} opts.title         Embed title (required).
 * @param {string} [opts.description] Embed description / body text.
 * @param {Array<{name:string,value:string,inline?:boolean}>} [opts.fields] Embed fields.
 * @param {'info'|'success'|'warn'|'error'} [opts.level='info'] Color/severity hint.
 */
async function notify({ title, description, fields, level = 'info' } = {}) {
    if (!webhook || !title) return
    try {
        const embed = new EmbedBuilder()
            .setTitle(title.slice(0, 256))
            .setColor(COLORS[level] ?? COLORS.info)
            .setTimestamp()
        if (description) embed.setDescription(String(description).slice(0, 4000))
        if (Array.isArray(fields) && fields.length > 0) {
            embed.addFields(fields.slice(0, 25))
        }
        await webhook.send({ embeds: [embed] })
    } catch (err) {
        console.error('[OperatorWebhook] Failed to send notification:', err?.message || err)
    }
}

module.exports = {
    notify,
    get enabled() { return !!webhook }
}
