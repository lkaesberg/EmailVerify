const Discord = require('discord.js');
const nodemailer = require('nodemailer');
const smtpTransport = require('nodemailer-smtp-transport');

var transporter = nodemailer.createTransport(smtpTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  auth: {
    user: 'informatik.goettingen@gmail.com',
    pass: 'MtTz2mVGb9kqZf'
  }
}));

function sendEmail(email, code){
    var mailOptions = {
        from: 'informatik.goettingen@gmail.com',
        to: email,
        subject: 'Angewandte Informatik & Data Science Göttingen Discord Password',
        text: code
      };
      
      transporter.sendMail(mailOptions, function(error, info){
        if (error) {
          console.log(error);
        } else {
          console.log('Email sent: ' + info.response);
        }
      });
}

const bot = new Discord.Client({ intents: [Discord.Intents.FLAGS.DIRECT_MESSAGES,Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS,Discord.Intents.FLAGS.GUILDS, Discord.Intents.FLAGS.GUILD_MESSAGES] });

const roleVerified = '895066061223886939';

const roleUnverified = '895264631344480286';

const userCodes = new Map()


bot.once('ready', async () => {
	await bot.channels.cache.get('895264431406211082').messages.fetch('895275844984008746')
});

bot.on('messageReactionAdd', async (reaction_orig, user) => {
    user.send("Gib bitte deine Studenten E-Mail ein, an die die Zugangsdaten geschickt werden sollen (<name>@stud.uni-goettingen.de).")

  });

bot.on('messageCreate', async (message) => {
  if(message.channel.type == 'DM' && message.author.id != bot.user.id){
      let text = message.content
      if(userCodes.get(message.author.id) == text){
        (await bot.guilds.cache.get('890877430854725652').members.fetch(message.author.id)).roles.add(roleVerified);
        (await bot.guilds.cache.get('890877430854725652').members.fetch(message.author.id)).roles.remove(roleUnverified);
        message.reply("Rolle Student hinzugefügt")
        userCodes.delete(message.author.id)
      }else{
      if(!text.endsWith('@stud.uni-goettingen.de') || text.includes(' ')){
          message.reply("Bitte gib nur eine valide E-Mail Adresse ein")
      }
      else{
          let code = Math.floor((Math.random()+1)*100000).toString()
          userCodes.set(message.author.id, code)
          sendEmail(text, code)
          message.reply("Bitte gib den Code aus der E-Mail ein")
      }
    }
  }
});

bot.login('ODk1MDU2MTk3Nzg5NTY0OTY5.YVzACg.Rkm2Gvurra7e2zVtf6SirENIL2k');