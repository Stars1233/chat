# Overview

We are building an abstraction library, similar to an ORM for databases, that allows me to program applicatons that interact with chat systems like Slack, Microsoft Teams, Google Chat, and Discord.

The primary use case are AI agents that help users of the chat app.

## Goals

- Programming language: TypeScript
- For very common tasks I should be able to write a program that doesn't care about whether the user is using Slack, Teams, etc.
- First-class support for listening to new @-mentions (first time mention in a thread) and then following subsequent messages in the thread
- For very advanced formatting, an escape hatch is fine, but it should be rarely used.
- Serverless compatibility. Should work with @vercel/slack-bolt for Slack and have a higher level API compatible with it.
- Compatibility with modern web frameworks for the webhooks (Next.js, Hono, etc.)
- Built-in ability to "lock a thread" which ensures that only one instance of the bot replies at a time even if multiple webhooks fire in short order (using e.g. the Redis state handler)

## Functionality

- Listening to all new threads or messages in a channel. Optionally, subscribing to all future messages in a thread
- Listening to new @-mentions in any message in a subscribed channel
- Ability to post to a thread
- Ability to make new threads
- Ability to unsubscribe from threads

## Implementation / Architecture

- I assume that all these chat apps have an API that is basically
  - A way to send messages, new thread or into a threa
  - Receive a webhook with new messages
  - But I have not researched this. Some may just give you all messages, some may have matchers.
- There should be a common interface that the end user of our library program and an adapter directory with one entry for Slack, Teams, etc. that implements it.

## Pseudo code

This isn't the final API, just me thinking of what would be nice.

### Setting up the bot

```typescript
[lib/bot.ts]

import {Chat} from "chat";
import {Bold} from "chat/jsx-runtime";
import {SlackAdapter} from "@chat-adapter/slack";
import {TeamsAdapter} from "@chat-adapter/teams";
import {GoogleChatAdapter} from "@chat-adapter/gchat";
import {createRedisState} from "@chat-adapter/state-redis";

export const bot = new Chat({
  userName: "mybot" // @mybot in Slack, Teams, etc.
  adapters: {
    slack: new SlackAdapter({
      secret: …
    }),
    teams: new TeamsAdapter({
      secret: …
    }),
    google: new GoogleChatAdapter({
      userName: "awesomeBot", // Called @awesomeBot on Google
      secret: …
    }),
  },
  conversationState: createRedisState()
});

// Threads are default-locked to this instance while callbacks run
bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post("Thanks for adding me");
});

bot.onNewMessage(/topic/, (thread, message) => {
  await thread.subscribe();
  await thread.post("Thanks for adding me");
});

bot.onSubscribedMessage(async (thread, newMessage) => {
  const reply = myAgent.generate({
    recentMessages: thread.recentMessages,
    newMessage
  });
  thread.post(`**Agent** response: ${reply}`);
})

```

### Interfaces

```typescript
interface Thread {
  recentMessages: Message[];
  allMessages: AsyncIteractor<Message>;
  subscribe: (thread: Thread, latestMessage: Message) => Promise<void>;
  unsubscribe: () => Promise<unknown>;
  post: (message: string | FormattedMessage) => Promise<void>;
  // Make recentMessages reflect the current state
  refresh: () => Promise<void>;
}

interface Message {
  text: string;
  formatted: FormattedMessage;
  author: {
    userName: string; // handle for @-mention
    fullName: string;
    userId: string; // Unique ID
    isBot: false | true | "unknown";
    isMe: boolean; // Whether the message was sent by this bot
  };
  metadata: {
    dateSent: Date; // and other metadata
  };
}
```

### One WebHook route per adapter

```typescript
[app / api / webhooks / slack / route.ts];

import { bot } from "@/lib/bot";

export const POST = bot.webhooks.slack;
```

```typescript
[app / api / webhooks / teams / route.ts];

import { bot } from "@/lib/bot";

export const POST = bot.webhooks.teams;
```

```typescript
[app / api / webhooks / google / route.ts];

import { bot } from "@/lib/bot";

export const POST = bot.webhooks.google;
```
