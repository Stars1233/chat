# chat-sdk

A unified chat abstraction for building bots that work across Slack, Microsoft Teams, and Google Chat.

## Features

- Single API for multiple chat platforms
- Thread subscription and message handling
- Markdown AST-based message formatting with platform-specific conversion
- Typing indicators and reactions
- Pluggable state backends (memory, Redis)

## Packages

| Package | Description |
|---------|-------------|
| `chat-sdk` | Core SDK with Chat class and types |
| `@chat-sdk/slack` | Slack adapter |
| `@chat-sdk/teams` | Microsoft Teams adapter |
| `@chat-sdk/gchat` | Google Chat adapter |
| `@chat-sdk/state-memory` | In-memory state (development) |
| `@chat-sdk/state-redis` | Redis state (production) |

## Installation

```bash
pnpm add chat-sdk @chat-sdk/slack @chat-sdk/state-memory
```

## Quick Start

```typescript
import { Chat } from "chat-sdk";
import { createSlackAdapter } from "@chat-sdk/slack";
import { createMemoryState } from "@chat-sdk/state-memory";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
    }),
  },
  state: createMemoryState(),
});

// Handle @mentions
bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post("Hello! I'm now listening to this thread.");
});

// Handle messages in subscribed threads
bot.onSubscribed(async (thread, message) => {
  await thread.post(`You said: "${message.text}"`);
});

// Handle messages matching a pattern
bot.onNewMessage(/help/i, async (thread) => {
  await thread.post("Here's how I can help...");
});
```

## Webhook Setup

Expose webhook handlers for each platform:

```typescript
// Next.js App Router example
export async function POST(request: Request) {
  return bot.webhooks.slack(request, {
    waitUntil: (task) => after(() => task),
  });
}
```

## Configuration

### Slack

```typescript
createSlackAdapter({
  botToken: "xoxb-...",
  signingSecret: "...",
});
```

### Microsoft Teams

```typescript
createTeamsAdapter({
  appId: "...",
  appPassword: "...",
});
```

### Google Chat

Service account credentials (JSON key):

```typescript
createGoogleChatAdapter({
  credentials: {
    client_email: "...",
    private_key: "...",
    project_id: "...",
  },
});
```

Application Default Credentials (Workload Identity Federation, GCE, Cloud Run):

```typescript
createGoogleChatAdapter({
  useApplicationDefaultCredentials: true,
});
```

Custom auth client:

```typescript
import { google } from "googleapis";

createGoogleChatAdapter({
  auth: new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/chat.bot"],
  }),
});
```

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

## License

MIT
