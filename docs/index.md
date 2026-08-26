<meta name="description" content="EmailVerify is a Discord bot that verifies users own a specific email address before granting roles — perfect for university servers, employee groups, and any closed community.">
<meta name="keywords" content="EmailVerify Discord Bot Email Verification Domain Restriction University Discord Server Lars Kaesberg">
<meta name="author" content="Lars Benedikt Kaesberg">

<div class="hero-head" markdown>

# EmailVerify for Discord

<span class="laurel-badge" aria-label="The #1 email verification bot for Discord since 2021"><svg class="laurel-side" viewBox="0 0 420 802" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><use href="#laurel-branch"></use></svg><span class="laurel-inner"><span class="laurel-title">#1 Email<br>Verification<br>on Discord</span><span class="laurel-sub">SINCE 2021</span></span><svg class="laurel-side laurel-side--right" viewBox="0 0 420 802" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><use href="#laurel-branch"></use></svg></span>

</div>

**Verify that the people in your server actually own the email address they claim to.**
A user enters their email, gets a 6-digit code, types it back, and a role is assigned. That's it.
Built for university servers, employee groups, and any closed community where you want to know who's joining.
{ .hero-lead }

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

<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><g id="laurel-branch" fill="currentColor"><path d="m334.46 49.002c-18.278 12.277-38.479 27.48-54.76 44.437-28.887 30.086-57.536 64.004-82.159 97.941-16.634 22.926-38.215 57.715-50.006 83.305-15.691 34.056-24.985 57.915-33.597 95.332-12.132 52.713-10.459 106.81 1.863 157.81 18.129 75.031 76.15 137.81 134.13 188.77 45.358 39.863 106.34 65.942 159.92 85.098l5.5363-14.63c-53.09-18.97-109.36-44.31-152.83-82.56-55.92-49.21-107.57-109.22-129.85-180.73-13.57-43.53-16.72-91.29-9.6-137.54 6.2375-40.516 21.918-81.121 37.193-118.04 12.558-30.349 27.2-53.991 45.06-78.892 22.645-31.574 47.529-62.365 73.981-90.48 17.123-18.199 40.023-34.629 58.415-46.982z"></path><path d="m311.24 756.98s-37.634-11.898-67.5-8.3929c-47.415 5.5642-51.786 35-51.786 35s19.022 11.809 59.821 7.3214c47.796-5.2574 59.464-33.929 59.464-33.929z"></path><path d="m247.15 713.02s-31.716-15.044-61.786-14.821c-52.058 0.38562-55.179 28.036-55.179 28.036s18.843 13.595 60.536 13.036c48.08-0.64498 56.429-26.25 56.429-26.25z"></path><path d="m199.74 666.79s-30.157-26.43-59.326-33.739c-50.498-12.653-67.224 16.73-67.224 16.73s18.771 22.52 59.277 32.411c46.711 11.406 67.273-15.402 67.273-15.402z"></path><path d="m146.2 595.58s-25.79-27.185-61.094-38.032c-46.073-14.156-67.729 13.636-68.361 14.331 0 0 18.879 23.762 58.267 34.179 52.832 13.973 71.188-10.478 71.188-10.478z"></path><path d="m120.7 538.91s-24.019-36.576-59.844-53.84c-34.801-16.78-60.225-2.49-60.856-1.93 0 0 17.877 32.67 50.767 48.325 44.687 21.271 69.938 7.4411 69.938 7.4412z"></path><path d="m112.96 489.18c-12.82-12.06-13.775-44.84-32.099-71.44-25.563-37.11-67.73-34.42-68.361-34.07 0 0 4.5142 46.234 36.481 74.178 33.973 29.697 63.978 31.335 63.978 31.335z"></path><path d="m109.42 411.25s1.2445-40.185-9.3525-70.701c-14.783-42.569-55.138-50.926-55.839-50.759 0 0-6.5444 45.519 16.848 80.952 24.861 37.657 48.344 40.507 48.344 40.507z"></path><path d="m126.51 335.94s8.0495-33.735 3.9716-65.78c-6.1462-48.297-43.73-58.521-44.448-58.451 0 0-12.884 44.733 5.4449 83.031 19.479 40.702 35.031 41.2 35.031 41.2z"></path><path d="m159.62 255.08s13.089-30.516 11.412-62.775c-2.3279-44.771-32.665-63.685-33.385-63.711 0 0-29.251 26.374-12.451 83.145 10.191 34.437 34.425 43.342 34.425 43.342z"></path><path d="m201.74 188.6s19.451-29.962 24.832-61.814c5.0517-29.903-7.0803-62.481-9.7885-65.475 0 0-31.65 13.91-30.465 67.294 0.79711 35.905 15.422 59.995 15.422 59.995z"></path><path d="m253.49 124.45s23.192-24.697 29.233-58.466c5-27.984-0.04-58.394-5.31-65.984 0 0-30.25 18.795-32.448 66.327-1.6587 35.875 6.1262 52.95 8.5253 58.127z"></path><path d="m291.03 85.107s44.199 1.5969 66.166-11.157c24.589-14.276 48.719-45.263 50.623-54.309 0 0-38.712-16.975-74.806 14.032-27.242 23.402-39.862 46.137-41.983 51.434z"></path><path d="m242.33 138.43s21.141-24.752 57.469-31.147c28.002-4.9287 49.529-0.37797 63.35 7.6753 0 0-21.322 27.318-62.19 31.084-35.762 3.2949-53.376-5.3854-58.63-7.6124z"></path><path d="m198.64 195.5s20.13-23.742 56.459-30.136c28.002-4.9287 41.448 0.12711 55.269 8.1804 0 0-17.029 26.056-57.897 29.821-35.762 3.2949-48.578-5.638-53.832-7.8649z"></path><path d="m156.23 269.95s18.805-29.262 52.808-43.562c34.843-14.654 52.739-7.6569 67.725-2.0626-4.7791 7.1686-24.337 37.05-56.046 46.02-34.557 9.7763-58.932 0.90881-64.487-0.39556z"></path><path d="m131.06 336.07s16.664-30.532 49.556-47.228c33.706-17.109 52.056-11.41 67.404-6.9021-4.254 7.4921-21.624 38.696-52.61 49.912-33.77 12.223-58.716 5.1223-64.35 4.2186z"></path><path d="m117.84 414.65c14.421-18.489 22.261-38.366 44.449-58.149 27.336-24.373 50.792-16.603 66.711-15.029-7.8365 14.719-19.603 38.003-43.92 55.546-29.126 21.011-61.536 17.473-67.24 17.633z"></path><path d="m119.63 487.05c12.262-19.986 18.081-35.565 37.916-57.707 24.437-27.278 47.605-22.435 63.6-22.652-6.1404 15.503-16.49 38.695-38.692 58.849-26.592 24.138-57.175 20.713-62.824 21.51z"></path><path d="m135.4 544.78c18.448-28.481 16.12-34.927 34.176-58.542 19.392-25.362 43.885-24.665 59.811-26.165-4.8772 15.946-12.165 37.517-32.837 59.237-22.045 23.163-44.975 20.181-61.149 25.47z"></path><path d="m165.71 601.35c11.63-25.198 9.6219-40.933 20.286-58.794 17.442-29.213 34.541-30.474 50.467-31.973-12.703 36.396-9.762 36.564-23.746 58.732-13.607 21.571-32.096 24.474-47.007 32.036z"></path><path d="m202.25 648.92c6.628-26.95-0.10184-35.197 6.973-54.76 11.571-31.996 28.119-36.484 43.469-40.983-1.7651 21.479 0.89983 35.106-11.139 58.387-8.5015 16.44-26.101 27.098-39.303 37.356z"></path><path d="m275.9 596.01s13.293 25.664 8.8773 55.408c-6.2559 42.144-28.777 48.458-28.777 48.458s-12.827-19.155-11.523-58.022c1.3924-41.516 31.423-45.845 31.423-45.845z"></path><path d="m323.88 638.94s13.303 25.984 10.393 55.914c-3.7305 38.356-24.736 47.953-24.736 47.953s-13.232-21.412-13.796-53.728c-0.86041-49.346 28.14-50.138 28.14-50.138z"></path></g></defs></svg>
