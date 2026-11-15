# EmailVerify positioning

Internal working document, not part of the website (excluded in `mkdocs.yml` via
`exclude_docs`). Follows April Dunford's *Obviously Awesome*. Competitor facts are
**as of 2026-10-30**; every published claim has a source in section 9.

Product: **EmailVerify Bot** (getemailverified.com), the Discord bot that checks a
member owns an email address at a domain you choose and then gives them roles.
Operator: WKSolutions GbR. Web product only: there is no App Store listing.

---

## 1. Best-fit customers

Admins of Discord servers that belong to a real organisation whose members share an
email domain, or whose members are on a list the admin already has:

- **University course, department and society servers.** Students and staff have
  institutional addresses on different subdomains. The admin wants outsiders kept out
  and students separated from staff without checking anyone by hand. Intake comes in
  bursts at the start of term.
- **Company internal and partner servers.** "Has a working mailbox at our domain" is
  the access rule they already think in.
- **Paid courses, events and hackathons.** No shared domain, but a roster of buyer or
  registrant addresses (CSV allowlist, Pro).

Why they love it (from the site and the bot's own data): members verify inside Discord
in a few clicks, the admin sets the rules once with `/setup`, and about 95% of servers
stay inside the free 25 emails a month. Servers at Google, Harvard, Microsoft, Stanford
and 25 more organisations verify with it (docs/index.md, from the 2026-09-24 database).

## 2. Competitive alternatives

What these admins do if EmailVerify didn't exist:

| Alternative | What it is | Who picks it |
|---|---|---|
| **Doing it by hand (status quo)** | Moderators ask for a student-card screenshot, an email in DMs or an intro post, then hand out roles manually. Or no gate at all: anyone with the invite link gets in. | Small servers, or servers that haven't hit a problem yet. This is the most common real competitor. |
| **Guild.xyz** | A community-management and token-gating platform. Members sign in on guild.xyz, connect wallets and social accounts, and Guild's bot gives Discord roles to those who meet a role's requirements. One of its 47 requirement types is "Verify an email with domain". | Web3 communities first; any community already running on Guild. |
| **Discord Student Hubs** | Discord's own directory per school. Students verify a school email to enter their school's hub, then find classmates and student-run servers. | Students looking for servers; student server owners who want to be found. |
| **Other email verification bots** | Other Discord bots that send a code by email (several on top.gg), and campus-specific bots a student wrote for one university (GitHub). | Admins who searched "email verification bot" and picked another one. |
| **Captcha / anti-raid bots, Discord's verification levels** | Prove a human, or a phone/verified Discord email, not affiliation. | Servers fighting raids. Complementary, not a substitute; covered on /compare. |
| **SSO bridges (Entra ID, Google Workspace)** | Live account in an identity provider. | Enterprises with IT support. Rare on Discord. |

The owner's competitor list for the table is **Guild.xyz** and **Discord Student Hubs**.
The status quo and other email bots are covered in the copy, not as table columns.

**Is Discord Student Hubs still running?** Yes. It has not been discontinued. Discord's
FAQ is still live, and Discord's patch notes of 2026-09-08 and 2026-10-06 list Student Hub
bug fixes (sources S4, S5).

## 3. Unique attributes

Only capabilities that the named alternatives lack or limit, and that are true in the code:

1. **The whole check happens inside Discord, with no other account.** Button or `/verify`,
   a popup for the address, a 6-digit code by email (valid 15 minutes, resend after 60 s),
   role assigned (`src/EmailBot.js`). Guild needs a Guild account on guild.xyz with Discord
   and the email connected (S2, S3). Student Hubs verify inside Discord too, but only for
   the hub (below).
2. **It gates your own server.** Roles land in your server and your channel permissions do
   the rest. Student Hubs verify entry to Discord's school hub; the servers listed there
   "may include non-students" (S6), and people can be invited to listed servers without
   joining the hub (S4).
3. **Wildcard domain rules.** `@*.edu`, `@*.cam.ac.uk`, any number of domains, plus a
   blacklist with patterns such as `*@tempmail.*` (`src/utils/wildcardMatch.js`,
   `/domain`, `/blacklist`). Guild's email requirement matches one domain exactly;
   `yourcompany.com` does not match `mail.yourcompany.com` (S1). Student Hubs only take
   the school's own addresses (S4).
4. **Roles by domain in one rule each.** `/domainrole add @staff.uni.edu @Staff` plus
   default roles for everyone (`src/utils/resolveVerificationRoles.js`). Guild can do it
   with one Guild role per domain, each with its own Discord-role reward (S1, S3). Student
   Hubs give no roles in your server.
5. **Works for any organisation.** Companies, clubs, courses, any country. Student Hubs
   exist only for schools Discord has opened a hub for, in 13 countries (S4).
6. **One address, one account per server.** If a second Discord account verifies with an
   address already in use, the first account loses its roles and gets a DM
   (`unverifyPreviousHolder`). Not documented for Guild or Student Hubs, so it is not a
   table row.
7. **Privacy and exit.** Verified addresses are stored as hashes, members can delete their
   own record (`/data delete-user`), admins can wipe the server (`/data delete-server`),
   and the source is AGPL-3.0 with a Docker image for self-hosting. Not compared in the
   table because the competitors' equivalents are not documented (no "—" columns).

Where the alternatives are ahead (keep the copy honest):

- **Guild's free plan includes the email-domain and email-allowlist requirements** (S7),
  and its docs state no cap on them. EmailVerify's free tier is 25 emails a month per server, and its CSV
  allowlist needs Pro (€9.99/month) or the €39.99 one-time CSV unlock.
- Guild combines email with wallets, X, GitHub, Telegram and more, and re-checks access in
  the background (S2).
- Student Hubs are free, built into Discord, and help students *find* servers. EmailVerify
  does nothing for discovery.

### "What do we do better?" (the owner's open question)

**EmailVerify gates your own Discord server by email domain, and the member never leaves
Discord.** Against Guild.xyz: no second account and no website detour, and wildcard rules
like `@*.edu` instead of one exact domain per requirement. Against Student Hubs: it controls
who gets into *your* server and which channels they see, for any domain (schools,
companies, courses), not only schools Discord has added. Against doing it by hand: it runs
itself and nobody holds photos of student cards.

## 4. Value

Attribute → benefit → proof, grouped into three themes.

**A. Only the right people get in.**
- Code sent to the address → the member proves they receive mail there, not that they
  can type a plausible address → 6-digit code flow, `CODE_TTL_MS = 15 min`.
- Wildcards and blacklist → one rule covers a whole sector or every subdomain; throwaway
  domains stay out → `@*.edu`, `*@tempmail.*` in README.
- One address per account → a shared address can't unlock several accounts →
  `unverifyPreviousHolder`.
- Allowlist (Pro) → rosters without a common domain → `/emaillist upload`, API.

**B. It runs itself, inside Discord.**
- No external site or account → nobody drops off on a sign-in page → verification is a
  Discord modal.
- Roles by domain → students and staff end up in the right channels without a moderator →
  `/domainrole`.
- Unverified role + prompt on join → newcomers see nothing until they verify →
  `/settings auto-unverified`, `/settings auto-verify`.
- `/setup` wizard and `/testmail` → set up in minutes, delivery checked before launch.

**C. Safe to install for an institution.**
- Verified addresses kept as hashes, self-deletion, server wipe → less personal data to
  worry about → `/data`, privacy policy.
- Open source (AGPL-3.0) with Docker image → IT can audit it or host it themselves →
  GitHub.
- Free for about 95% of servers; paid mail via Zoho ZeptoMail (EU) → no budget request to
  start → docs/premium.md.

## 5. Target market characteristics

Servers that care most about that value:

- The server maps onto an organisation with an email domain (or a roster), and "verified
  member" has to mean something to outsiders.
- Members are not crypto-native: asking for a wallet or a separate account costs sign-ups.
- Moderators don't want to vet people by hand, and intake comes in waves (term start,
  onboarding cohorts, event days).
