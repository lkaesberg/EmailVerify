# Commands

|         Commands          |            Arguments            |                                                                                                Usage                                                                                                |
|:-------------------------:|:-------------------------------:|:---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------:|
|          `/help`          |                                 |                                                                               get instructions on how to use the bot                                                                                |
|         `/verify`         |                                 |                                                                                        verify on the server                                                                                         |
|         `/status`         |              **-**              |                                                                        returns whether the bot is properly configured or not                                                                        |
|         `/domains`         |        **(domain name)**        |                                                         **()** -> returns registered domains<br>**(domain name)** -> register given domain                                                          |
|      `/removedomain`      |         **domain name**         |                                                                                      remove registered domain                                                                                       |
|         `/button`         | **channel,message, buttontext** |                                                                  creates a button in the channel with the message and button text                                                                   |
|        `/message`         |       **channel,message**       |                                                sends a message to the channel to which the user can add a reaction to start the verification process                                                |
|     `/verifymessage`      |          **(message)**          |                                                     **()** -> resets to default verify message <br> **(message)** -> set custom verify message                                                      |
|      `/verifiedrole`      |    **(verified role name)**     |                                      **()** -> returns the name of the verified role <br> **(verified role name)** -> set the role name for the verified role                                       |
|     `/unverifiedrole`     |   **(unverified role name)**    | **()** -> returns the name of the unverified role <br> **(unverified rolename)** -> set the role name for the unverified role <br> **(current unverified rolename)** -> deactivates unverified role |
|        `/language`        |          **language**           |                                                                               set language for the user interactions                                                                                |
| `/add_unverified_on_join` |           **enable**            |                                                          **(enable/disable)** -> automatically adds the unverified role to every new user                                                           |
|     `/verify_on_join`     |           **enable**            |                                                                **(enable/disable)** -> automatically asks every new member to verify                                                                |
|    `/delete_user_data`    |                                 |                                                                                  delete all the data from the user                                                                                  |
|   `/delete_server_data`   |                                 |                                                                                 delete all the data from the server                                                                                 |
|    `/set_log_channel`     |        **(logchannel)**         |                                                               **()** -> disable log channel <br> **(log channel)** -> set log channel                                                               |

react := react to the message with an emoji

**The commands can only be used by an administrator**

The unverified role can be used to make a channel visible in which the message is located

The EmailBot role has to be higher in the role hierarchy then the verified and unverified role else
-> `Cant find roles. Please contact the admin!` error

![img.png](https://raw.githubusercontent.com/lkaesberg/EmailBot/main/images/bothierarchy.png)
