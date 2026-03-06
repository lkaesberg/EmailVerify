# Legal

The Terms of Service and Privacy Policy for the Discord EmailBot.

**Last Updated:** January 2026

## Terms of Service

### Usage Agreement

By inviting the Bot to your server or using its features, you agree to the following Terms of Service and Privacy Policy.

The privilege of using and inviting this bot can be revoked for any server or user if the Terms of Service or Privacy
Policy of this Bot or the [Terms of Service](https://discord.com/terms), [Privacy Policy](https://discord.com/privacy)
or [Community Guidelines](https://discord.com/guidelines) of Discord gets violated.

The bot is allowed to collect data as described in the [Privacy Policy](#privacy-policy).

### Intended Age

Users under the minimum age specified in Discord's [Terms of Service](https://discord.com/terms) are not allowed to use this bot.

### Affiliation

This Bot is not affiliated with, supported, or made by Discord Inc.

### Disclaimer of Warranty

THE BOT IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

The creator does not guarantee that the bot will be uninterrupted, secure, error-free, or that any defects will be corrected.

### Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE CREATOR OF THE BOT SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO:

- Loss of data or information
- Service interruptions or downtime
- Unauthorized access to your server or data
- Any damages arising from the use or inability to use the bot
- Any conduct or content of any third party using the bot

Use of this bot is at your own risk. The creator is not responsible for any actions taken by server administrators using this bot.

### Service Availability

The bot is provided on a voluntary basis. The creator reserves the right to modify, suspend, or discontinue the service at any time without prior notice or liability.

### Modifications to Terms

These terms can be updated at any time by the owner of the bot. Continued use of the bot after changes constitutes acceptance of the new terms. Any user can opt out of these new terms by removing the Bot from their servers.

### Contact

Discord Server: [Official Support Discord](https://discord.com/invite/fEBSHUQXu2)

Email: <a href="mailto:emailbot@larskaesberg.de">Send Email</a>

---

## Privacy Policy

### Overview

This Privacy Policy explains how the EmailBot collects, uses, and protects your information when you use our service.

### Data Controller

The data controller responsible for your information is the creator of EmailBot, reachable at [emailbot@larskaesberg.de](mailto:emailbot@larskaesberg.de).

### Legal Basis for Processing

We process your data based on:

- **Legitimate interest:** To provide the email verification service
- **Consent:** By using the bot, you consent to the collection and processing of data as described

### Data Usage

The bot uses the stored data to:

- Verify that no email addresses are used multiple times
- Store server-specific settings and configurations
- Provide the verification functionality

The data is only used by the EmailBot and will not be shared with any third-party services.

### Stored Information

The following data is stored by the bot:

#### Server Data

| Data | Description |
|------|-------------|
| `id` | Server ID |
| `domains` | Verified/allowed email domains |
| `verifiedrole` | Role assigned to verified users |
| `unverifiedrole` | Role assigned to unverified users |
| `channelid` | Reference to the channel with the verify message |
| `messageid` | Reference to the verify message |
| `language` | Language setting for the server |
| `autoVerify` | Automatically verify users when joining |
| `autoAddUnverified` | Automatically add the unverified role to new members |
| `verifyMessage` | Custom message shown to users during verification |
| `logChannel` | Channel for logging verified user emails |
| `blacklist` | List of blocked email addresses |
| `errorNotifyType` | Error notification preference (owner, user, or channel) |
| `errorNotifyTarget` | User ID or channel ID for error notifications |

#### Server Statistics

| Data | Description |
|------|-------------|
| `guildID` | Server ID |
| `mailsSentTotal` | Total number of verification emails sent |
| `mailsSentMonth` | Number of verification emails sent this month |
| `verificationsTotal` | Total number of successful verifications |
| `verificationsMonth` | Number of successful verifications this month |
| `statsMonth` | Current month for tracking (resets monthly counters) |

#### User Data

| Data | Description |
|------|-------------|
| `userid` | Discord user ID |
| `email` | Hashed version of the email address (not stored in plain text) |
| `guildid` | Server ID where verification occurred |
| `groupid` | Group identifier for the verification |
| `isPublic` | Whether the email verification is public |

### Data Security

- Email addresses are stored as cryptographic hashes, not in plain text
- We implement reasonable security measures to protect your data
- However, no method of electronic storage is 100% secure, and we cannot guarantee absolute security

### Data Retention

- **Server data:** Retained until the bot is removed from the server or data is manually deleted
- **User data:** Retained until manually deleted by the user or server administrator

### Your Rights

You have the right to:

- **Access:** Request information about what data we store about you
- **Rectification:** Request correction of inaccurate data
- **Erasure:** Request deletion of your data (see [Removal of Data](#removal-of-data))
- **Portability:** Request a copy of your data

To exercise these rights, use the bot commands or contact us via email.

### Removal of Data

#### Server Data

- Server administrators can remove all server and associated user data using `/delete_server_data`
- When the bot is removed from a server, all related data is automatically deleted

#### User Data

- Users can remove their own data using `/delete_user_data`

### Children's Privacy

This bot is not intended for users under the minimum age required by Discord's Terms of Service. We do not knowingly collect data from children under this age.

### Changes to Privacy Policy

We may update this Privacy Policy from time to time. Changes will be indicated by updating the "Last Updated" date at the top of this document. Continued use of the bot constitutes acceptance of any changes.

### Contact

For any privacy-related questions or concerns, please contact:

- Discord Server: [Official Support Discord](https://discord.com/invite/fEBSHUQXu2)
- Email: <a href="mailto:larskaesberg@gmail.com">larskaesberg@gmail.com</a>