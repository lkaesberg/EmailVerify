# Commands

## 👤 User Commands

These commands can be used by any user.

| Command | Description |
|---------|-------------|
| `/verify` | Start the email verification process to get access to the server |
| `/data delete-user` | Delete your personal verification data and remove your verified status |

---

## 🔧 Administrator Commands

The following commands require administrator permissions.

### 👥 Role Configuration

Configure which roles are assigned during the verification process.

| Command | Description |
|---------|-------------|
| `/role verified [role]` | Set or view the role given to users after successful verification |
| `/role unverified [role]` | Set or view the optional role for unverified members (select current role to disable) |

### 📧 Domain Management

Control which email domains are allowed for verification.

| Command | Description |
|---------|-------------|
| `/domain add <domains>` | Add allowed email domains (comma-separated for multiple) |
| `/domain remove <domains>` | Remove allowed domains |
| `/domain list` | View all currently allowed domains |
| `/domain clear` | Remove all allowed domains |

#### Wildcard Support

Use `*` as a wildcard to match any text:

| Pattern | Matches | Example |
|---------|---------|---------|
| `@gmail.com` | Only Gmail | `user@gmail.com` ✓ |
| `@*.edu` | Any .edu domain | `user@stanford.edu` ✓, `user@mit.edu` ✓ |
| `@*.harvard.edu` | Harvard subdomains | `user@cs.harvard.edu` ✓, `user@law.harvard.edu` ✓ |
| `@company.com` | Specific company | `user@company.com` ✓ |

### 🚫 Blacklist Management

Block specific email addresses or patterns from verifying.

| Command | Description |
|---------|-------------|
| `/blacklist add <emails>` | Add emails or patterns to the blacklist (comma-separated) |
| `/blacklist remove <emails>` | Remove emails or patterns from the blacklist |
| `/blacklist list` | View all blacklisted entries |
| `/blacklist clear` | Remove all entries from the blacklist |

**Blacklist examples:**
- `spam@example.com` — Block a specific email
- `@tempmail.com` — Block an entire domain
- `troll` — Block any email containing "troll"

### ⚙️ Settings

Configure bot behavior and preferences.

| Command | Description |
|---------|-------------|
| `/settings language <language>` | Change the bot's display language |
| `/settings log-channel [channel]` | Set a channel for verification logs (leave empty to disable) |
| `/settings verify-message [message]` | Set a custom message for verification emails (leave empty for default) |
| `/settings auto-verify <enable>` | Automatically prompt new members to verify when they join |
| `/settings auto-unverified <enable>` | Automatically assign the unverified role to new members |

### 🛡️ Moderation & Setup

| Command | Description |
|---------|-------------|
| `/button <channel> <buttontext> [title] [message] [color]` | Create a verification button embed in a channel |
| `/manualverify <user> <email>` | Manually verify a user without email confirmation |
| `/set_error_notify owner` | Send error notifications to the server owner (default) |
| `/set_error_notify channel <channel>` | Send error notifications to a specific channel |
| `/set_error_notify user <user>` | Send error notifications to a specific user via DM |
| `/set_error_notify status` | View current error notification settings |

### 📊 Information

| Command | Description |
|---------|-------------|
| `/status` | View bot configuration, verification statistics, and check for setup issues |
| `/help` | Show setup instructions and command overview |

### ⚠️ Data Management (Danger Zone)

| Command | Description |
|---------|-------------|
| `/data delete-server` | Delete all server data and remove the bot from the server |

---

## ⚠️ Important Notes

### Role Hierarchy

The **EmailBot role must be higher** in the role hierarchy than both the verified and unverified roles. Otherwise, you'll see this error:

> `Can't find roles. Please contact the admin!`

![Role Hierarchy Example](https://raw.githubusercontent.com/lkaesberg/EmailBot/main/images/bothierarchy.png)

### Unverified Role Usage

The unverified role can be used to:
- Make a verification channel visible only to unverified users
- Restrict access to most channels until users verify
- Combined with `/settings auto-unverified`, automatically restrict new members
