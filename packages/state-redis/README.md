# @chat-adapter/state-redis

Redis state adapter for the [chat](https://github.com/vercel-labs/chat) SDK using the official [redis](https://www.npmjs.com/package/redis) package.

## Installation

```bash
npm install chat @chat-adapter/state-redis redis
```

## Usage

```typescript
import { Chat } from "chat";
import { createRedisState } from "@chat-adapter/state-redis";

const chat = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createRedisState({
    url: process.env.REDIS_URL!,
  }),
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `url` | Yes* | Redis connection URL |
| `client` | No | Existing redis client instance |
| `keyPrefix` | No | Prefix for all keys (default: `"chat-sdk"`) |

*Either `url` or `client` is required.

### Using Connection URL

```typescript
const state = createRedisState({
  url: "redis://localhost:6379",
});
```

### Using Existing Client

```typescript
import { createClient } from "redis";

const client = createClient({ url: "redis://localhost:6379" });
await client.connect();

const state = createRedisState({ client });
```

## Features

- Thread subscriptions (persistent)
- Distributed locking (works across instances)
- Automatic reconnection
- Key prefix namespacing

## Key Structure

```
{keyPrefix}:subscriptions     - SET of subscribed thread IDs
{keyPrefix}:lock:{threadId}   - Lock key with TTL
```

## Production Recommendations

- Use Redis 6.0+ for best performance
- Enable Redis persistence (RDB or AOF)
- Use Redis Cluster for high availability
- Set appropriate memory limits

## License

MIT
