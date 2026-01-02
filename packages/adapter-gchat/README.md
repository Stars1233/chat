# @chat-adapter/gchat

Google Chat adapter for the [chat](https://github.com/vercel-labs/chat) SDK.

## Installation

```bash
npm install chat @chat-adapter/gchat
```

## Usage

```typescript
import { Chat } from "chat";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";

const chat = new Chat({
  userName: "mybot",
  adapters: {
    gchat: createGoogleChatAdapter({
      credentials: JSON.parse(process.env.GOOGLE_CHAT_CREDENTIALS!),
    }),
  },
});

// Handle @mentions
chat.onNewMention(async (thread, message) => {
  await thread.post("Hello from Google Chat!");
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `credentials` | Yes* | Service account credentials JSON |
| `useADC` | No | Use Application Default Credentials instead |
| `pubsubTopic` | No | Pub/Sub topic for Workspace Events |
| `impersonateUser` | No | User email for domain-wide delegation |

*Either `credentials` or `useADC: true` is required.

## Setup

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable the **Google Chat API**

### 2. Create a Service Account

1. Go to IAM & Admin → Service Accounts
2. Create a new service account
3. Download the JSON key file
4. Set as `GOOGLE_CHAT_CREDENTIALS` environment variable

### 3. Configure Chat App

1. Go to [Google Chat API Configuration](https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat)
2. Configure your app:
   - App name and avatar
   - HTTP endpoint URL for webhooks
   - Enable interactive features

### 4. (Optional) Pub/Sub for Workspace Events

For reaction events, you need Workspace Events via Pub/Sub:

1. Enable **Pub/Sub API** and **Workspace Events API**
2. Create a Pub/Sub topic
3. Set `pubsubTopic` in adapter options
4. Configure subscription to your webhook endpoint

## Features

- Message posting and editing
- Thread subscriptions
- Reaction events (via Workspace Events)
- File attachments
- Rich cards (Google Chat Cards)
- Action callbacks (card buttons)
- Direct messages
- Space management

## Limitations

- **Typing indicators**: Not supported by Google Chat API
- **Adding reactions**: Requires domain-wide delegation (appears from impersonated user, not bot)

## License

MIT
