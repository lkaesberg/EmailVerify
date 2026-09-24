---
title: How to Set Up Email Verification on a Discord Server
description: Step-by-step guide to adding email verification to a Discord server. Invite the bot, pick your allowed domains and post the verification button. Takes about three minutes, with a 60-second video walkthrough.
video_id: LMWu3Ui2IAk
video_title: EmailVerify — Email Verification for Discord Servers (Setup in 60 Seconds)
# Full ISO 8601 date-time with offset — Search Console flags a bare date as
# "missing timezone". Quoted so PyYAML does not turn it into a datetime object,
# which would render with a space instead of the "T".
video_date: "2026-08-27T12:00:00+02:00"
faq:
  - q: How long does it take to set up email verification on Discord?
    a: About three minutes. Invite the bot, run the /setup wizard to choose a role and the allowed email domains, then run /button to post the verification message. The wizard handles all three steps in sequence.
  - q: Why do members get "Can't find roles. Please contact the admin!"?
    a: The EmailVerify role sits below the verified role in your server's role list, so Discord will not let it assign that role. Drag the EmailVerify role above every role it needs to grant, in Server Settings then Roles.
  - q: Verification emails are going to spam. What can I do?
    a: Run /testmail with your own address to see where it lands. Free-tier mail goes through the operator's own SMTP server; Standard and Pro subscriptions route through Zoho ZeptoMail, a transactional-only provider with markedly better inbox placement, which resolves most filtering problems at universities.
---

# Quick start

Setting up email verification on a Discord server takes about three minutes. Watch it happen, or follow the written steps below.

<div class="ev-video">
  <img src="/assets/video-thumb.jpg" alt="Video: setting up EmailVerify in a Discord server" width="1280" height="720" loading="lazy">
  <button class="ev-video-btn" type="button" data-ev-video="LMWu3Ui2IAk" data-ev-title="EmailVerify — Email Verification for Discord Servers (Setup in 60 Seconds)">
    <span class="ev-video-play" aria-hidden="true"></span>
    <span class="ev-video-text">
      <span class="ev-video-caption">Watch the 60-second setup walkthrough</span>
      <span class="ev-video-note">Click to play · loads from YouTube</span>
    </span>
  </button>
</div>

---

## Before you start

You need **Manage Server** permission on the Discord server, and a role you want verified members to receive. If you don't have one yet, create it first — `/setup` can point at it but can't invent it for you.

!!! warning "Put the bot's role above the roles it hands out"
    Discord refuses to let a bot assign a role that sits above its own. Open **Server Settings → Roles** and drag **EmailVerify** above your verified and unverified roles. Skipping this is the single most common cause of the `Can't find roles. Please contact the admin!` error.

---

## The three steps

<div class="ev-steps" markdown>

<div class="ev-step" markdown>
**Invite the bot.**
Use the [invite link](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268553344&scope=bot%20applications.commands) and pick your server. The bot posts a short welcome message with a link back to this guide.
</div>

<div class="ev-step" markdown>
**Run `/setup`.**
A three-step wizard: choose the role verified members get, add the email domains you accept, and pick the channel the verification button goes in. It writes the configuration and posts the button for you.
</div>

<div class="ev-step" markdown>
**Run `/testmail your@address.com`.**
Sends a real verification mail so you can see whether it lands in the inbox or in spam — *before* you announce the server to anyone. Worth doing every time.
</div>

</div>

That's the whole setup. Members now click the button, enter their address, receive a 6-digit code, type it back, and get the role.

---

## Prefer to configure it manually?

`/setup` is a shortcut for these commands, which you can also run individually:

| Step | Command | Notes |
|---|---|---|
| Default role | `/role add @Verified` | Given to everyone who verifies, whatever their domain. |
| Allowed domains | `/domain add @university.edu` | Use `@*.edu` for every `.edu` address. Omit entirely to accept any valid email. |
| Verification button | `/button #verification "Click to verify"` | Posts the embed members interact with. |
| Test delivery | `/testmail you@example.com` | Confirms SMTP works and shows spam placement. |
| Check config | `/status` | Lists your settings and flags problems it can detect. |

