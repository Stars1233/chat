# Chat SDK Setup Guide

This guide covers the complete setup process for Slack, Microsoft Teams, and Google Chat integrations.

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
GOOGLE_CHAT_CREDENTIALS={"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...@....iam.gserviceaccount.com","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"..."}

# Google Chat Pub/Sub (optional - for receiving ALL messages, not just @mentions)
GOOGLE_CHAT_PUBSUB_TOPIC=projects/your-project/topics/chat-events
GOOGLE_CHAT_IMPERSONATE_USER=admin@yourdomain.com

# Redis (required for serverless deployments)
REDIS_URL=redis://localhost:6379
```

---

## Slack Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Enter app name and select workspace
4. Click **Create App**

### 2. Configure Bot Token Scopes

1. Go to **OAuth & Permissions** in the sidebar
2. Under **Scopes** → **Bot Token Scopes**, add:
   - `app_mentions:read` - Receive @mention events
   - `channels:history` - Read messages in public channels
   - `channels:read` - View basic channel info
   - `chat:write` - Send messages
   - `groups:history` - Read messages in private channels
   - `groups:read` - View basic private channel info
   - `im:history` - Read direct messages
   - `im:read` - View basic DM info
   - `reactions:read` - View emoji reactions
   - `reactions:write` - Add/remove emoji reactions
   - `users:read` - View user info (for display names)

### 3. Install App to Workspace

1. Go to **OAuth & Permissions**
2. Click **Install to Workspace**
3. Authorize the app
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`) → `SLACK_BOT_TOKEN`

### 4. Get Signing Secret

1. Go to **Basic Information**
2. Under **App Credentials**, copy **Signing Secret** → `SLACK_SIGNING_SECRET`

### 5. Configure Event Subscriptions

1. Go to **Event Subscriptions**
2. Toggle **Enable Events** to On
3. Set **Request URL** to: `https://your-domain.com/api/webhooks/slack`
   - Slack will verify the URL immediately
4. Under **Subscribe to bot events**, add:
   - `app_mention` - When someone @mentions your bot
   - `message.channels` - Messages in public channels
   - `message.groups` - Messages in private channels
   - `message.im` - Direct messages
5. Click **Save Changes**

### 6. (Optional) Enable Interactivity

If you want to use buttons, modals, or other interactive components:

1. Go to **Interactivity & Shortcuts**
2. Toggle **Interactivity** to On
3. Set **Request URL** to: `https://your-domain.com/api/webhooks/slack/interactive`

---

## Microsoft Teams Setup

### 1. Create Azure Bot Resource

