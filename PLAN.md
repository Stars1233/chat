# Implementation Plan

## Package Structure

Monorepo with separate publishable packages:

```
packages/
  chat-sdk/              # Core library
  adapter-slack/         # @chat-sdk/slack
  adapter-teams/         # @chat-sdk/teams
  adapter-gchat/         # @chat-sdk/gchat
  adapter-discord/       # @chat-sdk/discord (lower priority)
  state-redis/           # @chat-sdk/state-redis
  state-memory/          # @chat-sdk/state-memory (for dev/testing)
```

Tooling: pnpm workspaces, tsup for builds, vitest for testing.

---

## Phase 1: Core Abstractions

### 1.1 Define Core Interfaces

```typescript
// packages/chat-sdk/src/types.ts

interface ChatConfig {
  userName: string;
  adapters: Record<string, Adapter>;
  state: StateAdapter;
}

interface Adapter {
  readonly name: string;
  readonly userName: string; // Can override global userName

  // Lifecycle
  initialize(chat: ChatInstance): Promise<void>;

  // Webhook handling
  handleWebhook(request: Request): Promise<Response>;

  // Actions
  postMessage(threadId: string, message: PostableMessage): Promise<Message>;
  editMessage(messageId: string, message: PostableMessage): Promise<Message>;
  deleteMessage(messageId: string): Promise<void>;
  addReaction(messageId: string, emoji: string): Promise<void>;
  removeReaction(messageId: string, emoji: string): Promise<void>;
  startTyping(threadId: string): Promise<void>;
  fetchMessages(threadId: string, options: FetchOptions): Promise<Message[]>;
  fetchThread(threadId: string): Promise<ThreadInfo>;

  // Platform-specific thread ID encoding/decoding
  encodeThreadId(platformData: unknown): string;
  decodeThreadId(threadId: string): unknown;
}

interface StateAdapter {
  // Subscriptions
  subscribe(threadId: string): Promise<void>;
  unsubscribe(threadId: string): Promise<void>;
  isSubscribed(threadId: string): Promise<boolean>;

  // Locking
  acquireLock(threadId: string, ttlMs: number): Promise<Lock | null>;
  releaseLock(lock: Lock): Promise<void>;
}

interface Lock {
  threadId: string;
  token: string;
  expiresAt: number;
}
```

### 1.2 Thread and Message Types

```typescript
// Thread ID format: "adapter:channel:thread"
// e.g., "slack:C1234567:1234567890.123456"

interface Thread {
  readonly id: string;
  readonly adapter: Adapter;
  readonly channelId: string;

  // Cached messages from initial webhook + any fetched
  recentMessages: Message[];

  // Lazy async iterator for full history
  allMessages: AsyncIterable<Message>;

  // Actions
  subscribe(): Promise<void>;
  unsubscribe(): Promise<void>;
  post(message: string | PostableMessage): Promise<SentMessage>;
  startTyping(): Promise<void>;
  refresh(): Promise<void>;
}

interface Message {
  readonly id: string;
  readonly threadId: string;

  text: string;      // Plain text (markdown stripped)
  markdown: string;  // Normalized markdown representation
  raw: unknown;      // Platform-specific original (escape hatch)

  author: Author;
  metadata: MessageMetadata;
}

interface Author {
  userId: string;
  userName: string;
  fullName: string;
  isBot: boolean | "unknown";
  isMe: boolean; // Is this the bot itself?
}

interface MessageMetadata {
  dateSent: Date;
  edited: boolean;
  editedAt?: Date;
}

// Returned from thread.post() - allows editing/deleting
interface SentMessage extends Message {
  edit(newText: string | PostableMessage): Promise<SentMessage>;
  delete(): Promise<void>;
  addReaction(emoji: string): Promise<void>;
  removeReaction(emoji: string): Promise<void>;
}
```

### 1.3 Message Formatting

Simple markdown-based formatting. Covers 80%+ of use cases with minimal complexity.

```typescript
// Primary: just pass a markdown string
await thread.post("Hello **world**! Check out [this link](https://example.com)");

// With attachments
await thread.post({
  text: "Here's the report:",
  attachments: [
    { type: "file", url: "https://...", name: "report.pdf" }
  ]
});

// Typing indicator
await thread.startTyping();
```

**Supported markdown subset (common across all platforms):**
- `**bold**`
- `_italic_`
- `~~strikethrough~~`
- `` `inline code` ``
- ` ```code blocks``` `
- `[links](url)`
- `> quotes`
- Ordered/unordered lists

**Types:**

```typescript
type PostableMessage = string | {
  text: string;
  attachments?: Attachment[];
};

interface Attachment {
  type: "image" | "file";
  url?: string;
  data?: Buffer | Blob;  // For uploads
  name?: string;
  mimeType?: string;
}

// Incoming messages preserve original + provide plain text
interface Message {
  text: string;           // Plain text (markdown stripped)
  markdown: string;       // Normalized markdown representation
  raw: unknown;           // Platform-specific original (escape hatch)
  // ... other fields
}
```

