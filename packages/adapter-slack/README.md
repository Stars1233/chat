# @chat-adapter/slack

Slack adapter for the [chat](https://github.com/vercel-labs/chat) SDK.

## Installation

```bash
npm install chat @chat-adapter/slack
```

## Usage

```typescript
import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";

const chat = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
    }),
  },
});

// Handle @mentions
chat.onNewMention(async (thread, message) => {
  await thread.post("Hello from Slack!");
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `botToken` | Yes | Slack bot token (starts with `xoxb-`) |
| `signingSecret` | Yes | Slack signing secret for webhook verification |

## Required Slack Scopes

Your Slack app needs these OAuth scopes:

**Bot Token Scopes:**
- `chat:write` - Send messages
- `channels:history` - Read channel messages
- `groups:history` - Read private channel messages
- `im:history` - Read DM messages
- `mpim:history` - Read group DM messages
- `reactions:read` - Read reactions
- `reactions:write` - Add reactions
- `files:read` - Read file attachments
- `users:read` - Read user info

**Event Subscriptions:**
- `message.channels` - Channel messages
- `message.groups` - Private channel messages
- `message.im` - Direct messages
- `message.mpim` - Group DMs
- `app_mention` - @mentions
- `reaction_added` - Reaction events
- `reaction_removed` - Reaction events

## Features

- Message posting and editing
- Thread subscriptions
- Reaction handling (add/remove/events)
- File attachments
- Rich cards (Block Kit)
- Action callbacks (interactive components)
- Direct messages

## License

MIT
