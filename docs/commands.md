# Commands

|Commands|         Arguments          |                                                                                                 Usage                                                                                                 |
|:---:|:--------------------------:|:-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------:|
|`/status`|           **-**            |                                                                         returns whether the bot is properly configured or not                                                                         |
|`/domain`|     **(domain name)**      |                                                          **()** -> returns registered domains<br>**(domain name)** -> register given domain                                                           |
|`/removedomain`|      **domain name**       |                                                                                       remove registered domain                                                                                        |
|`/message`|    **channel, message**    | sends a message to the channel to which the user can add a reaction to start the verification process
|`/verifiedrole`|  **(verified role name)**  |                                       **()** -> returns the name of the verified role <br> **(verified role name)** -> set the role name for the verified role                                        |
|`/unverifiedrole`| **(unverified role name)** | **()** -> returns the name of the unverified role <br> **(unverified role name)** -> set the role name for the unverified role <br> **(current unverified role name)** -> deactivates unverified role |
|`/language`|        **language**        |                                                                                set language for the user interactions                                                                                 |

react := react to the message with an emoji

**The commands can only be used by an administrator**

The unverified role can be used to make a channel visible in which the message is located

The EmailBot role has to be higher in the role hierarchy then the verified and unverified role else
-> `Cant find roles. Please contact the admin!` error

![img.png](https://raw.githubusercontent.com/lkaesberg/EmailBot/main/images/bothierarchy.png)