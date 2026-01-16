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

#### Default Roles

Default roles are given to **all** verified users, regardless of their email domain.

| Command | Description |
|---------|-------------|
| `/role add <role>` | Add a role to the default roles list |
| `/role remove <role>` | Remove a role from the default roles list |
| `/role list` | View all configured default roles |
| `/role unverified [role]` | Set or view the optional role for unverified members (select current role to disable) |

#### Domain-Specific Roles

Assign different roles based on which email domain the user verifies with. Users receive their domain-specific roles **plus** any default roles.

| Command | Description |
|---------|-------------|
| `/domainrole add <domain> <role>` | Add a role for a specific email domain |
| `/domainrole remove <domain> <role>` | Remove a role from a specific domain |
| `/domainrole list` | View all domain-role mappings |
| `/domainrole clear <domain>` | Remove all roles for a specific domain |

#### Domain Role Examples

| Setup | Result |
|-------|--------|
| Default: `@Member`<br>Domain: `@*.edu` → `@Student` | User with `@stanford.edu` gets: `@Student`, `@Member` |
| Default: `@Verified`<br>Domain: `@company.com` → `@Employee`, `@Staff` | User with `@company.com` gets: `@Employee`, `@Staff`, `@Verified` |
| Domain: `@*.harvard.edu` → `@Harvard`<br>Domain: `@*.edu` → `@Student` | User with `@cs.harvard.edu` gets: `@Harvard`, `@Student` (all matching patterns) |

> 💡 **Tip:** When using `/domainrole add`, the domain field autocompletes with your configured domains from `/domain add`.

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

Block specific email addresses or patterns from verifying. Supports `*` wildcard.

| Command | Description |
|---------|-------------|
| `/blacklist add <patterns>` | Add patterns to the blacklist (supports `*` wildcard) |
| `/blacklist remove <patterns>` | Remove patterns from the blacklist |
| `/blacklist list` | View all blacklisted entries |
| `/blacklist clear` | Remove all entries from the blacklist |

#### Blacklist Wildcard Examples

| Pattern | Blocks | Example Matches |
|---------|--------|-----------------|
| `spam@example.com` | Specific email | `spam@example.com` |
| `*@tempmail.*` | All tempmail domains | `user@tempmail.com`, `test@tempmail.net` |
| `*spam*` | Emails containing "spam" | `spam@gmail.com`, `myspammail@test.com` |
| `test*@*` | Emails starting with "test" | `test123@gmail.com`, `testuser@company.com` |

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

### Role Display in Verification

When domain-specific roles are configured, the verification modal shows users which roles they will receive:

```
Accepted domains:
1. @*.edu → Student, Member
2. @company.com → Employee, Member
```

This helps users understand what access they'll get before verifying.
