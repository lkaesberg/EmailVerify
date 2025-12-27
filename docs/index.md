<meta name="description" content= "This Discord Bot allows you to verify clients with the help of their email address. This can be useful when there is some sensitive data on the server which shouldn't be accessed by everyone.">
<meta name="keywords" content="EmailVerify Discord Bot Lars Kaesberg Email Verify EmailBot">
<meta name="author" content="Lars Kaesberg">

# EmailVerify

## Built With

<div style="display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 24px; margin: 20px 0;">
<a href="https://discord.com/"><img src="https://raw.githubusercontent.com/lkaesberg/EmailBot/main/images/discord.png" alt="Discord" style="height: 56px; width: auto;" title="Discord"></a>
<a href="https://nodejs.org/"><img src="https://raw.githubusercontent.com/lkaesberg/EmailBot/main/images/node.png" alt="Node.js" style="height: 56px; width: auto;" title="Node.js"></a>
<a href="https://www.npmjs.com/"><img src="https://raw.githubusercontent.com/lkaesberg/EmailBot/main/images/npm.png" alt="npm" style="height: 40px; width: auto;" title="npm"></a>
<a href="https://discord.js.org/"><img src="https://raw.githubusercontent.com/lkaesberg/EmailBot/main/images/discordjs.png" alt="Discord.js" style="height: 56px; width: auto;" title="Discord.js"></a>
<a href="https://nodemailer.com/"><img src="https://raw.githubusercontent.com/lkaesberg/EmailBot/main/images/nodemailer.webp" alt="Nodemailer" style="height: 48px; width: auto;" title="Nodemailer"></a>
</div>

## Statistics

EmailVerify server count: <strong id="serverCount">0</strong><br>
Users verified today: <strong id="verifiedToday">0</strong><br>
Users verified all time: <strong id="verifiedAll">0</strong><br>
Emails sent today: <strong id="emailsToday">0</strong><br>
Emails sent all time: <strong id="emailsAll">0</strong>

[View detailed statistics →](statistics.md)

## Description

This bot is able to verify that a discord user owns an email with a certain domain (i.e. verify name@uni.edu mails).
This can be useful when there is some sensitive data on the server which shouldn't be accessed by everyone. To verify,
the user just has to add a reaction to a specified message and the bot will send a direct message which asks for the
email address. A code will be sent to the email which will grant the verified role when send to the bot.

## Usage

### Invite Bot

[Click here](https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268504128&scope=bot%20applications.commands)
to invite the bot to your server

### Need Help

[Click here](https://discord.com/invite/fEBSHUQXu2) to join the EmailBot Support Server

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
      serverCount.textContent = data.serverCount;
      verifiedToday.textContent = data.usersVerifiedToday;
      verifiedAll.textContent = data.usersVerifiedAll;
      emailsToday.textContent = data.mailsSendToday;
      emailsAll.textContent = data.mailsSendAll;
    })
    .catch(() => {});
}
refreshData();
setInterval(refreshData, 10000);
</script>