- Someone is accountable for members' personal data (a university, a company, an event
  organiser).

## 6. Market category

**Category: "email verification bot for Discord"**, a subcategory of Discord verification
bots. **Style: big fish in a small pond.**

Why: in the broad "Discord verification bot" frame, buyers compare against captcha and
anti-raid bots and we look like a bot without raid protection. In Guild's frame
("community management / token gating") we look like a tool with one requirement type.
Inside the email-verification subcategory the value is obvious (it proves affiliation, which
captchas can't), the buyer already searches for it ("discord email verification bot",
"verify students discord"), and EmailVerify leads it: running since 2021, the homepage
laurel already says "#1 Email Verification on Discord". Keep the SEO terms that go with it
("email verification", "Discord", "@*.edu", "domain").

## 7. Relevant trend

None claimed. Nothing verifiable that changes the buying decision right now.

## 8. Positioning statement and UVP

**Positioning statement.** For admins of Discord servers that belong to a university,
a company or a course, EmailVerify is the email verification bot that lets in only people
who prove they own an address at your domain, and gives them the roles for that domain.
Unlike Guild.xyz, members never leave Discord or create another account, and one wildcard
rule such as `@*.edu` covers a whole sector. Unlike Discord Student Hubs, it controls your
own server and works for any domain, not only schools Discord has added.

