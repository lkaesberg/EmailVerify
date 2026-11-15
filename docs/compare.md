---
title: "Discord Verification Methods Compared: Captcha, Phone, Email"
description: Captcha bots, alt-account detection, phone verification, manual vetting, SSO and email domain verification compared. What each one actually proves about a Discord member, and which problem each one solves.
faq:
  - q: How is EmailVerify different from Guild.xyz?
    a: Both can give a Discord role to people with an email address at a domain. With Guild.xyz, members sign in on guild.xyz and connect Discord and their email to a Guild account, and the domain has to match exactly. With EmailVerify, members verify inside Discord with a 6-digit code, and wildcard rules such as @*.edu cover every matching domain. Guild.xyz covers much more than email, with 47 requirement types including wallets and tokens, and its free plan includes the email check.
  - q: Do Discord Student Hubs verify members of my server?
    a: No. A Student Hub verifies a school email address to let a student into Discord's hub for that school, where students find classmates and student-run servers. Discord notes that servers listed in a hub may include non-students. To control who gets into your own server and which channels they see, you need a verification bot such as EmailVerify.
  - q: What is the difference between a captcha bot and an email verification bot on Discord?
    a: A captcha bot proves the member is a human rather than a script. An email verification bot proves the member controls a mailbox at a domain you chose. They answer different questions, and a server that needs to know who someone is gains nothing from a captcha.
  - q: Is Discord's built-in verification level enough?
    a: Discord's verification levels apply friction based on account age, a verified email on the Discord account, or a phone number. None of them tell you anything about the person's relationship to your organisation, so they reduce drive-by spam but cannot gate a server to students or employees.
  - q: What is the best way to verify students on Discord?
    a: Email domain verification against your institution's domain. It proves the member receives mail at that domain, and unlike ID or student-card checks it requires no manual review and stores no documents.
---

# Discord verification, compared

Anyone with an invite link can join a Discord server. If your server belongs to a university, a company or a course, you want to know who's in it, and you want students, staff or employees to end up in the right channels without a moderator sorting them.

This page compares the tools people use for that: **EmailVerify**, **Guild.xyz**, **Discord Student Hubs**, and doing it by hand. Further down are the other verification methods (captcha, phone, SSO) and what each one proves.

!!! note "Written by the developer of EmailVerify"
    So read the framing with that in mind. Facts about other products come from their own websites and documentation as of October 2026, with links in the sources below. If something is out of date, write to [contact@wksolutions.de](mailto:contact@wksolutions.de) and we'll fix it.

---

## The problem

A Discord invite doesn't know who is using it. A course server ends up with people from other cohorts, a society server with alumni and strangers, a company server with someone's ex-contractor. Discord itself can't tell them apart: a verified Discord email or phone number says nothing about whether someone studies or works with you.

What the admin actually wants is simple to state: let in people with an address at our domain, give them the matching role, keep everyone else out.

## What people use today

### Checking members by hand { #by-hand }

The default. Moderators ask newcomers for a screenshot of a student card, an email address by DM, or an introduction post, then hand out roles.

It works for a few people a week. At the start of term it doesn't: someone has to be online, judgments differ between moderators, a screenshot can be edited, and the moderators end up holding photos of ID cards they never wanted.

### Guild.xyz { #guild-xyz }

