---
title: Discord Verification Methods Compared
description: Captcha bots, alt-account detection, phone verification, manual vetting, SSO and email domain verification compared. What each one actually proves about a Discord member, and which problem each one solves.
faq:
  - q: What is the difference between a captcha bot and an email verification bot on Discord?
    a: A captcha bot proves the member is a human rather than a script. An email verification bot proves the member controls a mailbox at a domain you chose. They answer different questions, and a server that needs to know who someone is gains nothing from a captcha.
  - q: Is Discord's built-in verification level enough?
    a: Discord's verification levels apply friction based on account age, a verified email on the Discord account, or a phone number. None of them tell you anything about the person's relationship to your organisation, so they reduce drive-by spam but cannot gate a server to students or employees.
  - q: What is the best way to verify students on Discord?
    a: Email domain verification against your institution's domain. It is the only widely available method that proves the member receives mail at that domain, and unlike ID or student-card checks it requires no manual review and stores no documents.
---

# Which verification method do you actually need?

There are half a dozen ways to gate a Discord server and they are not substitutes for one another. Most arguments about which bot is "best" are really people solving different problems.

Pick by the question you need answered.

!!! note "Written by the developer of EmailVerify"
    So take the framing with the appropriate amount of salt. The category descriptions below are meant to be accurate whichever tool you end up choosing — including when that isn't this one. Feature details of other bots change often; check them yourself before deciding.

---

## The six approaches

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

Many servers want both. They compose fine — run a captcha bot for raid protection *and* email verification for membership.

---

## When email domain verification is the right tool

<ul class="ev-checks">
<li>Your members share a domain — a university, a company, a school, a group of partner organisations.</li>
<li>Or they don't share a domain, but you have a list of their addresses: a course roster, ticket holders, registrants.</li>
<li>You need the gate to mean something to an outsider — "verified student" has to actually mean verified.</li>
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
A bot holding a plaintext table of your members' email addresses is a liability for whoever installed it. Ask, and if the answer isn't "hashed", think hard. *(EmailVerify stores hashes only; plaintext exists just long enough to send the code.)*

**Where does the mail come from, and does it arrive?**
Deliverability is the whole product. A verification bot whose codes land in spam is a broken verification bot, and university filters are brutal. Test before you commit — *(EmailVerify has `/testmail` for exactly this; paid plans route through Zoho ZeptoMail, EU-hosted and transactional-only)*.

**Can you leave?**
Open source means you can self-host if the hosted service disappears or changes terms. *(EmailVerify is AGPL-3.0 with a published Docker image.)*

**Does it handle your actual domain shape?**
Wildcards and subdomains matter more than they sound: `@*.cam.ac.uk` and `@students.uni.edu` versus `@staff.uni.edu` are the normal case, not the exotic one.

**What happens when you outgrow the free tier?**
Every hosted bot pays for email somehow. Find out what the cap is and what exceeding it costs before an intake week finds out for you. *(EmailVerify: 25/month free per server, then credit packs that never expire or a subscription — [pricing](premium.md).)*

---

## Where EmailVerify sits

Honest summary: it does one thing — email-domain and allowlist verification — and it has done it since 2021.

<ul class="ev-checks">
<li><strong>Domain rules with wildcards</strong>, per-domain role mapping, and CSV allowlists for members with no shared domain.</li>
<li><strong>Hashed storage</strong>, member self-deletion, server-wide data wipe, EU mail routing on paid plans.</li>
<li><strong>AGPL-3.0</strong> with a Docker image, so self-hosting is a genuine option rather than a talking point.</li>
<li><strong>Free for most servers</strong> — 25 verifications a month covers roughly 95% of the servers that use it.</li>
<li><strong>Ten languages</strong>, contributed by users.</li>
</ul>

What it deliberately isn't: an anti-raid suite, a moderation bot, a captcha, or an SSO bridge. If you need those, run something alongside it.

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
