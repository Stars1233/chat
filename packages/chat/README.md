# chat

A unified SDK for building chat bots across Slack, Microsoft Teams, and Google Chat.

## Installation

```bash
npm install chat
```

## Quick Start

```typescript
import { Chat, emoji } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
    }),
  },
  state: createRedisState({ url: process.env.REDIS_URL! }),
});

// Handle @mentions
bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await thread.post(`${emoji.wave} Hello! I'm listening.`);
});

// Handle follow-up messages
bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

## Adapters

| Package | Platform |
|---------|----------|
| [@chat-adapter/slack](https://github.com/vercel-labs/chat/tree/main/packages/adapter-slack) | Slack |
| [@chat-adapter/teams](https://github.com/vercel-labs/chat/tree/main/packages/adapter-teams) | Microsoft Teams |
| [@chat-adapter/gchat](https://github.com/vercel-labs/chat/tree/main/packages/adapter-gchat) | Google Chat |

## State Adapters

| Package | Backend |
|---------|---------|
| [@chat-adapter/state-redis](https://github.com/vercel-labs/chat/tree/main/packages/state-redis) | Redis (production) |
| [@chat-adapter/state-ioredis](https://github.com/vercel-labs/chat/tree/main/packages/state-ioredis) | Redis via ioredis |
| [@chat-adapter/state-memory](https://github.com/vercel-labs/chat/tree/main/packages/state-memory) | In-memory (dev only) |

## Features

- **Multi-platform**: Write once, deploy to Slack, Teams, and Google Chat
- **Thread subscriptions**: Follow conversations after @mentions
- **Rich cards**: JSX-based cards that convert to Block Kit, Adaptive Cards, etc.
- **Action callbacks**: Handle button clicks across platforms
- **Reactions**: Type-safe emoji with cross-platform normalization
- **File uploads**: Send files with messages
- **Direct messages**: Initiate DMs programmatically
- **Serverless-ready**: Pluggable state backends for distributed deployments

## Documentation

See the [main repository](https://github.com/vercel-labs/chat) for full documentation.

## License

MIT