[Guild.xyz](https://guild.xyz) is a community-management platform built around requirements: hold a token, follow an account on X, be in a Discord server, and 47 kinds in all. When a member meets a role's requirements, Guild's bot gives them the matching Discord role. One requirement type is **"Verify an email with domain"**.

How that looks for an email gate, from Guild's own documentation:

- Members sign in on guild.xyz with a wallet, an email or a social account, which creates a Guild account. They connect their Discord account and their email address there, confirm the email, join the guild and claim the role.
- The domain must match the address exactly: `yourcompany.com` does not match `mail.yourcompany.com`, so each domain needs its own requirement.
- Different roles for different domains work as separate Guild roles, each with its own Discord-role reward.
- Guild's free plan includes the email requirement and an email allowlist; paid plans start at $29 a month.

If your community already runs on Guild, or you need wallet and token requirements next to email, Guild is the broader tool.

### Discord Student Hubs { #discord-student-hubs }

[Student Hubs](https://support.discord.com/hc/en-us/articles/4406046651927-Discord-Student-Hubs-FAQ) are Discord's own directories for schools. A student verifies their school email address inside Discord, joins their school's hub, and finds classmates and student-run servers there. They're free and still running: Discord's patch notes from September and October 2026 list Student Hub fixes.

What they are not is a gate for your server:

- The verification gets a student into the **hub**. Discord's guidelines say the servers listed in a hub "may include non-students", and people can be invited to those servers without joining the hub.
- Hubs exist only for schools Discord has opened one for, in 13 countries so far, with a waitlist elsewhere. There are none for companies, clubs or courses.
- They don't assign roles in your server, so they can't separate students from staff there.

### Other email verification bots

There are other Discord bots that send a code by email, and a number of campus-specific ones a student wrote for one university. The checklist [further down](#if-youve-decided-on-email-verification) applies to all of them, this one included.

## What EmailVerify does differently

EmailVerify does one job, inside Discord: it checks that a member receives mail at an address you accept, then gives them the roles for that address.

<ul class="ev-checks">
<li><strong>No detour, no second account.</strong> The member clicks a button, types their address into a popup, and enters the 6-digit code from the email. That's the whole flow.</li>
<li><strong>It gates your own server.</strong> Roles land in your server, so your channel permissions decide who sees what. Turn on the unverified role and newcomers see nothing until they verify.</li>
<li><strong>Rules with wildcards.</strong> <code>@*.edu</code> or <code>@*.cam.ac.uk</code> covers every matching domain in one rule, and a blacklist such as <code>*@tempmail.*</code> keeps throwaway addresses out.</li>
<li><strong>Roles by domain.</strong> <code>@students.uni.edu</code> gets Student, <code>@staff.uni.edu</code> gets Staff, everyone gets your default Verified role.</li>
<li><strong>One address, one account.</strong> If a second Discord account verifies with an address that's already in use on your server, the first one loses its roles.</li>
<li><strong>Any organisation.</strong> Universities, companies, clubs, courses, in any country. For members without a shared domain, Pro adds a CSV allowlist of exact addresses.</li>
<li><strong>Built to be installed by an institution.</strong> Verified addresses are stored as hashes, members can delete their own record, and the source is open under AGPL-3.0 with a Docker image for self-hosting.</li>
</ul>

## Side by side

<div class="ev-vs-wrap">
<table class="ev-vs" role="table">
<caption class="ev-sr">EmailVerify compared with Guild.xyz and Discord Student Hubs, as of October 2026</caption>
<thead role="rowgroup">
<tr role="row">
<th scope="col" role="columnheader"><span class="ev-sr">Criterion</span></th>
<th scope="col" role="columnheader" class="ev-vs-us"><span class="ev-vs-brand"><img class="ev-vs-logo" src="/assets/favicon-48x48.png" alt="EmailVerify" width="28" height="28"><span aria-hidden="true">EmailVerify</span></span></th>
<th scope="col" role="columnheader"><a class="ev-vs-brand" href="#guild-xyz"><img class="ev-vs-logo ev-vs-logo--round" src="/assets/competitors/guildxyz.png" alt="Guild.xyz" width="28" height="28"><span aria-hidden="true">Guild.xyz</span></a></th>
<th scope="col" role="columnheader"><a class="ev-vs-brand" href="#discord-student-hubs"><img class="ev-vs-logo" src="/assets/competitors/discord.svg" alt="Discord Student Hubs" width="28" height="28"><span aria-hidden="true">Discord Student Hubs</span></a></th>
</tr>
</thead>
<tbody role="rowgroup">
<tr role="row">
<th scope="row" role="rowheader">Gates your own server's roles and channels</th>
<td role="cell" class="ev-vs-us" data-label="EmailVerify"><span class="ev-vs-val"><span class="ev-vs-mark is-yes" aria-hidden="true">✓</span><span class="ev-sr">Yes</span></span></td>
<td role="cell" data-label="Guild.xyz"><span class="ev-vs-val"><span class="ev-vs-mark is-yes" aria-hidden="true">✓</span><span class="ev-sr">Yes:</span> through Guild's bot</span></td>
<td role="cell" data-label="Student Hubs"><span class="ev-vs-val"><span class="ev-vs-mark is-no" aria-hidden="true">✕</span><span class="ev-sr">No:</span> verifies entry to the school's hub; listed servers may include non-students</span></td>
</tr>
<tr role="row">
<th scope="row" role="rowheader">Members verify inside Discord, without another account</th>
<td role="cell" class="ev-vs-us" data-label="EmailVerify"><span class="ev-vs-val"><span class="ev-vs-mark is-yes" aria-hidden="true">✓</span><span class="ev-sr">Yes:</span> button, popup, 6-digit code</span></td>
<td role="cell" data-label="Guild.xyz"><span class="ev-vs-val"><span class="ev-vs-mark is-no" aria-hidden="true">✕</span><span class="ev-sr">No:</span> Guild account on guild.xyz, with Discord and email connected</span></td>
<td role="cell" data-label="Student Hubs"><span class="ev-vs-val"><span class="ev-vs-mark is-yes" aria-hidden="true">✓</span><span class="ev-sr">Yes</span></span></td>
</tr>
<tr role="row">
<th scope="row" role="rowheader">Works for companies, clubs and courses, not only schools</th>
<td role="cell" class="ev-vs-us" data-label="EmailVerify"><span class="ev-vs-val"><span class="ev-vs-mark is-yes" aria-hidden="true">✓</span><span class="ev-sr">Yes</span></span></td>
<td role="cell" data-label="Guild.xyz"><span class="ev-vs-val"><span class="ev-vs-mark is-yes" aria-hidden="true">✓</span><span class="ev-sr">Yes</span></span></td>
<td role="cell" data-label="Student Hubs"><span class="ev-vs-val"><span class="ev-vs-mark is-no" aria-hidden="true">✕</span><span class="ev-sr">No:</span> schools only, in 13 countries</span></td>
</tr>
<tr role="row">
<th scope="row" role="rowheader">Wildcard domains like <code>@*.edu</code></th>
<td role="cell" class="ev-vs-us" data-label="EmailVerify"><span class="ev-vs-val"><span class="ev-vs-mark is-yes" aria-hidden="true">✓</span><span class="ev-sr">Yes</span></span></td>
<td role="cell" data-label="Guild.xyz"><span class="ev-vs-val"><span class="ev-vs-mark is-no" aria-hidden="true">✕</span><span class="ev-sr">No:</span> exact domain match, one requirement per domain</span></td>
<td role="cell" data-label="Student Hubs"><span class="ev-vs-val"><span class="ev-vs-mark is-no" aria-hidden="true">✕</span><span class="ev-sr">No:</span> the school's own domain</span></td>
</tr>
<tr role="row">
<th scope="row" role="rowheader">A different role per domain, e.g. students and staff</th>
<td role="cell" class="ev-vs-us" data-label="EmailVerify"><span class="ev-vs-val"><span class="ev-vs-mark is-yes" aria-hidden="true">✓</span><span class="ev-sr">Yes</span></span></td>
<td role="cell" data-label="Guild.xyz"><span class="ev-vs-val"><span class="ev-vs-mark is-yes" aria-hidden="true">✓</span><span class="ev-sr">Yes:</span> one Guild role per domain</span></td>
<td role="cell" data-label="Student Hubs"><span class="ev-vs-val"><span class="ev-vs-mark is-no" aria-hidden="true">✕</span><span class="ev-sr">No</span></span></td>
</tr>
<tr role="row">
<th scope="row" role="rowheader">Allowlist of exact addresses</th>
<td role="cell" class="ev-vs-us" data-label="EmailVerify"><span class="ev-vs-val"><span class="ev-vs-mark is-part" aria-hidden="true">◐</span><span class="ev-sr">Paid:</span> Pro plan or one-time CSV unlock</span></td>
<td role="cell" data-label="Guild.xyz"><span class="ev-vs-val"><span class="ev-vs-mark is-yes" aria-hidden="true">✓</span><span class="ev-sr">Yes:</span> on the free plan</span></td>
<td role="cell" data-label="Student Hubs"><span class="ev-vs-val"><span class="ev-vs-mark is-no" aria-hidden="true">✕</span><span class="ev-sr">No</span></span></td>
</tr>
<tr role="row">
<th scope="row" role="rowheader">Price</th>
<td role="cell" class="ev-vs-us" data-label="EmailVerify"><span class="ev-vs-val">Free for 25 emails a month per server, then from €4.99/month</span></td>
<td role="cell" data-label="Guild.xyz"><span class="ev-vs-val">Free plan; paid plans from $29/month</span></td>
<td role="cell" data-label="Student Hubs"><span class="ev-vs-val">Free</span></td>
</tr>
</tbody>
</table>
</div>

<p class="ev-vs-note">Based on each vendor's public website and documentation as of October 2026. Trademarks and logos belong to their owners. Something out of date? Write to <a href="mailto:contact@wksolutions.de">contact@wksolutions.de</a> and we'll correct it.</p>

??? info "Sources for the table"
    - Guild.xyz: [email requirement](https://new.guild.xyz/docs/requirements/email), [allowlist requirement](https://new.guild.xyz/docs/requirements/allowlist), [how Guild works](https://new.guild.xyz/docs/how-guild-works), [joining a guild](https://new.guild.xyz/docs/members), [Discord role rewards](https://new.guild.xyz/docs/rewards/discord), [plans](https://new.guild.xyz/docs/plans) and [pricing](https://guild.xyz/pricing).
    - Discord Student Hubs: [Student Hubs FAQ](https://support.discord.com/hc/en-us/articles/4406046651927-Discord-Student-Hubs-FAQ), [Student Hubs guidelines](https://support.discord.com/hc/en-us/articles/4407546283031-Discord-Student-Hubs-Guidelines), and the Student Hub fixes in Discord's patch notes of [8 September 2026](https://discord.com/blog/discord-patch-notes-september-8-2026) and [6 October 2026](https://discord.com/blog/discord-patch-notes-october-6-2026).
    - EmailVerify: [pricing](premium.md), [commands](commands.md) and the [source code](https://github.com/lkaesberg/EmailVerify).

<div class="ev-cta" markdown>
[:fontawesome-brands-discord: Add EmailVerify to your server](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268553344&scope=bot%20applications.commands){ .md-button .md-button--primary }
[Quick start guide](setup.md){ .md-button }
[See pricing](premium.md){ .md-button }
</div>

---

## Every verification method, and what it proves

Beyond email, there are half a dozen ways to gate a Discord server, and they are not substitutes for one another. Most arguments about which bot is "best" are really people solving different problems. Pick by the question you need answered.

<div class="ev-compare" markdown>

| Approach | What it actually proves | Good for | Weak point |
|---|---|---|---|
| **Captcha / "click to verify"** | A human, or at least a browser, completed a challenge | Blocking raid scripts and bulk bot joins | Says nothing about *who* the person is |
| **Alt-account detection** | The account doesn't look like a throwaway | Ban evasion, repeat troublemakers | Heuristic; both false positives and misses |
| **Discord's built-in levels** | Account age, verified Discord email, or a phone number | Cheap baseline friction, zero setup | Nothing about the person's real-world affiliation |
| **Phone verification** | Control of a phone number | High-friction anti-abuse | Privacy-hostile; numbers are cheap to rent |
| **Manual vetting** | Whatever your moderators can judge | Small, high-trust communities | Doesn't scale; inconsistent; slow at intake |
| **Email domain verification** | Control of a mailbox at a domain **you** choose | Students, employees, customers, ticket holders | Only as meaningful as who controls the domain |
| **SSO / OAuth** | A live account in your identity provider | Enterprises with Entra ID or Workspace | Heavy setup; needs IT involvement; rare on Discord |

</div>

The row that matters: **captcha and alt-detection answer "is this a real person?", email and SSO answer "is this person one of ours?"** A university server that installs a captcha bot has not restricted itself to students, and never will have.

Many servers want both. They compose fine: run a captcha bot for raid protection *and* email verification for membership.

---

## When email domain verification is the right tool

<ul class="ev-checks">
<li>Your members share a domain: a university, a company, a school, a group of partner organisations.</li>
<li>Or they don't share a domain, but you have a list of their addresses: a course roster, ticket holders, registrants.</li>
<li>You need the gate to mean something to an outsider: "verified student" has to actually mean verified.</li>
<li>You want it to run itself, with no moderator approving joins by hand.</li>
</ul>

## When it isn't

<ul class="ev-checks">
<li><strong>You're fighting raids, not impostors.</strong> A captcha or anti-raid bot is the correct tool, and it's faster.</li>
<li><strong>Your community is public and open.</strong> Any gate costs you members; be sure you want one.</li>
<li><strong>You need live deprovisioning.</strong> Email verification is a check at the door, not a session. If access must revoke the moment someone leaves the organisation, you want SSO with group sync.</li>
<li><strong>You need proof of enrolment, not proof of address.</strong> Most universities let alumni keep their address forever, so a <code>.edu</code> gate lets graduates through. Use a roster allowlist instead.</li>
</ul>

---

## If you've decided on email verification

There are several bots in this category, plus a number of university-specific ones on GitHub that a student built for their own campus. Things worth checking about any of them, this one included:

**How are addresses stored?**
A bot holding a plaintext table of your members' email addresses is a liability for whoever installed it. Ask, and if the answer isn't "hashed", think hard. *(EmailVerify's database stores hashes only, never plain text.)*

**Where does the mail come from, and does it arrive?**
Deliverability is the whole product. A verification bot whose codes land in spam is a broken verification bot, and university filters are brutal. Test before you commit. *(EmailVerify has `/testmail` for exactly this; paid plans route through Zoho ZeptoMail, EU-hosted and transactional-only.)*

**Can you leave?**
Open source means you can self-host if the hosted service disappears or changes terms. *(EmailVerify is AGPL-3.0 with a published Docker image.)*

**Does it handle your actual domain shape?**
Wildcards and subdomains matter more than they sound: `@*.cam.ac.uk` and `@students.uni.edu` versus `@staff.uni.edu` are the normal case, not the exotic one.

**What happens when you outgrow the free tier?**
Every hosted bot pays for email somehow. Find out what the cap is and what exceeding it costs before an intake week finds out for you. *(EmailVerify: 25/month free per server, then credit packs that never expire or a subscription. See [pricing](premium.md).)*

---

## Where EmailVerify sits

It does one thing, email-domain and allowlist verification inside Discord, and it has done it since 2021.

<ul class="ev-checks">
<li><strong>Domain rules with wildcards</strong>, per-domain role mapping, and CSV allowlists for members with no shared domain.</li>
<li><strong>Hashed storage</strong>, member self-deletion, server-wide data wipe, EU mail routing on paid plans.</li>
<li><strong>AGPL-3.0</strong> with a Docker image, so self-hosting is a genuine option rather than a talking point.</li>
<li><strong>Free for most servers</strong>: 25 verifications a month covers roughly 95% of the servers that use it.</li>
<li><strong>Ten languages</strong>, contributed by users.</li>
</ul>

What it deliberately isn't: an anti-raid suite, a moderation bot, a captcha, a token-gating platform or an SSO bridge. If you need those, run something alongside it.

---

## Common questions

??? question "How is EmailVerify different from Guild.xyz?"
    Both can give a Discord role to people with an email address at a domain. With Guild.xyz, members sign in on guild.xyz and connect Discord and their email to a Guild account, and the domain has to match exactly. With EmailVerify, members verify inside Discord with a 6-digit code, and wildcard rules such as `@*.edu` cover every matching domain. Guild.xyz covers much more than email, with 47 requirement types including wallets and tokens, and its free plan includes the email check.

??? question "Do Discord Student Hubs verify members of my server?"
    No. A Student Hub verifies a school email address to let a student into Discord's hub for that school, where students find classmates and student-run servers. Discord notes that servers listed in a hub may include non-students. To control who gets into your own server and which channels they see, you need a verification bot such as EmailVerify.

??? question "What is the difference between a captcha bot and an email verification bot on Discord?"
    A captcha bot proves the member is a human rather than a script. An email verification bot proves the member controls a mailbox at a domain you chose. They answer different questions, and a server that needs to know who someone is gains nothing from a captcha.

??? question "Is Discord's built-in verification level enough?"
    Discord's verification levels apply friction based on account age, a verified email on the Discord account, or a phone number. None of them tell you anything about the person's relationship to your organisation, so they reduce drive-by spam but cannot gate a server to students or employees.

??? question "What is the best way to verify students on Discord?"
    Email domain verification against your institution's domain. It proves the member receives mail at that domain, and unlike ID or student-card checks it requires no manual review and stores no documents.

<div class="ev-cta" markdown>
[:fontawesome-brands-discord: Add EmailVerify to your server](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268553344&scope=bot%20applications.commands){ .md-button .md-button--primary }
[Quick start guide](setup.md){ .md-button }
[See pricing](premium.md){ .md-button }
</div>

---

## Related

- [Universities and schools](use-cases/university.md)
- [Companies and teams](use-cases/company.md)
- [Courses, events and hackathons](use-cases/communities.md)
- [All commands](commands.md)
