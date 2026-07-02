<meta name="description" content="EmailVerify is a Discord bot that verifies users own a specific email address before granting roles — perfect for university servers, employee groups, and any closed community.">
<meta name="keywords" content="EmailVerify Discord Bot Email Verification Domain Restriction University Discord Server Lars Kaesberg">
<meta name="author" content="Lars Benedikt Kaesberg">

# EmailVerify for Discord

**Verify that the people in your server actually own the email address they claim to.**
A user enters their email, gets a 6-digit code, types it back, and a role is assigned. That's it.
Built for university servers, employee groups, and any closed community where you want to know who's joining.

[:fontawesome-brands-discord: Add to your server](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268504128&scope=bot%20applications.commands){ .md-button .md-button--primary }
[:fontawesome-brands-discord: Join support server](https://discord.com/invite/fEBSHUQXu2){ .md-button }
[See pricing →](premium.md){ .md-button }

---

## Live numbers

<div class="grid cards" markdown>

- :material-server-network: __Servers__

    ---

    Currently active in **<span id="serverCount">…</span>** Discord servers.

- :material-account-check: __Verified users__

    ---

    **<span id="verifiedToday">…</span>** today, **<span id="verifiedAll">…</span>** all-time.

- :material-email-fast: __Emails sent__

    ---

    **<span id="emailsToday">…</span>** today, **<span id="emailsAll">…</span>** all-time.

</div>

[Detailed statistics →](statistics.md)

---

## What it does

<div class="grid cards" markdown>

- :material-email-check:{ .lg .middle } __Verify by email code__

    ---

    The user enters their address, the bot sends a 6-digit code, the user types it back. No external account, no OAuth, no extra steps.

- :material-shield-key:{ .lg .middle } __Restrict by domain__

    ---

    Allow `@*.edu`, `@yourcompany.com`, exact addresses, or any combination. Wildcards supported. Default is "any valid email" so small servers don't need to configure anything.

- :material-account-multiple-check:{ .lg .middle } __Domain-specific roles__

    ---

    `@students.uni.edu` gets the Student role, `@staff.uni.edu` gets the Staff role, everyone gets a default Verified role. As granular as you need.

- :material-file-upload:{ .lg .middle } __CSV allowlist (Pro)__

    ---

    Upload a CSV of specific addresses for invite-only servers. Hashed at rest, so even you can't read them back.

- :material-bell-ring:{ .lg .middle } __Quota reminders__

    ---

    Like a phone plan: warnings at 80%, 95%, and 100% of your monthly send limit — with a run-out forecast and a count of members turned away once it's hit. Sent to whoever you want — owner DM, channel, or specific admin.

- :material-shield-lock:{ .lg .middle } __Privacy-first storage__

    ---

    Email addresses are stored only as cryptographic hashes. The plaintext exists only at the moment of sending the verification code. GDPR-compliant.

</div>

---

## Free for almost everyone

Every server gets **25 verification emails per month**, no setup needed. Looking at usage stats from the past few months, **about 95% of servers send 25 or fewer per month** — so for nearly everyone reading this, the bot keeps working completely free.

If you do hit the limit, you'll get warnings at 80% and 95% before sending pauses. From there, [credit packs or a subscription](premium.md) takes over.

[See pricing →](premium.md){ .md-button .md-button--primary }

---

## Built for transparency

This is a single-developer project that has been running on personal infrastructure for the past five years. The source code stays open under GPL-3.0 — fork it, audit it, self-host it. Premium routes through Zoho ZeptoMail (EU servers, GDPR-friendly) for paying servers; free-tier mail keeps using the operator's own SMTP.

<div class="grid" markdown>

- [:material-source-branch: GitHub repository](https://github.com/lkaesberg/EmailVerify)
- [:material-shield-check-outline: Privacy policy](legal/datenschutz.md)
- [:material-file-document-outline: Terms](legal/terms.md)
- [:material-information-outline: Impressum](legal/impressum.md)

</div>

---

## Built with

<div style="display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 24px; margin: 20px 0;">
<a href="https://discord.com/"><img src="https://raw.githubusercontent.com/lkaesberg/EmailBot/main/images/discord.png" alt="Discord" style="height: 56px; width: auto;" title="Discord"></a>
<a href="https://nodejs.org/"><img src="https://raw.githubusercontent.com/lkaesberg/EmailBot/main/images/node.png" alt="Node.js" style="height: 56px; width: auto;" title="Node.js"></a>
<a href="https://www.npmjs.com/"><img src="https://raw.githubusercontent.com/lkaesberg/EmailBot/main/images/npm.png" alt="npm" style="height: 40px; width: auto;" title="npm"></a>
<a href="https://discord.js.org/"><img src="https://raw.githubusercontent.com/lkaesberg/EmailBot/main/images/djs.png" alt="Discord.js" style="height: 56px; width: auto;" title="Discord.js"></a>
<a href="https://nodemailer.com/"><img src="https://raw.githubusercontent.com/lkaesberg/EmailBot/main/images/nodemailer.webp" alt="Nodemailer" style="height: 48px; width: auto;" title="Nodemailer"></a>
<a href="https://www.zoho.com/zeptomail/"><img src="https://www.zoho.com/branding/images/zoho-logo-512.png" alt="Zoho ZeptoMail" style="height: 48px; width: auto;" title="Zoho ZeptoMail (Pro delivery)"></a>
</div>

<script>
const serverCount = document.getElementById("serverCount");
const verifiedToday = document.getElementById("verifiedToday");
const verifiedAll = document.getElementById("verifiedAll");
const emailsToday = document.getElementById("emailsToday");
const emailsAll = document.getElementById("emailsAll");

function refreshData(){
  fetch('https://emailbotstats.larskaesberg.de/stats/current')
    .then(response => response.json())
    .then(data => {
      serverCount.textContent = data.serverCount.toLocaleString();
      verifiedToday.textContent = data.usersVerifiedToday.toLocaleString();
      verifiedAll.textContent = data.usersVerifiedAll.toLocaleString();
      emailsToday.textContent = data.mailsSendToday.toLocaleString();
      emailsAll.textContent = data.mailsSendAll.toLocaleString();
    })
    .catch(() => {});
}
refreshData();
setInterval(refreshData, 10000);
</script>
