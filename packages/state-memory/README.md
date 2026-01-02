# @chat-adapter/state-memory

In-memory state adapter for the [chat](https://github.com/vercel-labs/chat) SDK.

**Note:** This adapter is intended for development and testing only. For production, use [@chat-adapter/state-redis](https://github.com/vercel-labs/chat/tree/main/packages/state-redis) or [@chat-adapter/state-ioredis](https://github.com/vercel-labs/chat/tree/main/packages/state-ioredis).

## Installation

```bash
npm install chat @chat-adapter/state-memory
```

## Usage

```typescript
import { Chat } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";

const chat = new Chat({
  userName: "mybot",
  adapters: { /* ... */ },
  state: createMemoryState(),
});
```

## Features

- Thread subscriptions (in-memory storage)
- Distributed locking (single-process only)
- Zero configuration required

## Limitations

- **Not suitable for production**: State is lost on restart
- **Single process only**: Locks don't work across multiple instances
- **No persistence**: Subscriptions reset when process restarts

## When to Use

- Local development
- Unit testing
- Single-instance deployments (not recommended for production)

## License

MIT
