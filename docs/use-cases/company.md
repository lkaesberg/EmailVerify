---
title: Discord Email Verification for Companies and Teams
description: Restrict a Discord server to people with a working company mailbox. Verify employees, contractors and partner organisations by email domain, assign roles per domain, and keep an audit log of who verified and when.
faq:
  - q: How do I restrict a Discord server to company employees?
    a: Add an email verification bot and set your company domain as the only allowed domain. New members must receive a code at an address on that domain before the bot grants them a role, and channels stay closed to anyone who has not verified.
  - q: Can contractors or partner companies be given a different role?
    a: Yes. Map each domain to its own role, so anyone verifying with a partner's domain receives a partner role with its own channel permissions while employees receive the internal role.
  - q: Does verification revoke access when someone leaves the company?
    a: Not automatically. Verification proves mailbox control at the moment it happens, so offboarding still has to remove the member or their role. Exporting the verification log to CSV lets you reconcile Discord roles against your current staff list.
---

# Discord verification for companies and teams

Plenty of companies run a Discord — for engineering chat, for a customer or partner community, for an internal social space. The problem is always the same: Discord has no concept of your organisation. Anyone with an invite link is in, invite links leak, and six months later nobody can say who half the members are.

Gating on a company mailbox is the cheapest fix that actually means something. If someone can receive mail at `@yourcompany.com`, IT gave them that mailbox.

<div class="ev-cta" markdown>
[:fontawesome-brands-discord: Add to your server](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268553344&scope=bot%20applications.commands){ .md-button .md-button--primary }
[Quick start guide →](../setup.md){ .md-button }
</div>

---

## Who this is for

<ul class="ev-checks">
<li><strong>Internal team servers</strong> — employees only, no leaked-invite strangers.</li>
<li><strong>Partner and vendor servers</strong> — several organisations in one place, each with its own role.</li>
<li><strong>Customer communities with a paid tier</strong> — verified customer-domain members get a separate channel set.</li>
<li><strong>Contractor and agency spaces</strong> — time-bounded groups you can reconcile against a roster.</li>
<li><strong>Open-source projects with a maintainer channel</strong> — a small allowlist rather than a domain.</li>
</ul>

---

## Basic configuration

```
/role add @Employee
/domain add @yourcompany.com
/button #verification "Verify with your work email"
```

Three commands and the server is gated. Combine with an unverified role so nothing is readable until someone verifies:

```
/settings auto-unverified enable
```

Deny that role access to every channel. New arrivals see the verification channel and nothing else.

### Several organisations in one server

This is where per-domain roles earn their keep. A shared project server with a client and two agencies:

```
/domainrole add domain:@yourcompany.com  role:@Internal
/domainrole add domain:@client.com       role:@Client
/domainrole add domain:@agency.co.uk     role:@Agency
```

Everyone lands in the right channel set based on the mailbox they control, without an admin manually vetting each join. Add subsidiaries or a whole group's domains with a wildcard: `@*.yourgroup.com`.

### Subsidiaries and acquisitions

Companies accumulate domains. Wildcards handle the messy reality:

```
/domain add @yourcompany.com
/domain add @*.yourcompany.com
/domain add @acquired-brand.io
```

---

## Keeping a record

For anything that touches access control, "who got in and when" matters.

- **`/settings log-channel #access-log`** — posts every successful verification to a channel, in real time.
- **`/export logs`** (Pro) — writes the full history to CSV with timestamps, user IDs and the roles granted.
- **`/status`** — current configuration plus the problems the bot can detect on its own.

!!! warning "Verification is a check at the door, not a live identity system"
    A verification proves mailbox control **at the moment it happened**. It does not re-check later, so someone who leaves the company keeps their Discord role until you remove it.

    Treat the CSV export as an offboarding reconciliation tool: diff it against your current staff list periodically and remove the members who no longer belong. If you need this to be automatic, say so in the [support server](https://discord.com/invite/fEBSHUQXu2) — periodic re-verification is on the list of things people ask for.

---

## Deliverability on corporate mail

Corporate filters are less hostile than university ones but stricter than consumer mail. Two things worth doing before rollout:

1. **Run `/testmail` against your own work address.** Takes ten seconds and tells you whether codes land in the inbox, in Junk, or in a quarantine your users can't even see.
2. **If it's quarantined, ask IT to allowlist the sender.** For a company deployment this is a two-minute request that removes the problem permanently — and it's a far better answer than telling a hundred colleagues to check their spam folder.

Paid plans send through Zoho ZeptoMail (EU-hosted, transactional-only), which clears most filters that shared SMTP does not.

---

## Security and data handling

<ul class="ev-checks">
<li><strong>Addresses are stored as hashes.</strong> If the bot's database were exposed it would not yield a list of your employees' email addresses.</li>
<li><strong>No OAuth scope on your identity provider.</strong> The bot never touches your Entra ID or Google Workspace tenant, so there is nothing to review or approve there.</li>
<li><strong>Blacklist for throwaway domains</strong> — <code>/blacklist add *@tempmail.*</code> and similar, if you also allow a public domain.</li>
<li><strong>AGPL-3.0 source</strong>, so your security team can read it, and a <a href="https://github.com/lkaesberg/EmailVerify#-self-hosting">Docker image</a> if policy says it has to run on your own infrastructure.</li>
</ul>

Self-hosting is worth taking seriously for a corporate deployment: you supply your own SMTP credentials, the data never leaves your network, and the quota system doesn't apply.

---

## What this doesn't do

Being clear about the limits, because access control oversold is worse than access control understood:

- **It isn't SSO.** There's no session, no group sync, no automatic deprovisioning. If you need Entra ID or Google Workspace group membership to drive Discord roles continuously, this is not that tool.
- **It doesn't survive offboarding on its own.** See the reconciliation note above.
- **It doesn't stop a determined insider** from sharing their account. It stops strangers and leaked invite links, which is the actual threat for most company servers.

---

## Related

- [Quick start guide](../setup.md) — three steps, with a 60-second video
- [How EmailVerify compares to other verification bots](../compare.md)
- [Universities and schools](university.md) — the same approach for `.edu` domains
- [Courses, events and hackathons](communities.md) — allowlists for people with no domain in common

<div class="ev-cta" markdown>
[:fontawesome-brands-discord: Add EmailVerify to your server](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268553344&scope=bot%20applications.commands){ .md-button .md-button--primary }
[See pricing](../premium.md){ .md-button }
</div>
