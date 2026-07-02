<meta name="description" content="EmailVerify pricing — free 25 emails/month plus optional subscriptions and one-time credit packs through Discord's native subscription system.">
<meta name="keywords" content="EmailVerify Discord Bot Premium Pricing Subscription Standard Pro CSV Credits ZeptoMail">

# Premium plans

Most servers stay on the free tier forever. About 95% of servers using EmailVerify send 25 or fewer verification emails per month, which is exactly the free quota. The paid plans are for the busier 5% — and for anyone who wants the upgraded delivery infrastructure or CSV features.

All purchases run through Discord's native subscription system. Discord handles billing, refunds, and cancellations.

---

## At a glance

| | :material-account: **Free** | :material-star: **Standard** | :material-diamond: **Pro** |
|---|---|---|---|
| **Verification emails** | 25 / month | Unlimited | Unlimited |
| **Premium delivery (ZeptoMail)** | Optional, credit-funded (1 credit / mail) | ✓ Always on | ✓ Always on |
| **CSV import & export** | — | — | ✓ |
| **Quota warnings (80% / 95% / 100%)** | ✓ | n/a | n/a |
| **Domain rules, role mapping, blacklist** | ✓ | ✓ | ✓ |
| **Privacy-first storage (hashed emails)** | ✓ | ✓ | ✓ |
| **Best for** | Most servers | Busy servers | Closed groups + audit needs |
| **Billed by** | — | Discord (monthly) | Discord (monthly) |

