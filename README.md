# Chat SDK

A unified SDK for building chat bots across Slack, Microsoft Teams, and Google Chat.

## Features

- Multi-platform support with a single codebase
- Mention-based thread subscriptions
- Message deduplication for platform quirks
- Serverless-ready with pluggable state backends

## Packages

| Package | Description |
|---------|-------------|
| `chat-sdk` | Core SDK with thread management and handlers |
| `@chat-sdk/slack` | Slack adapter |
| `@chat-sdk/teams` | Microsoft Teams adapter |
| `@chat-sdk/gchat` | Google Chat adapter with Workspace Events |
| `@chat-sdk/state-memory` | In-memory state (development) |
| `@chat-sdk/state-redis` | Redis state (production) |

## Quick Start

```typescript
import { createChat } from "chat-sdk";
import { createSlackAdapter } from "@chat-sdk/slack";
import { createRedisStateAdapter } from "@chat-sdk/state-redis";

const chat = createChat({
  adapters: [
    createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
    }),
  ],
  state: createRedisStateAdapter({ url: process.env.REDIS_URL }),
});

chat.onMention(async (thread) => {
  await thread.reply("Hello! I'm now listening to this thread.");
  thread.subscribe();
});

chat.onSubscribedMessage(async (thread, message) => {
  await thread.reply(`You said: ${message.text}`);
});

export async function POST(request: Request) {
  return chat.handleWebhook("slack", request);
}
```

## Setup

See [SETUP.md](./SETUP.md) for platform configuration instructions including:

- Slack app creation and OAuth scopes
- Microsoft Teams Azure Bot setup
- Google Chat service account and Pub/Sub configuration
- Environment variables reference

## Development

```bash
pnpm install
pnpm build
pnpm dev         # Run example app
pnpm typecheck
pnpm lint
```

## License

MIT