**UVP, English**

- Headline: **Don't let just anyone into your Discord server.**
- Subheadline: Members prove they own the email address they claim, and the bot gives
  them the role for their email domain, so `@students.uni.edu` sees the student channels
  and `@staff.uni.edu` the staff ones. It all happens inside Discord, with a 6-digit code.

**UVP, German**

- Headline: **Lass nicht einfach jeden auf deinen Discord-Server.**
- Subheadline: Mitglieder bestätigen, dass ihnen die angegebene E-Mail-Adresse gehört,
  und der Bot gibt ihnen die Rolle für ihre E-Mail-Domain: `@students.uni.edu` sieht die
  Kanäle für Studierende, `@staff.uni.edu` die für Mitarbeitende. Alles direkt in Discord,
  mit einem 6-stelligen Code.

The website is English-only (MkDocs, no i18n plugin; `language/` is the bot's own
translations), so only the English UVP ships on the site. The H1 stays "EmailVerify Bot"
(it must match `site_name` and `extra.brand` for Google's site name); the UVP is the bold
lead under it.

## 9. Competitor table data (as of 2026-10-30)

Cells as published on `/compare/` (full) and the homepage (rows marked ★).

| Criterion | EmailVerify | Guild.xyz | Discord Student Hubs |
|---|---|---|---|
| ★ Gates your own server's roles and channels | Yes [E1] | Yes, through Guild's bot [S3] | No: verifies entry to the hub; listed servers may include non-students [S6, S4] |
| ★ Members verify inside Discord, no other account | Yes: button, popup, 6-digit code [E2] | No: Guild account on guild.xyz, Discord and email connected there [S2, S3] | Yes [S4] |
| Works for companies, clubs and courses, not only schools | Yes [E3] | Yes [S1] | No: schools only, in 13 countries [S4] |
| ★ Wildcard domains (`@*.edu`, every subdomain) | Yes [E3] | No: exact domain match [S1] | No: the school's own domain [S4] |
| ★ A different role per domain | Yes [E4] | Yes, one Guild role per domain [S1, S3] | No [S4] |
| Allowlist of exact addresses | Pro plan or one-time CSV unlock [E5] | Yes, free plan [S8, S7] | No [S4] |
| ★ Price | Free for 25 emails/month per server, then from €4.99/month [E5] | Free plan; paid plans from $29/month [S7, S9] | Free [S4] |

Sources:

- **E1** README "Domain-Specific Roles"; `src/utils/resolveVerificationRoles.js`.
- **E2** README "How it works"; `src/EmailBot.js` (`CODE_TTL_MS`, `RESEND_COOLDOWN_MS`).
- **E3** README `/domain` (wildcards), `/blacklist`; `src/utils/wildcardMatch.js`.
- **E4** README `/domainrole`.
- **E5** docs/premium.md (Standard €4.99, Pro €9.99, CSV unlock €39.99, free 25/month).
- **S1** Guild docs, Email requirement: <https://new.guild.xyz/docs/requirements/email>
  (redirect target of docs.guild.xyz/guild/how-to-setup-requirements/email). "The domain
  must match the address exactly."
- **S2** Guild docs, How Guild works / Joining a guild:
  <https://new.guild.xyz/docs/how-guild-works>, <https://new.guild.xyz/docs/members>
- **S3** Guild docs, Discord roles reward: <https://new.guild.xyz/docs/rewards/discord>
- **S4** Discord Student Hubs FAQ:
  <https://support.discord.com/hc/en-us/articles/4406046651927-Discord-Student-Hubs-FAQ>
- **S5** Discord patch notes 2026-09-08 and 2026-10-06 (Student Hub fixes):
  <https://discord.com/blog/discord-patch-notes-september-8-2026>,
  <https://discord.com/blog/discord-patch-notes-october-6-2026>
- **S6** Discord Student Hubs Guidelines ("Servers in a Hub are student-run but may include
  non-students."):
  <https://support.discord.com/hc/en-us/articles/4407546283031-Discord-Student-Hubs-Guidelines>
- **S7** Guild docs, Plans (Free; Starter $29, Pro $99, Growth $399 per month; only custom
  API and form requirements need a paid plan): <https://new.guild.xyz/docs/plans>
- **S8** Guild docs, Allowlist requirement: <https://new.guild.xyz/docs/requirements/allowlist>
- **S9** Guild pricing page: <https://guild.xyz/pricing>
- Guild's own description ("Automate roles, token-gate access"; 47 requirement types,
  14 of them onchain): <https://guild.xyz> meta description,
  <https://new.guild.xyz/docs/requirements>

Legal notes (§6 UWG / Directive 2006/114/EC): every competitor cell is a checkable fact
from the vendor's own page, no adjectives about competitors, prices only with the "as of"
note. Re-check the cells before relying on them after 2027-01.

## 10. App Store version

Not applicable: EmailVerify has no App Store listing (no fastlane metadata), so brief §5
was skipped. For bot listings that should not name other products (Discord App Directory,
top.gg, discordbotlist.com), use this generic version:

**Why EmailVerify instead of …**

| | EmailVerify | Checking members by hand | Verifying on an outside website | Student directories |
|---|---|---|---|---|
| Proves the member receives mail at the address | Yes, 6-digit code | No, screenshots or DMs | Yes | Yes |
| Members stay inside Discord, no other account | Yes | Yes | No | Yes |
| Gates your own server by domain | Yes | By hand | Depends on the service | No, the directory only |
| Wildcards like `@*.edu` | Yes | n/a | Depends on the service | No |
| Roles per domain, automatically | Yes | No, by hand | Depends on the service | No |
| Works for companies and courses | Yes | Yes | Yes | No, schools only |

Short listing copy: "Don't let just anyone into your Discord server. Members prove they own
the email address they claim and get the role for their domain, without leaving Discord.
Wildcards like @*.edu, separate roles for students and staff, free for 25 verifications a
month."

## Follow-ups (not done in this pass)

- **/compare meta description.** Kept unchanged so this edit merges cleanly with
  `origin/main` (which retitled the page). After merging, consider: "EmailVerify compared
  with Guild.xyz, Discord Student Hubs and checking members by hand, plus captcha bots,
  phone verification and SSO. What each one proves about a Discord member."
- **Storage claim on the homepage FAQ and use-case pages** ("never written to disk",
  "a database compromise cannot reveal your members' addresses"). The plaintext address
  is stored in `pending_verifications.logEmail` (SQLite) until the code is used or expires
  (15 min, swept every 30 min), and verified addresses are unsalted MD5 hashes, which can
  be matched by guessing likely addresses. The new copy only says "stored as hashes";
  the older wording should be softened.
