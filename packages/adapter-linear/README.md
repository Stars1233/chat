# @chat-adapter/linear

Linear adapter for the [chat](https://github.com/vercel-labs/chat) SDK. Enables bots to respond to @mentions in Linear issue comment threads.

## Installation

```bash
npm install chat @chat-adapter/linear
```

## Usage

```typescript
import { Chat } from "chat";
import { createLinearAdapter } from "@chat-adapter/linear";
import { MemoryState } from "@chat-adapter/state-memory";

const chat = new Chat({
  userName: "my-bot",
  adapters: {
    linear: createLinearAdapter({
      apiKey: process.env.LINEAR_API_KEY!,
      webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
      userName: "my-bot",
      logger: console,
    }),
  },
  state: new MemoryState(),
  logger: "info",
});

// Handle @mentions in issue comments
chat.onNewMention(async (thread, message) => {
  await thread.post("Hello from Linear!");
});
```

## Configuration

| Option          | Required | Description                                                                                              |
| --------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `apiKey`        | Yes\*    | [Personal API key](https://linear.app/docs/api-and-webhooks) from Settings > Security & Access           |
| `accessToken`   | Yes\*    | [OAuth access token](https://linear.app/developers/oauth-2-0-authentication) from the OAuth flow        |
| `webhookSecret` | Yes      | [Webhook signing secret](https://linear.app/developers/webhooks#securing-webhooks) for verification      |
| `userName`      | Yes      | Bot display name for @mention detection                                                                  |

\*Either `apiKey` or `accessToken` is required.

## Environment Variables

```bash
# API Key auth (simplest)
LINEAR_API_KEY=lin_api_xxxxxxxxxxxx

# OR OAuth auth
LINEAR_ACCESS_TOKEN=lin_oauth_xxxxxxxxxxxx

# Webhook secret (required)
LINEAR_WEBHOOK_SECRET=your-webhook-secret
```

## Linear Setup

### Option A: Personal API Key

Best for personal projects, testing, or single-workspace bots.

1. Go to [Settings > Security & Access](https://linear.app/settings/account/security) in Linear
2. Scroll to **Personal API keys** and click **Create key**
3. Select **Only select permissions** and enable:
   - **Create issues** - Create and update issues
   - **Create comments** - Create and update issue comments
4. Under **Team access**, choose **All teams** or select specific teams
5. Click **Create** and set `LINEAR_API_KEY` environment variable

> **Note:** When using a personal API key, all actions are attributed to you as an individual.

### Option B: OAuth Application

Better for multi-workspace integrations and public apps.

1. Go to [Settings > API > OAuth applications](https://linear.app/settings/api/applications/new)
2. Create a new OAuth2 application
3. Configure redirect URLs
4. Request the following [scopes](https://linear.app/developers/oauth-2-0-authentication#redirect-user-access-requests-to-linear):
   - `read` - Read access (always required)
   - `comments:create` - Create and update issue comments
   - `issues:create` - Create and update issues (if your bot creates issues)
5. Implement the [OAuth flow](https://linear.app/developers/oauth-2-0-authentication) to get an access token
6. Set `LINEAR_ACCESS_TOKEN` environment variable

### Webhook Setup

See the [Linear Webhooks documentation](https://linear.app/developers/webhooks) for detailed instructions.

> **Note:** Webhook management requires **workspace admin** access. If you don't see the API settings page, ask a workspace admin to create the webhook for you.

1. Go to **Settings > API** in your Linear workspace and click **Create webhook**
2. Fill in:
   - **Label**: A descriptive name (e.g., "Chat Bot")
   - **URL**: `https://your-domain.com/api/webhooks/linear`
3. Copy the **Signing secret** and set it as `LINEAR_WEBHOOK_SECRET`
4. Under **Data change events**, select:
   - **Comments** (required - for issue comments)
   - **Issues** (recommended - for mentions in issue descriptions)
   - **Emoji reactions** (optional - for reaction handling)
5. Under **Team selection**, choose **All public teams** or a specific team
6. Click **Create webhook**

## Features

- Message posting and editing
- Message deletion
- [Reaction handling](https://linear.app/docs/comment-on-issues) (add reactions via emoji)
- Issue comment threads
- Cards (rendered as [Markdown](https://linear.app/docs/comment-on-issues))

## Thread Model

Each Linear issue maps to one thread:

| Type          | Thread ID Format     |
| ------------- | -------------------- |
| Issue comment | `linear:{issueId}`   |

Example thread ID: `linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9`

## Reactions

Linear supports standard [emoji reactions](https://linear.app/docs/comment-on-issues) on comments. The adapter maps SDK emoji names to unicode:

| SDK Emoji     | Linear Emoji |
| ------------- | ------------ |
| `thumbs_up`   | 👍           |
| `thumbs_down` | 👎           |
| `heart`       | ❤️           |
| `fire`        | 🔥           |
| `rocket`      | 🚀           |
| `eyes`        | 👀           |
| `sparkles`    | ✨           |
| `wave`        | 👋           |

## Limitations

- **No typing indicators** - Linear doesn't support typing indicators
- **No streaming** - Messages posted in full (editing supported for updates)
- **No DMs** - Linear doesn't have direct messages
- **No modals** - Linear doesn't support interactive modals
- **Action buttons** - Rendered as text; use link buttons for clickable actions
- **Remove reaction** - Requires reaction ID lookup (not directly supported)

## Troubleshooting

### "Invalid signature" error

- Verify `LINEAR_WEBHOOK_SECRET` matches the secret from your webhook configuration
- Ensure the request body isn't being modified before verification
- The webhook secret is shown only once at creation - regenerate if lost

### Bot not responding to mentions

- Verify webhook events are configured with `Comment` resource type
- Check that the webhook URL is correct and accessible
- Ensure the `userName` config matches how users mention the bot
- Check that the webhook is enabled (Linear may auto-disable after repeated failures)

### "Webhook expired" error

- This means the webhook timestamp is too old (> 5 minutes)
- Usually indicates a delivery delay or clock skew
- Check that your server time is synchronized

### Rate limiting

- Linear API has [rate limits](https://linear.app/developers/graphql#rate-limiting)
- The SDK handles rate limiting automatically in most cases

## License

MIT
