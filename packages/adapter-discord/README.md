# @chat-adapter/discord

Discord adapter for the [chat](https://github.com/vercel-labs/chat) SDK.

## Installation

```bash
npm install chat @chat-adapter/discord
```

## Usage

```typescript
import { Chat } from "chat";
import { createDiscordAdapter } from "@chat-adapter/discord";

const chat = new Chat({
  userName: "mybot",
  adapters: {
    discord: createDiscordAdapter({
      botToken: process.env.DISCORD_BOT_TOKEN!,
      publicKey: process.env.DISCORD_PUBLIC_KEY!,
      applicationId: process.env.DISCORD_APPLICATION_ID!,
      // Optional: trigger on role mentions too
      mentionRoleIds: process.env.DISCORD_MENTION_ROLE_IDS?.split(","),
    }),
  },
});

// Handle @mentions
chat.onNewMention(async (thread, message) => {
  await thread.post("Hello from Discord!");
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `botToken` | Yes | Discord bot token |
| `publicKey` | Yes | Discord application public key (for webhook signature verification) |
| `applicationId` | Yes | Discord application ID |
| `mentionRoleIds` | No | Array of role IDs that should trigger mention handlers |

## Discord Application Setup

### 1. Create Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and give it a name
3. Note the **Application ID** from the General Information page
4. Copy the **Public Key** from the General Information page

### 2. Create Bot

1. Go to the **Bot** section in the left sidebar
2. Click **Reset Token** to generate a new bot token
3. Copy and save the token (you won't see it again)
4. Enable these **Privileged Gateway Intents**:
   - Message Content Intent
   - Server Members Intent (if needed)

### 3. Configure Interactions Endpoint

1. Go to **General Information**
2. Set **Interactions Endpoint URL** to: `https://your-domain.com/api/webhooks/discord`
3. Discord will send a PING request to verify the endpoint

### 4. Add Bot to Server

1. Go to **OAuth2 > URL Generator**
2. Select scopes: `bot`, `applications.commands`
3. Select bot permissions:
   - Send Messages
   - Send Messages in Threads
   - Create Public Threads
   - Read Message History
   - Add Reactions
   - Attach Files
4. Copy the generated URL and open it to add the bot to your server

## Environment Variables

```bash
# Required
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_PUBLIC_KEY=your-application-public-key
DISCORD_APPLICATION_ID=your-application-id

# Optional: trigger on role mentions (comma-separated)
DISCORD_MENTION_ROLE_IDS=1234567890,0987654321

# For Gateway mode with Vercel Cron
CRON_SECRET=your-random-secret
```

## Architecture: HTTP Interactions vs Gateway

Discord has two ways to receive events:

### HTTP Interactions (Default)
- Receives button clicks, slash commands, and verification pings
- Works out of the box with serverless
- **Does NOT receive regular messages** - only interactions

### Gateway WebSocket (Required for Messages)
- Required to receive regular messages and reactions
- Requires a persistent connection
- In serverless environments, use a cron job to maintain the connection

## Gateway Setup for Serverless

For Vercel/serverless deployments, set up a cron job to maintain the Gateway connection:

### 1. Create Gateway Route

```typescript
// app/api/discord/gateway/route.ts
import { NextResponse } from "next/server";
import { after } from "next/server";
import { discord } from "@/lib/bot";

export const maxDuration = 800; // Maximum Vercel function duration

export async function GET(request: Request): Promise<Response> {
  // Validate cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Start Gateway listener (runs for 10 minutes)
  const durationMs = 600 * 1000;
  const webhookUrl = `https://${process.env.VERCEL_URL}/api/webhooks/discord`;

  return discord.startGatewayListener(
    { waitUntil: (task) => after(() => task) },
    durationMs,
    undefined,
    webhookUrl
  );
}
```

### 2. Configure Vercel Cron

Create `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/discord/gateway",
      "schedule": "*/9 * * * *"
    }
  ]
}
```

This runs every 9 minutes, ensuring overlap with the 10-minute listener duration.

### 3. Add Environment Variables

Add `CRON_SECRET` to your Vercel project settings.

## Role Mentions

By default, only direct user mentions (`@BotName`) trigger `onNewMention` handlers. To also trigger on role mentions (e.g., `@AI`):

1. Create a role in your Discord server (e.g., "AI")
2. Assign the role to your bot
3. Copy the role ID (right-click role in server settings with Developer Mode enabled)
4. Add the role ID to `DISCORD_MENTION_ROLE_IDS`

```typescript
createDiscordAdapter({
  botToken: process.env.DISCORD_BOT_TOKEN!,
  publicKey: process.env.DISCORD_PUBLIC_KEY!,
  applicationId: process.env.DISCORD_APPLICATION_ID!,
  mentionRoleIds: ["1457473602180878604"], // Your role ID
});
```

## Features

- Message posting and editing
- Thread creation and management
- Reaction handling (add/remove/events)
- File attachments
- Rich embeds (cards with buttons)
- Action callbacks (button interactions)
- Direct messages
- Role mention support

## Testing

Run a local tunnel (e.g., ngrok) to test webhooks:

```bash
ngrok http 3000
```

Update the Interactions Endpoint URL in the Discord Developer Portal to your ngrok URL.

## Troubleshooting

### Bot not responding to messages

1. **Check Gateway connection**: Messages require the Gateway WebSocket, not just HTTP interactions
2. **Verify Message Content Intent**: Enable this in the Bot settings
3. **Check bot permissions**: Ensure the bot can read messages in the channel

### Role mentions not triggering

1. **Verify role ID**: Enable Developer Mode in Discord settings, then right-click the role
2. **Check mentionRoleIds config**: Ensure the role ID is in the array
3. **Confirm bot has the role**: The bot must have the role assigned to be mentioned via that role

### Signature verification failing

1. **Check public key format**: Should be a 64-character hex string (lowercase)
2. **Verify endpoint URL**: Must exactly match what's configured in Discord Developer Portal
3. **Check for body parsing**: Don't parse the request body before verification

## License

MIT