1. Go to [portal.azure.com](https://portal.azure.com)
2. Click **Create a resource**
3. Search for **Azure Bot** and select it
4. Click **Create**
5. Fill in:
   - **Bot handle**: Unique identifier for your bot
   - **Subscription**: Your Azure subscription
   - **Resource group**: Create new or use existing
   - **Pricing tier**: F0 (free) for testing
   - **Type of App**: **Single Tenant** (recommended for enterprise)
   - **Creation type**: **Create new Microsoft App ID**
6. Click **Review + create** → **Create**

### 2. Get App Credentials

1. Go to your newly created Bot resource
2. Go to **Configuration**
3. Copy **Microsoft App ID** → `TEAMS_APP_ID`
4. Click **Manage Password** (next to Microsoft App ID)
5. In the App Registration page, go to **Certificates & secrets**
6. Click **New client secret**
7. Add description, select expiry, click **Add**
8. Copy the **Value** immediately (shown only once) → `TEAMS_APP_PASSWORD`
9. Go back to **Overview** and copy **Directory (tenant) ID** → `TEAMS_APP_TENANT_ID`

### 3. Configure Messaging Endpoint

1. In your Azure Bot resource, go to **Configuration**
2. Set **Messaging endpoint** to: `https://your-domain.com/api/webhooks/teams`
3. Click **Apply**

### 4. Enable Teams Channel

1. In your Azure Bot resource, go to **Channels**
2. Click **Microsoft Teams**
3. Accept the terms of service
4. Click **Apply**

### 5. Create Teams App Package

Create a `manifest.json` file:

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "YOUR_APP_ID_HERE",
  "packageName": "com.yourcompany.chatbot",
  "developer": {
    "name": "Your Company",
    "websiteUrl": "https://your-domain.com",
    "privacyUrl": "https://your-domain.com/privacy",
    "termsOfUseUrl": "https://your-domain.com/terms"
  },
  "name": {
    "short": "Chat Bot",
    "full": "Chat SDK Demo Bot"
  },
  "description": {
    "short": "A chat bot powered by Chat SDK",
    "full": "A chat bot powered by Chat SDK that can respond to messages and commands."
  },
  "icons": {
    "outline": "outline.png",
    "color": "color.png"
  },
  "accentColor": "#FFFFFF",
  "bots": [
    {
      "botId": "YOUR_APP_ID_HERE",
      "scopes": ["personal", "team", "groupchat"],
      "supportsFiles": false,
      "isNotificationOnly": false,
      "commandLists": [
        {
          "scopes": ["personal", "team", "groupchat"],
          "commands": [
            {
              "title": "help",
              "description": "Get help using this bot"
            }
          ]
        }
      ]
    }
  ],
  "permissions": ["identity", "messageTeamMembers"],
  "validDomains": ["your-domain.com"]
}
```

Create icon files (32x32 `outline.png` and 192x192 `color.png`), then zip all three files together.

### 6. Upload App to Teams

**For testing (sideloading):**
1. In Teams, click **Apps** in the sidebar
2. Click **Manage your apps** → **Upload an app**
3. Click **Upload a custom app**
4. Select your zip file

**For organization-wide deployment:**
1. Go to [Teams Admin Center](https://admin.teams.microsoft.com)
2. Go to **Teams apps** → **Manage apps**
3. Click **Upload new app**
4. Select your zip file
5. Go to **Setup policies** to control who can use the app

---

## Google Chat Setup

### 1. Create a GCP Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown → **New Project**
3. Enter project name and click **Create**

### 2. Enable Required APIs

1. Go to **APIs & Services** → **Library**
2. Search and enable:
   - **Google Chat API**
   - **Google Workspace Events API** (for receiving all messages)
   - **Cloud Pub/Sub API** (for receiving all messages)

### 3. Create a Service Account

1. Go to **IAM & Admin** → **Service Accounts**
2. Click **Create Service Account**
3. Enter name and description
4. Click **Create and Continue**
5. Skip the optional steps, click **Done**

### 4. Create Service Account Key

> **Note**: If your organization has the `iam.disableServiceAccountKeyCreation` constraint enabled, you'll need to:
> 1. Go to **IAM & Admin** → **Organization Policies**
> 2. Find `iam.disableServiceAccountKeyCreation`
> 3. Click **Manage Policy** → **Override parent's policy**
> 4. Set to **Not enforced** (or add an exception for your project)

1. Click on your service account
2. Go to **Keys** tab
3. Click **Add Key** → **Create new key**
4. Select **JSON** and click **Create**
5. Save the downloaded file
6. Copy the entire JSON content → `GOOGLE_CHAT_CREDENTIALS` (as a single line)

### 5. Configure Google Chat App

1. Go to [console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat](https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat)
2. Click **Configuration**
3. Fill in:
   - **App name**: Your bot's display name
   - **Avatar URL**: URL to your bot's avatar image
   - **Description**: What your bot does
   - **Interactive features**:
     - Enable **Receive 1:1 messages**
     - Enable **Join spaces and group conversations**
   - **Connection settings**: Select **App URL**
   - **App URL**: `https://your-domain.com/api/webhooks/gchat`
   - **Visibility**: Choose who can discover and install your app
4. Click **Save**

**Important for button clicks**: The same App URL receives both message events and interactive events (card button clicks). Google Chat sends CARD_CLICKED events to this URL when users click buttons in cards. The SDK's `onAction()` handler will automatically receive these events.

### 6. (Optional) Set Up Pub/Sub for All Messages

By default, Google Chat only sends webhooks for @mentions. To receive ALL messages in a space (for conversation context), you need to set up Workspace Events with Pub/Sub.

#### 6a. Create Pub/Sub Topic

1. Go to **Pub/Sub** → **Topics**
2. Click **Create Topic**
3. Enter topic ID (e.g., `chat-events`)
4. Uncheck **Add a default subscription**
5. Click **Create**
6. Copy the full topic name → `GOOGLE_CHAT_PUBSUB_TOPIC`
   - Format: `projects/your-project-id/topics/chat-events`

#### 6b. Grant Chat Service Account Access

> **Note**: If your organization has the `iam.allowedPolicyMemberDomains` constraint, you may need to temporarily relax it or use the console workaround below.

1. Go to your Pub/Sub topic
2. Click **Permissions** tab (or **Show Info Panel** → **Permissions**)
3. Click **Add Principal**
4. Enter: `chat-api-push@system.gserviceaccount.com`
5. Select role: **Pub/Sub Publisher**
6. Click **Save**

**If you get a policy error**, try via Cloud Console:
1. Go to **Pub/Sub** → **Topics**
2. Check the box next to your topic
3. Click **Permissions** in the info panel
4. Click **Add Principal**
5. Add `chat-api-push@system.gserviceaccount.com` with **Pub/Sub Publisher** role

#### 6c. Create Push Subscription

1. Go to **Pub/Sub** → **Subscriptions**
2. Click **Create Subscription**
3. Enter subscription ID (e.g., `chat-messages-push`)
4. Select your topic
5. **Delivery type**: Push
6. **Endpoint URL**: `https://your-domain.com/api/webhooks/gchat`
7. Click **Create**

#### 6d. Enable Domain-Wide Delegation

