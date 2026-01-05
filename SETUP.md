# Chat SDK Setup Guide

This guide covers environment setup for the Chat SDK. For platform-specific setup instructions, see the individual adapter documentation.

## Environment Variables

Create a `.env.local` file in `examples/nextjs-chat/` with the following variables:

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...

# Microsoft Teams
TEAMS_APP_ID=...
TEAMS_APP_PASSWORD=...
TEAMS_APP_TENANT_ID=...

# Google Chat
GOOGLE_CHAT_CREDENTIALS={"type":"service_account",...}
GOOGLE_CHAT_PUBSUB_TOPIC=projects/your-project/topics/chat-events  # Optional
GOOGLE_CHAT_IMPERSONATE_USER=admin@yourdomain.com  # Optional

# Discord
DISCORD_BOT_TOKEN=...
DISCORD_PUBLIC_KEY=...
DISCORD_APPLICATION_ID=...
DISCORD_MENTION_ROLE_IDS=...  # Optional: comma-separated role IDs
CRON_SECRET=...  # Required for Gateway cron in serverless

# Redis (required for serverless deployments)
REDIS_URL=redis://localhost:6379
```

## Platform Setup

Each adapter has its own README with detailed setup instructions:

| Platform | Adapter Package | Setup Guide |
|----------|-----------------|-------------|
| Slack | `@chat-adapter/slack` | [README](./packages/adapter-slack/README.md) |
| Microsoft Teams | `@chat-adapter/teams` | [README](./packages/adapter-teams/README.md) |
| Google Chat | `@chat-adapter/gchat` | [README](./packages/adapter-gchat/README.md) |
| Discord | `@chat-adapter/discord` | [README](./packages/adapter-discord/README.md) |

## Vercel Deployment

### Configure Environment Variables

1. Go to **Settings** → **Environment Variables** in your Vercel project
2. Add all variables from the `.env.local` section above
3. Select appropriate environments (Production, Preview, Development)

### Set Root Directory

If deploying from the monorepo root:

1. Go to **Settings** → **General**
2. Set **Root Directory** to `examples/nextjs-chat`

## Testing Your Setup

### Slack

```
@YourBot hello
```

### Teams

Chat directly with the bot or @mention in a channel.

### Google Chat

```
@YourBot hello
```

### Discord

```
@YourBot hello
```

The bot will respond and create a thread for the conversation.

## Troubleshooting

### Redis connection errors

- Verify `REDIS_URL` is correct
- For Vercel, use Upstash Redis or similar serverless-compatible Redis
- Check firewall/network rules allow connections

### Duplicate messages

The SDK includes deduplication, but ensure Redis is properly configured for production deployments.

For platform-specific troubleshooting, see the individual adapter READMEs linked above.