**Mentions:**
- Use `<@userId>` syntax in markdown for user mentions
- Adapters translate to/from platform-specific format
- `thread.mentionUser(userId)` helper returns the correct mention string

Each adapter implements:
- `parseIncoming(raw: unknown): { text: string; markdown: string }` - normalize to markdown
- `renderOutgoing(markdown: string): unknown` - convert markdown to platform format

---

## Phase 2: Chat Class (Main Entry Point)

```typescript
// packages/chat-sdk/src/chat.ts

class Chat {
  private adapters: Map<string, Adapter>;
  private state: StateAdapter;
  private handlers: {
    onNewMention: Array<(thread: Thread, message: Message) => Promise<void>>;
    onNewMessage: Array<{
      pattern: RegExp;
      handler: (thread: Thread, message: Message) => Promise<void>;
    }>;
    onSubscribed: Array<(thread: Thread, message: Message) => Promise<void>>;
  };

  constructor(config: ChatConfig);

  // Event registration
  onNewMention(
    handler: (thread: Thread, message: Message) => Promise<void>
  ): void;
  onNewMessage(
    pattern: RegExp,
    handler: (thread: Thread, message: Message) => Promise<void>
  ): void;
  onSubscribed(
    handler: (thread: Thread, message: Message) => Promise<void>
  ): void;

  // Webhook handlers (exposed for routing)
  readonly webhooks: Record<string, (request: Request) => Promise<Response>>;

  // Internal: called by adapters when webhook received
  async handleIncomingMessage(
    adapter: Adapter,
    threadInfo: ThreadInfo,
    message: Message
  ): Promise<void>;
}
```

### Webhook Flow

1. Webhook hits `bot.webhooks.slack` (or other adapter)
2. Adapter parses request, verifies signature, extracts message
3. Adapter calls `chat.handleIncomingMessage(adapter, threadInfo, message)`
4. Chat class:
   - Constructs `Thread` object
   - Acquires lock on thread (blocks if another instance is processing)
   - Checks if subscribed → routes to `onSubscribed` handlers
   - Checks for @-mention of bot → routes to `onNewMention` handlers
   - Checks message against `onNewMessage` patterns → routes to matching handlers
   - Releases lock when all handlers complete

---

## Phase 3: State Adapters

### 3.1 StateAdapter Interface

```typescript
interface StateAdapter {
  // Connection lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Subscriptions (persistent across restarts)
  subscribe(threadId: string): Promise<void>;
  unsubscribe(threadId: string): Promise<void>;
  isSubscribed(threadId: string): Promise<boolean>;
  listSubscriptions(adapterName?: string): AsyncIterable<string>;

  // Distributed locking
  acquireLock(threadId: string, ttlMs: number): Promise<Lock | null>;
  releaseLock(lock: Lock): Promise<void>;
  extendLock(lock: Lock, ttlMs: number): Promise<boolean>;
}
```

### 3.2 Redis Implementation

```typescript
// packages/state-redis/src/index.ts

import { createClient, RedisClientType } from "redis";

class RedisStateAdapter implements StateAdapter {
  private client: RedisClientType;
  private keyPrefix: string;

  constructor(options: { url: string; keyPrefix?: string });

  // Subscriptions stored as SET: "chat-sdk:subscriptions"
  // Locks use SETNX with TTL: "chat-sdk:lock:{threadId}"
}
```

### 3.3 Memory Implementation (for development)

```typescript
// packages/state-memory/src/index.ts

class MemoryStateAdapter implements StateAdapter {
  private subscriptions = new Set<string>();
  private locks = new Map<string, Lock>();

  // Simple in-memory implementation
  // Warns in console that state won't persist
}
```

---

## Phase 4: Platform Adapters

### 4.1 Slack Adapter

**Dependencies:** `@slack/web-api`, compatible with `@vercel/slack-bolt`

```typescript
// packages/adapter-slack/src/index.ts

interface SlackAdapterConfig {
  botToken: string; // xoxb-...
  signingSecret: string; // For webhook verification
  userName?: string; // Override bot username
}

class SlackAdapter implements Adapter {
  private client: WebClient;

  // Thread ID format: "slack:{channelId}:{threadTs}"
  // If message is not in thread, threadTs = messageTs

  handleWebhook(request: Request): Promise<Response> {
    // 1. Verify signature using signingSecret
    // 2. Handle URL verification challenge
    // 3. Parse event (message, app_mention, etc.)
    // 4. Route to chat.handleIncomingMessage
    // 5. Return 200 quickly (Slack expects <3s response)
  }

  postMessage(threadId: string, message: PostableMessage): Promise<Message> {
    // Use chat.postMessage API
    // Convert markdown to Slack mrkdwn format
  }

  fetchMessages(threadId: string, options: FetchOptions): Promise<Message[]> {
    // Use conversations.replies API
  }
}
```

**Slack-specific considerations:**

- Must respond to webhooks within 3 seconds (use background processing if needed)
- Supports Block Kit for rich formatting
- Thread = replies to a message (identified by thread_ts)
- `app_mention` event for @-mentions

### 4.2 Microsoft Teams Adapter

**Dependencies:** `botbuilder` or direct REST API calls