To create Workspace Events subscriptions and initiate DMs, you need domain-wide delegation:

1. Go to your **Service Account** → **Details**
2. Check **Enable Google Workspace Domain-wide Delegation**
3. Expand **Advanced settings**
4. Copy the **Client ID** (numeric)
5. Go to [Google Admin Console](https://admin.google.com)
6. Go to **Security** → **Access and data control** → **API controls**
7. Click **Manage Domain Wide Delegation**
8. Click **Add new**
9. Enter:
   - **Client ID**: The numeric ID from step 4
   - **OAuth Scopes** (all on one line, comma-separated):
     ```
     https://www.googleapis.com/auth/chat.spaces.readonly,https://www.googleapis.com/auth/chat.messages.readonly,https://www.googleapis.com/auth/chat.spaces,https://www.googleapis.com/auth/chat.spaces.create
     ```
10. Click **Authorize**

**Note**: Scope changes can take up to 24 hours to propagate. If you're getting "Insufficient Permission" errors after adding scopes, wait and try again.

Set `GOOGLE_CHAT_IMPERSONATE_USER` to an admin user email in your domain (e.g., `admin@yourdomain.com`). This user will be impersonated when creating DM spaces and Workspace Events subscriptions.

### 7. Add Bot to a Space

1. Open Google Chat
2. Create or open a Space
3. Click the space name → **Manage apps & integrations** (or **Apps & integrations**)
4. Click **Add apps**
5. Search for your app name
6. Click **Add**

---

## Vercel Deployment

### 1. Configure Environment Variables

In your Vercel project settings:

1. Go to **Settings** → **Environment Variables**
2. Add all the variables from the `.env.local` section above
3. Make sure to select the appropriate environments (Production, Preview, Development)

### 2. Configure Build Settings

The `examples/nextjs-chat/vercel.json` is already configured to:
- Only build the necessary workspace packages
- Use the correct install and build commands

### 3. Set Root Directory (if needed)

If deploying from the monorepo root:
1. Go to **Settings** → **General**
2. Set **Root Directory** to `examples/nextjs-chat`

---

## Testing Your Setup

### Slack
1. Open Slack
2. @mention your bot in a channel: `@YourBot hello`
3. Or DM the bot directly

### Teams
1. Open Teams
2. Search for your bot in the Apps section
3. Start a chat with the bot
4. Or @mention in a channel: `@YourBot hello`

### Google Chat
1. Open Google Chat
2. Go to a space where the bot is installed
3. @mention the bot: `@YourBot hello`
4. The bot should respond to the mention
5. If Pub/Sub is configured, subsequent messages in the thread won't need @mentions

---

## Troubleshooting

### Slack: "Invalid signature" error
- Verify `SLACK_SIGNING_SECRET` is correct
- Check that the request timestamp is within 5 minutes (clock sync issue)

### Teams: "Unauthorized" error
- Verify `TEAMS_APP_ID` and `TEAMS_APP_PASSWORD` are correct
- For SingleTenant apps, ensure `TEAMS_APP_TENANT_ID` is set
- Check that the messaging endpoint URL is correct in Azure

### Google Chat: No webhook received
- Verify the App URL is correct in Google Chat configuration
- Check that the Chat API is enabled
- Ensure the service account has the necessary permissions

### Google Chat: Pub/Sub not working
- Verify `chat-api-push@system.gserviceaccount.com` has Pub/Sub Publisher role
- Check that the push subscription URL is correct
- Verify domain-wide delegation is configured with correct scopes
- Check `GOOGLE_CHAT_IMPERSONATE_USER` is a valid admin email

### Google Chat: "Permission denied" for Workspace Events
- Ensure domain-wide delegation is configured
- Verify the OAuth scopes are exactly as specified
- Check that the impersonated user has access to the spaces

### Google Chat: "Insufficient Permission" for DMs (openDM)
- DMs require domain-wide delegation with `chat.spaces` and `chat.spaces.create` scopes
- Add these scopes to your domain-wide delegation configuration in Google Admin Console
- Set `GOOGLE_CHAT_IMPERSONATE_USER` to an admin email in your domain
- Scope changes can take up to 24 hours to propagate - wait and retry

### Google Chat: Button clicks (CARD_CLICKED) not received
- Verify "Interactive features" is enabled in the Google Chat app configuration
- Check that the App URL is correctly set and accessible
- Button clicks go to the same webhook URL as messages
- Check your logs for the raw webhook payload to debug
- Ensure your button elements have valid `id` attributes (these become the `actionId`)

### Redis connection errors
- Verify `REDIS_URL` is correct
- For Vercel, use Upstash Redis or similar serverless-compatible Redis
- Check firewall/network rules allow connections

### Duplicate messages
- The SDK includes deduplication, but ensure Redis is properly configured
- For Slack, both `message` and `app_mention` events are sent for @mentions (SDK handles this)
- For Google Chat, both direct webhooks and Pub/Sub may receive the same message (SDK handles this)
