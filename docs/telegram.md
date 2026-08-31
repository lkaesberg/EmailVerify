# Telegram

EmailVerify runs on Telegram as well as Discord. Both platforms share one
verification core — the same domain rules, the same code lifetime, the same
monthly quota — so a community behaves identically whichever side it lives on.

What differs is how access is granted. **Telegram has no roles.** Being verified
means being *in the chat*, so instead of picking a role you pick a **gate mode**.

## Setup

1. Add the bot to your group or channel and make it an **administrator**.
   It needs *Invite users via link*; the `mute` gate also needs *Ban users*.
2. Run `/setup` **inside that chat**.
3. Share the link `/setup` gives you. It points at the bot, not the group —
   Telegram does not let a bot message someone who has never started it, so
   people must open the bot first.
4. Configure domains exactly as on Discord: `/domain add @university.edu`.

## Gate modes

Choose with `/gatemode <mode>` in the gated chat.

| Mode | How it holds people back | Needs |
|---|---|---|
| `joinRequest` *(default)* | The chat requires approval; the bot approves once the email is confirmed. | Chat set to "approve new members" |
| `mute` | People can join and read, but cannot post until verified. | *Ban users* permission, and group privacy **off** |
| `inviteLink` | The chat stays private. After verifying, the member gets a personal invite link that works once and expires. | — |

### Routing people into different chats

Discord's domain-specific *roles* become domain-specific *chats*. Map a domain
pattern to the chats it should unlock, and one verification can put staff and
students in different groups:

```
@staff.university.edu  →  Staff group
@*.university.edu      →  Students group
```

If you gate a chat and configure no routing at all, verified members simply get
into that chat — routing is only needed when there is more than one destination.

### Purchaser lists

The email allowlist works the same as on Discord: upload the addresses that are
allowed in, and only those can verify. On Telegram this is the most common
setup — export the buyer list from Gumroad, Stripe or Teachable and only
customers get into the community.

## Member commands

| Command | Description |
|---|---|
| `/verify` | Start or restart verification |
| `/resend` | Send the code again (60-second cooldown) |
| `/status` | Where your verification stands |
| `/cancel` | Abandon the current attempt |

Members send their email address and then the 6-digit code as ordinary messages
in the bot chat. The message containing the address is deleted once read; only a
hash of it is ever stored.

## Paying with Telegram Stars

Run `/premium` in the gated chat. Plans and credit packs are the same as on
Discord, priced in Stars:

| Product | What it does |
|---|---|
| Standard / Pro | Monthly subscription, renews automatically, cancel any time from Telegram |
| Credit packs | 100 / 500 / 2000 verification emails, no expiry |
| Email list unlock | Upload an approved-address list and export verified members |

Subscriptions are billed by Telegram every 30 days and simply keep working;
there is no "redeem" step as there is with Discord's credit packs.

## Limits worth knowing

- **The bot cannot start a conversation.** If someone requests to join without
  ever having opened the bot, there is no way to reach them — which is why the
  link from `/setup` is the entry point you publish.
- **Notifications to admins** are best-effort for the same reason: an
  administrator who has never started the bot cannot be messaged.
- **The `mute` gate needs member updates.** It works by reacting to people joining,
  which Telegram only reports to a bot that is an administrator of the chat. If the
  bot is demoted, `mute` silently stops holding anyone back — `joinRequest` and
  `inviteLink` keep working, because those are driven by the member's own action.
- **Payouts** for Stars go out through Fragment as TON, with a 1,000-Star
  minimum and a hold of about three weeks. Stars bought inside the iOS or
  Android apps are worth noticeably less than ones bought on the web, because
  Apple and Google take their cut first.

## Self-hosting

Add a `telegram` block to `config/config.json`:

```json
{
  "telegram": {
    "enabled": true,
    "token": "<token from @BotFather>",
    "botUsername": "YourVerifyBot",
    "inviteLinkTtlMinutes": 15,
    "stars": {
      "enabled": true,
      "prices": { "subscriptionTier1": 350, "credits100": 200 }
    }
  }
}
```

Leave `enabled` false and the process runs Discord-only, exactly as before. Both
front-ends share one process and one `config/bot.db`, so nothing else changes.

In @BotFather, keep **privacy mode on** (the bot only needs commands, not every
message) and enable **group admin rights**.