```typescript
// packages/adapter-teams/src/index.ts

interface TeamsAdapterConfig {
  appId: string;
  appPassword: string;
  userName?: string;
}

class TeamsAdapter implements Adapter {
  // Thread ID format: "teams:{conversationId}:{replyToId}"

  handleWebhook(request: Request): Promise<Response> {
    // 1. Validate JWT token from Microsoft
    // 2. Parse Activity object
    // 3. Route message activities to chat.handleIncomingMessage
  }

  postMessage(threadId: string, message: PostableMessage): Promise<Message> {
    // Use Bot Framework REST API
    // Convert markdown to Teams HTML subset
  }
}
```

**Teams-specific considerations:**

- Uses Bot Framework protocol
- Replies use `replyToId` for threading
- Supports Adaptive Cards for rich content
- @-mentions include `<at>` tags in message

### 4.3 Google Chat Adapter

**Dependencies:** `googleapis` or direct REST

```typescript
// packages/adapter-gchat/src/index.ts

interface GoogleChatAdapterConfig {
  credentials: GoogleAuthCredentials;
  userName?: string;
}

class GoogleChatAdapter implements Adapter {
  // Thread ID format: "gchat:{spaceName}:{threadName}"

  handleWebhook(request: Request): Promise<Response> {
    // 1. Verify request (Bearer token or service account)
    // 2. Parse event payload
    // 3. Route MESSAGE events to chat.handleIncomingMessage
  }

  postMessage(threadId: string, message: PostableMessage): Promise<Message> {
    // Use Chat API spaces.messages.create
    // Convert markdown to Google Chat text format
  }
}
```

**Google Chat-specific considerations:**

- Uses Google Cloud service account for auth
- Threads are identified by `thread.name`
- Cards for rich formatting
- @-mentions detected via annotation type USER_MENTION

### 4.4 Discord Adapter (Lower Priority)

**Dependencies:** `discord.js` or direct REST API

```typescript
// packages/adapter-discord/src/index.ts

interface DiscordAdapterConfig {
  botToken: string;
  publicKey: string; // For webhook verification
  userName?: string;
}

class DiscordAdapter implements Adapter {
  // Thread ID format: "discord:{guildId}:{channelId}:{threadId?}"
  // For DMs: "discord:dm:{channelId}"

  handleWebhook(request: Request): Promise<Response> {
    // 1. Verify Ed25519 signature
    // 2. Handle PING interaction
    // 3. Parse MESSAGE_CREATE events
    // 4. Route to chat.handleIncomingMessage
  }
}
```

**Discord-specific considerations:**

- Threads can auto-archive (adapter should unarchive before posting)
- DMs don't support threads (treat DM channel as the "thread")
- Uses Ed25519 for webhook verification
- Gateway vs HTTP interactions

---

## Phase 5: Testing Strategy

### 5.1 Unit Tests

- Markdown → platform format conversion for each adapter
- Platform format → normalized markdown parsing
- State adapter implementations (use in-memory for tests)
- Thread ID encoding/decoding
- Lock acquisition/release logic

### 5.2 Integration Tests

- Mock webhook payloads for each platform
- End-to-end flow: webhook → handler → post response
- Subscription persistence across "restarts"
- Concurrent webhook handling (lock contention)

### 5.3 Platform Sandboxes

Document how to set up test workspaces/servers:

- Slack: Create test workspace, install app
- Teams: Use Bot Framework Emulator
- Google Chat: Use developer preview space
- Discord: Create test server

---

## Phase 6: Documentation & Examples

### 6.1 README

- Quick start with Slack (most common)
- Concepts: adapters, threads, messages, state
- API reference

### 6.2 Examples

```
examples/
  nextjs-slack/           # Next.js App Router + Slack
  nextjs-multi/           # Next.js with multiple adapters
  hono-cloudflare/        # Hono on Cloudflare Workers
  express-simple/         # Express.js basic setup
```

### 6.3 Migration Guide

For users coming from:

- `@slack/bolt`
- `botbuilder`
- Raw Discord.js

---

## Implementation Order

1. **Core types & interfaces** (2-3 files, get the shapes right)
2. **Memory state adapter** (enables testing without Redis)
3. **Slack adapter** (most familiar, best documented API)
4. **Chat class** (wire up the event routing)
5. **Integration tests with Slack**
6. **Teams adapter**
7. **Google Chat adapter**
8. **Redis state adapter**
9. **Discord adapter** (last, lower priority)
10. **Examples & docs**

---

## Decisions Made

1. **Serverless**: Use `waitUntil` / Next.js `after()` to respond quickly while processing in background
2. **Message editing**: `thread.post()` returns `SentMessage` with `edit()` and `delete()` methods
3. **Reactions**: Supported via `addReaction()` / `removeReaction()` on `SentMessage`
4. **File uploads**: Support both URL references and `Buffer`/`Blob` uploads
5. **Rate limiting**: Surface to users (don't hide behind internal retries)
6. **Typing indicators**: Supported via `thread.startTyping()`
7. **Formatting**: Simple markdown strings (no complex AST)
