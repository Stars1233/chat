# @chat-adapter/teams

Microsoft Teams adapter for the [chat](https://github.com/vercel-labs/chat) SDK.

## Installation

```bash
npm install chat @chat-adapter/teams
```

## Usage

```typescript
import { Chat } from "chat";
import { createTeamsAdapter } from "@chat-adapter/teams";

const chat = new Chat({
  userName: "mybot",
  adapters: {
    teams: createTeamsAdapter({
      appId: process.env.TEAMS_APP_ID!,
      appPassword: process.env.TEAMS_APP_PASSWORD!,
    }),
  },
});

// Handle @mentions
chat.onNewMention(async (thread, message) => {
  await thread.post("Hello from Teams!");
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `appId` | Yes | Azure Bot App ID |
| `appPassword` | Yes | Azure Bot App Password |
| `tenantId` | No | Azure AD Tenant ID (for single-tenant apps) |

## Setup

### 1. Create Azure Bot

1. Go to [Azure Portal](https://portal.azure.com)
2. Create a new **Azure Bot** resource
3. Note the **App ID** and create an **App Password**

### 2. Configure Bot Messaging Endpoint

Set the messaging endpoint to your webhook URL:
```
https://your-domain.com/api/webhooks/teams
```

### 3. Create Teams App

1. Go to [Teams Developer Portal](https://dev.teams.microsoft.com)
2. Create a new app
3. Configure bot with your Azure Bot App ID
4. Install the app to your Teams workspace

## Features

- Message posting and editing
- Thread subscriptions
- Reaction events (receive only)
- File attachments
- Rich cards (Adaptive Cards)
- Action callbacks (card actions)
- Typing indicators
- Direct messages
- Proactive messaging

## Limitations

- **Adding reactions**: Teams Bot Framework doesn't support bots adding reactions
- **Message history**: No API to fetch message history

## License

MIT
