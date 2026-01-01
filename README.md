# Chat SDK

A unified SDK for building chat bots across Slack, Microsoft Teams, and Google Chat.

## Features

- Multi-platform support with a single codebase
- Mention-based thread subscriptions
- Reaction handling with type-safe emoji
- Cross-platform emoji helper for consistent rendering
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
| `@chat-sdk/state-redis` | Redis state using `redis` package (production) |
| `@chat-sdk/state-ioredis` | Redis state using `ioredis` package (production) |

## Quick Start

### 1. Create your bot (`lib/bot.ts`)

```typescript
import { Chat, emoji } from "chat-sdk";
import { createSlackAdapter } from "@chat-sdk/slack";
import { createTeamsAdapter } from "@chat-sdk/teams";
import { createGoogleChatAdapter } from "@chat-sdk/gchat";
import { createRedisState } from "@chat-sdk/state-redis";

export const bot = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
    }),
    teams: createTeamsAdapter({
      appId: process.env.TEAMS_APP_ID!,
      appPassword: process.env.TEAMS_APP_PASSWORD!,
    }),
    gchat: createGoogleChatAdapter({
      credentials: JSON.parse(process.env.GOOGLE_CHAT_CREDENTIALS!),
    }),
  },
  state: createRedisState({ url: process.env.REDIS_URL! }),
});

// Handle @mentions - works across all platforms
bot.onNewMention(async (thread) => {
  await thread.subscribe();
  // Emoji auto-converts to platform format: :wave: on Slack, 👋 on Teams/GChat
  await thread.post(`${emoji.wave} Hello! I'm now listening to this thread.`);
});

// Handle follow-up messages in subscribed threads
bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`${emoji.check} You said: ${message.text}`);
});

// Handle emoji reactions
bot.onReaction(["thumbs_up", "heart", "fire"], async (event) => {
  if (!event.added) return; // Only respond to added reactions
  await event.adapter.addReaction(event.threadId, event.messageId, event.emoji);
});
```

### 2. Create a webhook handler (`app/api/webhooks/[platform]/route.ts`)

```typescript
import { after } from "next/server";
import { bot } from "@/lib/bot";

type Platform = keyof typeof bot.webhooks;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;

  const handler = bot.webhooks[platform as Platform];
  if (!handler) {
    return new Response(`Unknown platform: ${platform}`, { status: 404 });
  }

  return handler(request, {
    waitUntil: (task) => after(() => task),
  });
}
```

This creates endpoints for each platform:
- `POST /api/webhooks/slack`
- `POST /api/webhooks/teams`
- `POST /api/webhooks/gchat`

The `waitUntil` option ensures message processing completes after the response is sent (required for serverless).

## Setup

See [SETUP.md](./SETUP.md) for platform configuration instructions including:

- Slack app creation and OAuth scopes
- Microsoft Teams Azure Bot setup
- Google Chat service account and Pub/Sub configuration
- Environment variables reference

## Emoji Helper

The `emoji` helper provides type-safe, cross-platform emoji that automatically convert to each platform's format. Use it with `thread.post()`:

```
await thread.post(`${emoji.thumbs_up} Great job!`);
// Slack: ":+1: Great job!"
// Teams/GChat: "👍 Great job!"
```

**Available emoji:**

| Name | Emoji | Name | Emoji |
|------|-------|------|-------|
| `emoji.thumbs_up` | 👍 | `emoji.thumbs_down` | 👎 |
| `emoji.heart` | ❤️ | `emoji.smile` | 😊 |
| `emoji.laugh` | 😂 | `emoji.thinking` | 🤔 |
| `emoji.eyes` | 👀 | `emoji.fire` | 🔥 |
| `emoji.check` | ✅ | `emoji.x` | ❌ |
| `emoji.question` | ❓ | `emoji.party` | 🎉 |
| `emoji.rocket` | 🚀 | `emoji.star` | ⭐ |
| `emoji.wave` | 👋 | `emoji.clap` | 👏 |
| `emoji["100"]` | 💯 | `emoji.warning` | ⚠️ |

For one-off custom emoji, use `emoji.custom("name")`.

### Custom Emoji (Type-Safe)

For workspace-specific emoji with full type safety, use `createEmoji()`:

```typescript
import { createEmoji } from "chat-sdk";

// Create emoji helper with custom emoji
const myEmoji = createEmoji({
  unicorn: { slack: "unicorn_face", gchat: "🦄" },
  company_logo: { slack: "company", gchat: "🏢" },
});

// Type-safe access to custom emoji (with autocomplete)
const message = `${myEmoji.unicorn} Magic! ${myEmoji.company_logo}`;
// Slack: ":unicorn_face: Magic! :company:"
// GChat: "🦄 Magic! 🏢"
```

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
