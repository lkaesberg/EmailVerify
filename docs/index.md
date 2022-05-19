<meta name="description" content= "This Discord Bot allows you to verify clients with the help of their email address. This can be useful when there is some sensitive data on the server which shouldn't be accessed by everyone.">
<meta name="keywords" content="EmailVerify Discord Bot Lars Kaesberg Email Verify EmailBot">
<meta name="author" content="Lars Kaesberg">

# EmailVerify

## Built With

<div style="display: -ms-flexbox;     display: -webkit-flex;     display: flex;     -webkit-flex-direction: row;     -ms-flex-direction: row;     flex-direction: row;     -webkit-flex-wrap: wrap;     -ms-flex-wrap: wrap;     flex-wrap: wrap;     -webkit-justify-content: space-around;     -ms-flex-pack: distribute;     justify-content: space-around;     -webkit-align-content: stretch;     -ms-flex-line-pack: stretch;     align-content: stretch;     -webkit-align-items: flex-start;     -ms-flex-align: start;     align-items: flex-start;">
<a href="https://nodejs.org/en/"><img src="https://chris-noring.gallerycdn.vsassets.io/extensions/chris-noring/node-snippets/1.3.2/1606066290744/Microsoft.VisualStudio.Services.Icons.Default" alt="NodeJS" width="64" height="64" title="NodeJS"></a>
<a href="https://www.npmjs.com/"><img src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Npm-logo.svg/1280px-Npm-logo.svg.png" alt="npm" width="164" height="64" title="npm"></a>
<a href="https://discord.js.org/#/"><img src="https://discordjs.guide/meta-image.png" alt="DiscordJS" width="64" height="64" title="DiscordJS"></a>
<a href="https://nodemailer.com/about/"><img src="https://nodemailer.com/nm_logo_200x136.png" alt="Nodemailer" width="94" height="64" title="Nodemailer"></a>
</div>

## Statistics

Server count: <strong id="serverCount">0</strong><br>
Mails sent today: <strong id="todayMails">0</strong><br>
Mails sent all time: <strong id="allMails">0</strong>

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
const mailsSendToday = document.getElementById("todayMails");
const mailsSendAll = document.getElementById("allMails");
function refreshData(){
fetch('https://emailbotstats.larskaesberg.de/serverCount')
  .then(response => response.json())
  .then(data => serverCount.textContent = data);
fetch('https://emailbotstats.larskaesberg.de/mailsSendToday')
  .then(response => response.json())
  .then(data => mailsSendToday.textContent = data);
fetch('https://emailbotstats.larskaesberg.de/mailsSendAll')
  .then(response => response.json())
  .then(data => mailsSendAll.textContent = data);
}
refreshData();
setInterval(function (){
refreshData();
},10000);

</script>
