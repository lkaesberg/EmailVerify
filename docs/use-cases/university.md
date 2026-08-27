---
title: Discord Email Verification for Universities and Schools
description: Restrict a Discord server to verified students and staff using .edu or your institution's own domain. Separate roles for students and faculty, no student data stored in plaintext, free for most course and society servers.
faq:
  - q: How do I make sure only students can join my university Discord server?
    a: Add an email verification bot and set the allowed domain to your institution's domain, for example @*.edu or @students.uni-example.de. Members must prove they receive mail at that domain before the bot grants them a role, and you deny channel access to anyone without it.
  - q: Can students and staff get different roles automatically?
    a: Yes. Map each domain to its own role with /domainrole. Someone verifying with @staff.university.edu receives the Staff role while @students.university.edu receives Student, and both also receive any default verified role you configured.
  - q: Does this work for universities outside the United States that do not use .edu?
    a: Yes. Any domain works, including multi-level ones such as @uni-goettingen.de or @student.tudelft.nl, and wildcards let you cover every subdomain of an institution at once.
  - q: Is storing student email addresses in a Discord bot GDPR-compliant?
    a: EmailVerify stores addresses only as cryptographic hashes; the plaintext exists just long enough to send the verification code and is never written to disk. Members can delete their own record with /data delete-user and admins can wipe an entire server with /data delete-server.
---

# Discord verification for universities and schools

A university Discord fills up fast, and not everyone who joins belongs there. Course servers get outsiders looking for coursework, society servers get spam accounts, and department servers end up with alumni, applicants and strangers mixed in with actual members — with no way to tell them apart.

Email verification fixes that at the door: a member only gets a role once they've proven they receive mail at your institution's domain.

<div class="ev-cta" markdown>
[:fontawesome-brands-discord: Add to your server](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268504128&scope=bot%20applications.commands){ .md-button .md-button--primary }
[Quick start guide →](../setup.md){ .md-button }
</div>

---

## Who this is for

<ul class="ev-checks">
<li><strong>Course and module servers</strong> — only enrolled students, no lurkers from other cohorts.</li>
<li><strong>Department and faculty servers</strong> — students and staff separated automatically by their address.</li>
<li><strong>Societies, clubs and student unions</strong> — membership limited to the institution.</li>
<li><strong>Applicant and open-day servers</strong> — a fixed allowlist of invited addresses instead of a domain.</li>
<li><strong>Alumni networks</strong> — a CSV of known addresses, since alumni rarely share a live domain.</li>
</ul>

---

## Setting it up for a university

Allowed domains support wildcards, which matters because universities almost never use a single flat domain.

```
/domain add @*.edu
```

Accepts any US university address. For a specific institution, or one outside the `.edu` system:

```
/domain add @uni-goettingen.de
/domain add @*.cam.ac.uk
/domain add @student.tudelft.nl
```

You can add as many as you like — a joint programme across two universities just gets both domains.

### Split students from staff automatically

Most institutions issue students and staff addresses on different subdomains. Map each one to its own role and the sorting happens by itself:

```
/domainrole add domain:@students.university.edu role:@Student
/domainrole add domain:@staff.university.edu    role:@Faculty
/domainrole add domain:@alumni.university.edu   role:@Alumni
```

Members receive the domain-specific role **plus** whatever default role you set with `/role add`. No manual role handing-out, and no admin having to judge whether a screenshot of a student card is real.

### Make verification mandatory

```
/settings auto-unverified enable
/settings auto-verify enable
```

The first gives every new arrival an "Unverified" role — deny that role access to your channels and unverified members simply can't read anything. The second prompts them to verify the moment they join, rather than hoping they find the button.

---

## Semester spikes

Verification traffic at a university is not spread evenly across the year. It's near zero for months and then several hundred people arrive in the first fortnight of term.

The free tier covers 25 verification emails per server per month, which is enough for a small society year-round but not for an intake week. Two ways to handle the spike:

- **[Credit packs](../premium.md)** — one-time purchase, never expire, roll over month to month. A 500-pack bought before September can cover a whole intake and still have credits left in the spring.
- **[Standard subscription](../premium.md)** — unlimited sends, sensible if you run several large servers or verify continuously.

You'll get warnings at 80% and 95% of the free quota with a run-out forecast, so the cap never arrives as a surprise mid-intake.

---

## Deliverability at universities

This deserves its own warning: **university mail filters are the most aggressive you'll encounter.** A verification code from an unfamiliar sender is exactly the shape of thing they quarantine.

Always run `/testmail` against an address at your own institution before you announce the server:

```
/testmail your.name@university.edu
```

If it lands in junk, paid plans route mail through Zoho ZeptoMail — EU-hosted and transactional-only, so no marketing senders share its IP reputation. That difference is usually what gets codes into university inboxes reliably.

If your IT department will do it, asking them to allowlist the sending domain is the most robust fix of all.

---

## Data protection

Student email addresses are personal data, and a Discord bot holding a plaintext list of them is a genuine liability for whoever set it up.

<ul class="ev-checks">
<li><strong>Addresses are stored as cryptographic hashes only.</strong> Plaintext exists just long enough to send the code and is never written to disk.</li>
<li><strong>Members can erase themselves</strong> with <code>/data delete-user</code>, which also removes their verified status.</li>
<li><strong>Admins can wipe the server's whole record</strong> with <code>/data delete-server</code>.</li>
<li><strong>Mail for paying servers stays in the EU</strong> (Zoho ZeptoMail, EU data residency).</li>
<li><strong>The source is auditable</strong> — AGPL-3.0, so your IT department can read exactly what it does, or host it themselves.</li>
</ul>

Full details in the [privacy policy](../legal/datenschutz.md).

!!! info "If your institution needs a formal agreement"
    Departments procuring a tool officially usually need a data processing agreement rather than a click-through. Self-hosting sidesteps the question entirely — the [Docker image](https://github.com/lkaesberg/EmailVerify#-self-hosting) is public and no data ever leaves your infrastructure. For anything else, ask in the [support server](https://discord.com/invite/fEBSHUQXu2).

---

## What this does and doesn't prove

Worth being precise about, because it changes how you should use it.

**It proves** the person controls a mailbox at your institution's domain, right now.

**It does not prove** they are currently enrolled. Most universities let graduates keep their address indefinitely, so a `@*.edu` gate will let alumni through. If current enrolment is what you actually need, use a CSV allowlist of this year's registered students instead of a domain rule — see [courses and events](communities.md) for how that works.

---

## Related

- [Quick start guide](../setup.md) — three steps, with a 60-second video
- [How EmailVerify compares to other verification bots](../compare.md)
- [Companies and teams](company.md) — the same thing for a corporate domain
- [Courses, events and hackathons](communities.md) — fixed allowlists instead of domains

<div class="ev-cta" markdown>
[:fontawesome-brands-discord: Add EmailVerify to your server](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268504128&scope=bot%20applications.commands){ .md-button .md-button--primary }
[See pricing](../premium.md){ .md-button }
</div>