[Full command reference →](commands.md){ .md-button }

---

## Common refinements

### Different roles for different domains

Map a domain to its own role and members receive it in addition to your default role:

```
/domainrole add domain:@staff.company.com role:@Staff
/domainrole add domain:@*.edu role:@Student
```

### Lock the server down until someone verifies

Two options, and they combine:

- **`/settings auto-unverified enable`** — every new member is given an "Unverified" role automatically. Deny that role access to your channels and verification becomes mandatory.
- **`/settings auto-verify enable`** — new members are prompted to verify the moment they join, instead of having to find the button themselves.

### Block throwaway addresses

```
/blacklist add *@tempmail.*
/blacklist add *@mailinator.com
```

Wildcards work on both sides of the `@`, so `*spam*` blocks any address containing "spam".

### Keep a record of who verified

`/settings log-channel #verification-log` posts every successful verification to a channel. On Pro, `/export logs` writes the whole history to CSV.

---

## Troubleshooting

??? question "`Can't find roles. Please contact the admin!` / roles aren't being assigned"
    The EmailVerify role is below the role it's trying to assign. Open **Server Settings → Roles** and drag **EmailVerify** *above* every role it hands out. Discord enforces this and no permission setting overrides it.

    You don't have to guess: run **`/status`**, which checks live whether the bot holds the permissions it needs and whether each configured role is actually assignable, and names the ones that aren't. The bot also warns you the moment you set an unassignable role with `/role`, `/domainrole` or `/setup`, and messages your admins when a real verification fails because of it.

    A role that belongs to another bot, an integration, or Nitro boosting can **never** be assigned, by any bot, at any position — pick a different role for those.

??? question "The bot is missing permissions"
    Run **`/status`** — the **Bot Permissions & Role Order** section lists exactly what's missing and why each one is needed.

    The quickest fix is to [re-invite the bot](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268553344&scope=bot%20applications.commands). Re-inviting a bot that's already in the server doesn't remove it or reset anything — Discord just updates its permissions — so nothing is lost. Alternatively, enable the permissions by hand in **Server Settings → Roles → EmailVerify**.

    | Permission | Needed for |
    |---|---|
    | Manage Roles | Assigning and removing the verified / unverified roles |
    | View Channels | Seeing the channel with the verification button |
    | Send Messages | Posting the verification button and log lines |
    | Embed Links | Posting the verification button message, admin alerts and the welcome post. Slash-command replies and DMs work without it, so members can still verify — but `/button` and `/setup` can't post the button they click |
    | Read Message History | Reading the log channel for `/export` |
    | Attach Files | Attaching the CSV produced by `/export` |
    | View Audit Log | DMing whoever added the bot with the setup guide |

    The last three are optional: without them the bot still verifies members, but those specific features degrade.

??? question "Nobody is receiving the verification emails"
    Run `/testmail` with an address you control. If that arrives but members' don't, the recipients' mail provider is filtering — universities in particular run aggressive filters. Paid plans route through Zoho ZeptoMail (EU, transactional-only) which has substantially better inbox placement than shared SMTP.

??? question "The member says the code doesn't work"
    Codes are valid for 15 minutes and allow 5 attempts. The "Code Sent" message carries a **Resend code** button with a 60-second cooldown. After 5 failed attempts they need a fresh code.

??? question "I hit the monthly limit"
    The free tier is 25 verification emails per server per month, resetting on the 1st. You'll have been warned at 80% and 95%. [Credit packs or a subscription](premium.md) lift the cap; credits never expire.

??? question "I want to run it on my own infrastructure"
    It's AGPL-3.0 with a published Docker image. Point it at your own SMTP server and the quota system doesn't apply to you at all. See the [self-hosting section of the README](https://github.com/lkaesberg/EmailVerify#-self-hosting).

---

<div class="ev-cta" markdown>
[:fontawesome-brands-discord: Add EmailVerify to your server](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268553344&scope=bot%20applications.commands){ .md-button .md-button--primary }
[Support server](https://discord.com/invite/fEBSHUQXu2){ .md-button }
</div>
