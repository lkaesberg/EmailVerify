module.exports = class MailProvider {
    get name() { return 'unknown' }

    /**
     * @param {{ from: string, fromName: string, to: string, subject: string,
     *          text: string, html?: string, headers?: object }} opts
     * @returns {Promise<{ accepted: string[], rejected: string[],
     *          messageId?: string, response?: string }>}
     */
    async sendMail(opts) {
        throw new Error('MailProvider.sendMail not implemented')
    }
}
