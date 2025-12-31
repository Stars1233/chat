Teams: By default, Teams bots only receive messages when directly @mentioned. To receive all messages in a thread/channel, you need:

- Resource-Specific Consent (RSC) permissions in your Teams app manifest
- Add ChannelMessage.Read.Group permission to receive channel messages
- Or configure the bot in Azure to receive all messages
