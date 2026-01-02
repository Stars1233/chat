# @chat-adapter/state-ioredis

Redis state adapter for the [chat](https://github.com/vercel-labs/chat) SDK using [ioredis](https://www.npmjs.com/package/ioredis).

## Installation

```bash
npm install chat @chat-adapter/state-ioredis ioredis
```

## Usage

```typescript
import { Chat } from "chat";
import { createIORedisState } from "@chat-adapter/state-ioredis";

const chat = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createIORedisState({
    url: process.env.REDIS_URL!,
  }),
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `url` | Yes* | Redis connection URL |
| `client` | No | Existing ioredis client instance |
| `keyPrefix` | No | Prefix for all keys (default: `"chat-sdk"`) |

*Either `url` or `client` is required.

### Using Connection URL

```typescript
const state = createIORedisState({
  url: "redis://localhost:6379",
});
```

### Using Existing Client

```typescript
import Redis from "ioredis";

const client = new Redis("redis://localhost:6379");

const state = createIORedisState({ client });
```

## When to Use ioredis vs redis

Use `@chat-adapter/state-ioredis` when:

- You're already using ioredis in your project
- You need Redis Cluster support
- You need Redis Sentinel support
- You prefer ioredis API

Use `@chat-adapter/state-redis` when:

- You want the official Redis client
- You're starting a new project
- You don't need Cluster/Sentinel

## Features

- Thread subscriptions (persistent)
- Distributed locking (works across instances)
- Automatic reconnection
- Redis Cluster support
- Redis Sentinel support
- Key prefix namespacing

## Key Structure

```
{keyPrefix}:subscriptions     - SET of subscribed thread IDs
{keyPrefix}:lock:{threadId}   - Lock key with TTL
```

## License

MIT