[See prices and buy →](#how-to-buy){ .md-button .md-button--primary }

---

## Free tier — what you actually get

You don't sign up. You don't add a payment method. You invite the bot, run `/role add`, and you're done.

- **25 verification emails per month**, per server. Resets on the 1st.
- **All the configuration features** — domain rules, wildcard matching, domain-specific role mapping, blacklist, language settings, log channel, custom verify messages, auto-verify on join.
- **Smart warnings** at 80% and 95% before you hit the limit — including a **run-out forecast** based on your current pace — sent to your configured error notification destination (server-owner DM by default, or a channel you pick).
- **Blocked-attempt tracking.** Once the limit is hit, every member who tries to verify but can't is counted; you're alerted on the 1st, 5th, and 20th blocked member, and the count shows in `/status` and `/premium status`.
- **No degradation when you stop using the bot.** No card on file means no surprise charges.

If 25/month works for you, you can stop reading here.

---

## Standard subscription

A monthly subscription. Adds two things:

- :material-infinity: **Unlimited verification emails** every month — no quota worries.
- :material-email-fast: **Premium delivery via Zoho ZeptoMail.** Verification mails go through Zoho's transactional infrastructure with EU data residency. Better inbox placement than self-hosted SMTP because ZeptoMail is transactional-only — no marketing senders share its IP reputation.

Best for: large communities, university servers with seasonal verification spikes, paid Discord communities.

---

## Pro subscription

Everything in Standard, plus the CSV features:

- :material-file-upload: **Upload allowlists.** `/emaillist upload` accepts a CSV of specific addresses. Only those exact addresses can verify, regardless of domain. Useful for invite-only events, paid courses, alumni groups.
- :material-file-download: **Export verification logs.** `/export logs` writes every verification (with timestamp, user ID, email, role tags) to CSV. Useful for compliance, audit trails, or just keeping records.

Best for: closed groups where the membership list is known up front, organisations with audit obligations.

!!! info "How CSV import works in practice"
    The list is stored hashed (same scheme as all verified emails — never plaintext). Once uploaded, you can't list back the individual entries — only the count is shown in `/status`. To audit your list, just re-upload the same CSV; duplicates are skipped automatically. Use `/emaillist clear` to start fresh.

---

## One-time credit packs

For servers that don't want a recurring subscription. One-time purchase, no expiry.

<div class="grid cards" markdown>

- :material-ticket: __100 credits__

    ---

    Light usage — a small event, a one-off rush.

- :material-ticket-confirmation: __500 credits__

    ---

    Medium usage — a semester start at a university club.

- :material-ticket-percent: __2,000 credits__

    ---

    Heavy usage — large server bursts, multiple events per year.

</div>

Credits **never expire**, **roll over from month to month**, and **only get consumed once your free 25 are gone**. So a 100-pack might last you a year if your usage is light.

By default credits act as overflow on top of the free 25. If you'd rather pay one credit per send and get the premium delivery infrastructure from the first verification, see the next section.

---

## Pay-per-send ZeptoMail mode (credit-funded)

If your deliverability needs are higher than what self-SMTP gives you — but you don't want a monthly subscription — you can opt into the **credit-funded ZeptoMail mode**.

Run:

```
/settings mail-mode mode:zeptomail
```

and every verification email leaves the bot via Zoho ZeptoMail's EU transactional infrastructure instead of the self-SMTP server. The trade-off:

- :material-email-fast: **Premium delivery on every mail.** Same inbox placement as the Standard/Pro subscription.
- :material-ticket-percent: **1 credit per verification.** The 25/month free quota is **not** used in this mode — every send burns a bonus credit.
- :material-shield-check: **Auto-disable on zero credits.** When your credit balance hits 0, the bot atomically flips back to the `free` mode and notifies the server owner. Verifications keep working using the regular free monthly quota — no manual cleanup needed.
- :material-arrow-u-left-top: **Switch back any time** with `/settings mail-mode mode:free`.

Useful for:

- Sporadic events that need reliable inbox delivery but don't justify a monthly subscription.
- Universities or organisations on strict spam filters where the self-SMTP server occasionally lands in junk.
- Anyone who'd rather pay only for what they actually send.

!!! info "Why the 'no free quota' rule?"
    In `zeptomail` mode the goal is deterministic premium delivery — you know every verification went through ZeptoMail. Mixing in 25 self-SMTP sends per month would defeat the point, so the toggle is explicit: either use the free path with credits as overflow, or use the credit-funded ZeptoMail path with no fallback to self-SMTP until credits are exhausted.

!!! warning "Switching to `zeptomail` with 0 credits is rejected"
    The command refuses if your credit balance is 0 — there's no point enabling a mode that would auto-disable on the next verification. Run `/premium redeem` after buying a credit pack, then try the toggle again.

---

## CSV unlock (one-time)

If you want only the CSV import/export features and no subscription, there's a one-time **CSV unlock** that grants the Pro plan's CSV features for that server, forever. No recurring billing, no extra emails.

(Does not include unlimited verifications — those still come from your free quota or credits.)

---

## How to buy

All purchases happen inside Discord. Open `/premium status` in your server or click the **Premium** button on any limit-reached message — Discord shows the current price and handles the checkout.

!!! warning "Buying doesn't work in the mobile apps"
    Discord's iOS/Android apps can't complete app-store (SKU) purchases. If you're on your phone, switch to **Discord on desktop or in a web browser** and complete the purchase there — the bot's buy buttons and store links work normally on those platforms. Every purchase prompt in the bot includes a store link you can open in a browser.

!!! warning "Purchases attach to a specific server"
    Discord SKUs are bought in your personal account context, but the bot stores everything per-server. After purchase:

    - **Subscriptions** automatically apply to the server you selected at checkout.
    - **Credit packs** and the **CSV unlock** require running `/premium redeem` **in the server you want them applied to**. Once redeemed they're permanently bound to that server and cannot be moved.

    If you redeem to the wrong server, that's irreversible. Pick carefully.

    Right after buying a credit pack or the CSV unlock, the bot **DMs you a reminder** with the redeem instructions — so the purchase can't silently sit unused.

---

## Why I built a paid tier

EmailVerify has been running on infrastructure I host and pay for personally for the past five years. Donations haven't been enough to cover that. The paid tier is how I keep this sustainable long-term — without compromising the free tier that works for the majority of servers.

If you're in the 95%, your server stays free.
If you're in the 5% and the bot has been useful, picking up a subscription helps keep it running.

---

## Frequently asked

??? question "What happens when I cancel my subscription?"
    The subscription stops at the end of the current billing period. After that, your server falls back to the free 25/month tier. Your settings, domain rules, and verification log all stay intact. If you have a CSV allowlist uploaded, see the next question.

??? question "What if I have an allowedEmails list and lose Pro access?"
    The list is treated as an explicit security configuration — silently disabling it would be a regression for closed-group servers. Instead, the bot **pauses verification entirely** and notifies your admins (throttled to once per hour) until you do one of two things: (1) clear the list with `/emaillist clear` (after which any email is accepted, subject to your domain rules), or (2) restore CSV access by re-buying Pro or the one-time CSV unlock. The list resumes working immediately on restore.

??? question "How does ZeptoMail differ from the regular SMTP server?"
    Free-tier mails (and bonus-credit overflow in the default `free` mode) go through `mail.larskaesberg.de`, the operator's own SMTP server. Mail for **Standard/Pro subscribers** and for servers in the **credit-funded `zeptomail` mode** routes through Zoho ZeptoMail (`api.zeptomail.eu`) — a transactional-only provider, EU-hosted, with significantly better inbox placement. If ZeptoMail is ever unreachable, paid sends fall back to the regular SMTP server automatically — no action needed on your side.

??? question "What's the difference between the credit-funded ZeptoMail mode and the Standard subscription?"
    Both route mail through Zoho ZeptoMail. The difference is the billing model:

    - **Standard subscription** — fixed monthly fee, unlimited verifications.
    - **`/settings mail-mode mode:zeptomail`** — pay-per-send. One credit per verification, no monthly commitment. Auto-disables when credits hit 0.

    If you reliably send more than the credit cost per month would imply, Standard is cheaper. If your volume is bursty or seasonal, the credit-funded mode lets you only pay for what you actually use.

??? question "Are emails stored anywhere?"
    Plaintext only at the moment of sending the verification code. The bot stores email addresses as MD5 base64 hashes — same scheme for verified users and for the allowedEmails list. Discord may keep its own logs of bot interactions; that's outside the bot's control. Your full data flow is in the [privacy policy](legal/datenschutz.md).

??? question "Can I self-host with monetization disabled?"
    Yes. The source is on [GitHub](https://github.com/lkaesberg/EmailVerify) under GPL-3.0. Set `monetization.enabled` to `false` in `config/config.json`, supply your own SMTP credentials, and run it. Self-hosters bypass the quota system entirely.

??? question "Where do I find prices?"
    Inside Discord, where the bot is. Run `/premium status` and click any of the buy buttons — Discord renders the actual price for your locale. Listing fixed prices on this page would get out of sync with regional pricing in Discord.

??? question "Is there a refund / cancellation right?"
    Yes — see the [Widerrufsbelehrung](legal/widerruf.md) for the formal 14-day cancellation right under German consumer law (BGB §312g). Note the standard exception for digital content already consumed (the Discord checkout flow asks for explicit consent on this).

---

[See all commands →](commands.md){ .md-button }
[Status page →](status.md){ .md-button }
[Support server →](https://discord.com/invite/fEBSHUQXu2){ .md-button }
