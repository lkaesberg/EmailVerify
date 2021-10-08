<!--
*** Build using the Best-README-Template.
-->

<!-- PROJECT LOGO -->
<br />
<p align="center">
<a><img src="emailbot.png" alt="EmailBot" width="128" height="128" title="EmailBot"></a>
  <h3 align="center">Discord Email Bot</h3>
  <p align="center">
    A Email Verification Bot<br />
    <p>
    <a href="https://github.com/lkaesberg/EmailBot/issues">Report Bug</a>
    ·
    <a href="https://github.com/lkaesberg/EmailBot/issues">Request Feature</a>
    </p>
  </p>
</p>



<!-- TABLE OF CONTENTS -->
<details open="open">
  <summary><h2 style="display: inline-block">Table of Contents</h2></summary>
  <ol>
    <li>
      <a href="#built-with">Built With</a>
    </li>
    <li>
        <a href="#usage">Usage</a>
    </li>
  </ol>

</details>

### Built With

<div style="display: -ms-flexbox;     display: -webkit-flex;     display: flex;     -webkit-flex-direction: row;     -ms-flex-direction: row;     flex-direction: row;     -webkit-flex-wrap: wrap;     -ms-flex-wrap: wrap;     flex-wrap: wrap;     -webkit-justify-content: space-around;     -ms-flex-pack: distribute;     justify-content: space-around;     -webkit-align-content: stretch;     -ms-flex-line-pack: stretch;     align-content: stretch;     -webkit-align-items: flex-start;     -ms-flex-align: start;     align-items: flex-start;">
<a href="https://nodejs.org/en/"><img src="https://chris-noring.gallerycdn.vsassets.io/extensions/chris-noring/node-snippets/1.3.2/1606066290744/Microsoft.VisualStudio.Services.Icons.Default" alt="NodeJS" width="64" height="64" title="NodeJS"></a>
<a href="https://www.npmjs.com/"><img src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Npm-logo.svg/1280px-Npm-logo.svg.png" alt="npm" width="164" height="64" title="npm"></a>
<a href="https://discord.js.org/#/"><img src="https://discordjs.guide/meta-image.png" alt="DiscordJS" width="64" height="64" title="DiscordJS"></a>
<a href="https://nodemailer.com/about/"><img src="https://nodemailer.com/nm_logo_200x136.png" alt="Nodemailer" width="94" height="64" title="Nodemailer"></a>
</div>

### Description

This bot is able to verify that a discord user owns an email with a certain domain (i.e. verify name@uni.edu mails). This can be useful when there is some sensitive data on the server which shouldn't be accessed by everyone. To verify, the user just has to add a reaction to a specified message and the bot will send a direct message which asks for the email address. A code will be sent to the email which will grant the verified role when send to the bot.

### Usage

#### Invite Bot
Use this link to invite the bot to your server:

https://discord.com/api/oauth2/authorize?client_id=895056197789564969&permissions=268504128&scope=bot%20applications.commands
#### Commands

|Commands|Arguments|Usage|
|:---:|:---:|:---:|
|`/status`|**-**|returns whether the bot is properly configured or not|
|`/domain`|**(domain name)**|**()** -> returns registered domains<br>**(domain name)** -> register given domain|
|`/removedomain`|**domain name**|remove registered domain|
|`/message`|**channel,message**| sends a message to the channel to which the user can add a reaction to start the verification process
|`/verifiedrole`|**(verified role name)**|**()** -> returns the name of the verified role <br> **(verified role name)** -> set the role name for the verified role|
|`/unverifiedrole`|**(unverified role name)**|**()** -> returns the name of the unverified role <br> **(unverified role name)** -> set the role name for the unverified role <br> **(current unverified role name)** -> deactivates unverified role|

react := react to the message with an emoji

**The commands can only be used by an administrator**

The unverified role can be used to make a channel visible in which the message is located

The EmailBot role has to be higher in the role hierarchy then the verified and unverified role else -> `Cant find roles. Please contact the admin!` error

![img.png](bothierarchy.png)
