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

Use OAuth if you want the bot to have its **own identity** in Linear (not attributed to you personally), or if you're building a public integration that other workspaces can install.

> **Do you need OAuth?** For most use cases (personal bot, single workspace), **Option A (API Key) is simpler and sufficient**. You only need OAuth if:
>
> - You want the bot to appear as its own user (not as you)
> - You're building a public app others install into their workspaces
> - You want the bot to be `@`-mentionable as an [Agent](https://linear.app/developers/agents)

See the [full OAuth setup guide](#oauth-setup-guide) below for step-by-step instructions.

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

Linear has two levels of comment threading:

| Type            | Description                              | Thread ID Format                      |
| --------------- | ---------------------------------------- | ------------------------------------- |
| Issue-level     | Top-level comments on an issue           | `linear:{issueId}`                    |
| Comment thread  | Replies nested under a specific comment  | `linear:{issueId}:c:{commentId}`      |

When a user writes a comment, the bot replies **within the same comment thread** (nested under the same card). This matches the expected Linear UX where conversations are grouped.

Example thread IDs:

- `linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9` (issue-level)
- `linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9:c:comment-abc123` (comment thread)

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

## OAuth Setup Guide

This guide walks through setting up a Linear OAuth application for your bot. This is only needed if you want the bot to act as its own identity rather than as your personal account (see [Option B](#option-b-oauth-application) above).

### 1. Create the OAuth Application

1. Go to [Settings > API > Applications](https://linear.app/settings/api/applications/new) in Linear
2. Fill in:
   - **Application name**: Your bot's name (e.g., "v0 Bot") -- this is how it appears in Linear
   - **Application icon**: Upload an icon for the bot
   - **Redirect callback URLs**: Add your OAuth callback URL (e.g., `https://your-domain.com/api/auth/linear/callback`)
3. Click **Create**
4. Note your **Client ID** and **Client Secret**

**What are redirect URLs?** These are URLs in *your* application where Linear redirects the user after they authorize your app. They are **not** the same as webhook URLs. Your server handles this callback to exchange the authorization code for an access token.

### 2. Implement the OAuth Callback

Your app needs an endpoint to handle the OAuth redirect. When a workspace admin clicks "Install" on your app, Linear redirects them to your callback URL with an authorization `code`. You exchange this code for an access token.

Example callback endpoint (Next.js API route):

```typescript
// app/api/auth/linear/callback/route.ts
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  // Exchange code for access token
  const response = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.LINEAR_CLIENT_ID,
      client_secret: process.env.LINEAR_CLIENT_SECRET,
      redirect_uri: "https://your-domain.com/api/auth/linear/callback",
      grant_type: "authorization_code",
    }),
  });

  const { access_token } = await response.json();
  // Store access_token securely for use with the adapter
}
```

### 3. Build the Authorization URL

Direct workspace admins to this URL to install the app:

```
https://linear.app/oauth/authorize?
  client_id=YOUR_CLIENT_ID&
  redirect_uri=https://your-domain.com/api/auth/linear/callback&
  response_type=code&
  scope=read,comments:create,issues:create&
  state=RANDOM_STATE_VALUE
```

**Scopes to request:**

| Scope | Required | Description |
| ----- | -------- | ----------- |
| `read` | Yes | Read workspace data (always included) |
| `comments:create` | Yes | Create and update issue comments |
| `issues:create` | Optional | Create and update issues |
| `app:mentionable` | Optional | Make the bot `@`-mentionable (requires `actor=app`) |
| `app:assignable` | Optional | Allow assigning issues to the bot (requires `actor=app`) |

To make the bot its own user identity (recommended for agents), add `actor=app` to the authorization URL. This requires workspace admin to install.

### 4. Use the Access Token

Once you have the access token, pass it to the adapter:

```typescript
createLinearAdapter({
  accessToken: storedAccessToken,
  webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
  userName: "v0-bot",
  logger: console,
});
```

### 5. Token Refresh (if applicable)

OAuth applications created after October 1, 2025 have refresh tokens enabled by default. Access tokens expire after **24 hours**. See the [Linear OAuth docs](https://linear.app/developers/oauth-2-0-authentication#refresh-an-access-token) for refresh token handling.

For full details, see the [Linear OAuth 2.0 documentation](https://linear.app/developers/oauth-2-0-authentication).

## License

MIT
