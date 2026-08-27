---
title: Discord Verification for Paid Courses, Events and Hackathons
description: Let only registered attendees, paying students or ticket holders into a Discord server. Upload a CSV allowlist of exact email addresses — no shared domain needed — and give everyone on the list a role automatically.
faq:
  - q: How do I let only paying customers into my Discord server?
    a: Export the email addresses of your paying customers from your course or checkout platform, upload the CSV to the bot with /emaillist upload, and only those exact addresses can verify. Everyone else is turned away regardless of their email domain.
  - q: Can I gate a hackathon Discord to registered participants?
    a: Yes. Export the registrant list from Devpost, Luma, Eventbrite or your own form as a CSV of email addresses and upload it. Participants verify with the address they signed up with and receive the participant role automatically.
  - q: What happens if someone is not on the allowlist?
    a: Verification is refused and no role is granted. You can re-upload an updated CSV at any time; duplicate entries are skipped automatically, so adding late registrations just means uploading the new list.
  - q: Are the uploaded email addresses stored in plaintext?
    a: No. The allowlist is hashed with the same scheme as verified addresses. Once uploaded you cannot read the individual entries back, only the total count, so the list cannot leak from the bot's database.
---

# Verification for courses, events and hackathons

Domain rules work when everyone shares an employer or an institution. They're useless when your members have nothing in common except that they signed up — a paid course, a conference, a hackathon, a private community. Those people are on Gmail, Outlook and two hundred other providers.

For that, you need an **allowlist**: a list of the exact addresses that are allowed in, and nobody else.

<div class="ev-cta" markdown>
[:fontawesome-brands-discord: Add to your server](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268504128&scope=bot%20applications.commands){ .md-button .md-button--primary }
[See pricing →](../premium.md){ .md-button }
</div>

---

## Who this is for

<ul class="ev-checks">
<li><strong>Paid courses and cohorts</strong> — only students who actually bought the course get in.</li>
<li><strong>Hackathons</strong> — registered participants only, matched against the sign-up export.</li>
<li><strong>Conferences and meetups</strong> — ticket holders get the attendee role, speakers get a speaker role.</li>
<li><strong>Paid membership communities</strong> — the Discord matches your subscriber list rather than drifting from it.</li>
<li><strong>Beta programmes and early access</strong> — a curated list of testers.</li>
<li><strong>Alumni networks</strong> — former members, who no longer share a live domain.</li>
</ul>

---

## How the allowlist works

<div class="ev-steps" markdown>

<div class="ev-step" markdown>
**Export your list.**
A CSV of email addresses out of Teachable, Podia, Kajabi, Gumroad, Stripe, Devpost, Luma, Eventbrite, Google Forms — whatever you sell or register through.
</div>

<div class="ev-step" markdown>
**Upload it with `/emaillist upload`.**
Attach the CSV to the command. Only those exact addresses can verify from then on, whatever domain they're on.
</div>

<div class="ev-step" markdown>
**Members verify normally.**
Button, address, 6-digit code, role. Anyone not on the list is refused, and you don't have to check anything by hand.
</div>

</div>

Re-upload whenever the list changes — late registrations, a second cohort, a new ticket batch. **Duplicates are skipped automatically**, so it's safe to upload the full list again rather than working out the delta.

`/emaillist clear` empties the list and returns the server to whatever domain rules you have configured.

!!! info "The list is hashed, and that has a consequence"
    Uploaded addresses are stored with the same hashing scheme as verified ones, so the bot's database cannot leak your customer list. The trade-off is that **you can't read the entries back** — `/status` shows only the count. To audit what's in there, re-upload the CSV you believe is current; the duplicate-skipping tells you whether it matched.

---

## Combining an allowlist with domains

The two aren't exclusive. A conference with staff and attendees:

```
/emaillist upload            (ticket holders — any provider)
/domain add @conference.org  (organisers, on the org domain)
/domainrole add domain:@conference.org role:@Staff
```

Ticket holders get the default verified role; anyone on the organiser domain also picks up the Staff role.

---

## A hackathon, end to end

Hackathons are the sharpest fit for this, because the registration list already exists and the Discord goes live days before the event.

```
/role add @Participant
/emaillist upload             ← the Devpost / Luma registrant export
/settings auto-unverified enable
/settings auto-verify enable
/button #verify "Verify your registration"
```

New arrivals are prompted the moment they join, verify with the address they registered with, and land in the participant role. Sponsors and mentors get their own roles via a domain rule or a second, separate event server.

**Plan for the spike.** A 300-person hackathon is 300 verification emails inside about 48 hours, against a free tier of 25 per month. Buy a [credit pack](../premium.md) before the event — credits never expire, so whatever's left over covers the next one.

---

## Paid communities: keeping Discord in sync with who's actually paying

The failure mode of a paid Discord isn't people sneaking in. It's **churned members who never left the server** — a year later, a third of your "members" stopped paying months ago.

An allowlist doesn't solve that by itself, because verification happens once. What it gives you is a way to re-baseline: upload the current subscriber list, and everyone who verifies from then on is genuinely current. Combined with `/export logs` (Pro) you can diff who holds the role against who's paying and prune the difference.

If you want this to happen continuously rather than manually, that's worth asking about in the [support server](https://discord.com/invite/fEBSHUQXu2) — it's a frequently requested feature and demand shapes what gets built.

---

## What you need

The CSV allowlist is part of the **Pro** plan, or available as a **one-time CSV unlock** if you'd rather not subscribe — that grants the CSV features to one server permanently, with no recurring billing. Verification emails still come from your free quota or credits.

[Full pricing and plans →](../premium.md){ .md-button .md-button--primary }

---

## Related

- [Quick start guide](../setup.md) — three steps, with a 60-second video
- [How EmailVerify compares to other verification bots](../compare.md)
- [Universities and schools](university.md) — domain rules for `.edu`
- [Companies and teams](company.md) — domain rules for a corporate mailbox

<div class="ev-cta" markdown>
[:fontawesome-brands-discord: Add EmailVerify to your server](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268504128&scope=bot%20applications.commands){ .md-button .md-button--primary }
[Support server](https://discord.com/invite/fEBSHUQXu2){ .md-button }
</div>
