---
title: How to Set Up Email Verification on a Discord Server
description: Step-by-step guide to adding email verification to a Discord server — invite the bot, pick your allowed domains, post the verification button. Takes about three minutes, with a 60-second video walkthrough.
video_id: LMWu3Ui2IAk
video_title: EmailVerify — Email Verification for Discord Servers (Setup in 60 Seconds)
video_date: 2026-08-27
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
Use the [invite link](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268504128&scope=bot%20applications.commands) and pick your server. The bot posts a short welcome message with a link back to this guide.
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

??? question "`Can't find roles. Please contact the admin!`"
    The EmailVerify role is below the role it's trying to assign. Move it up in **Server Settings → Roles**. This accounts for most reports of this error.

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
[:fontawesome-brands-discord: Add EmailVerify to your server](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268504128&scope=bot%20applications.commands){ .md-button .md-button--primary }
[Support server](https://discord.com/invite/fEBSHUQXu2){ .md-button }
</div>
