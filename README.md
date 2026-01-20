# Chat SDK

A unified SDK for building chat bots across Slack, Microsoft Teams, Google Chat, and Discord.

## Features

- Multi-platform support with a single codebase
- Mention-based thread subscriptions
- Reaction handling with type-safe emoji
- Cross-platform emoji helper for consistent rendering
- **AI SDK integration** - Stream LLM responses directly to chat
- **Rich cards with buttons** - TSX or object-based cards
- **Action callbacks** - Handle button clicks across platforms
- **Modals & form inputs** - Collect user input via modal dialogs
- **File uploads** - Send files with messages
- **DM support** - Initiate direct messages programmatically
- Message deduplication for platform quirks
- Serverless-ready with pluggable state backends

## Quick Start

### 1. Create your bot (`lib/bot.ts`)

```typescript
import { Chat, ConsoleLogger, emoji } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createTeamsAdapter } from "@chat-adapter/teams";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { createRedisState } from "@chat-adapter/state-redis";

const logger = new ConsoleLogger("info");

export const bot = new Chat({
  userName: "mybot",
  logger,
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
      logger: logger.child("slack"),
    }),
    teams: createTeamsAdapter({
      appId: process.env.TEAMS_APP_ID!,
      appPassword: process.env.TEAMS_APP_PASSWORD!,
      logger: logger.child("teams"),
    }),
    gchat: createGoogleChatAdapter({
      credentials: JSON.parse(process.env.GOOGLE_CHAT_CREDENTIALS!),
      logger: logger.child("gchat"),
    }),
    discord: createDiscordAdapter({
      botToken: process.env.DISCORD_BOT_TOKEN!,
      publicKey: process.env.DISCORD_PUBLIC_KEY!,
      applicationId: process.env.DISCORD_APPLICATION_ID!,
      logger: logger.child("discord"),
    }),
  },
  state: createRedisState({ url: process.env.REDIS_URL!, logger }),
});

// Handle @mentions - works across all platforms
bot.onNewMention(async (thread) => {
  await thread.subscribe();
  // Emoji auto-converts to platform format: :wave: on Slack, 👋 on Teams/GChat
  await thread.post(`${emoji.wave} Hello! I'm now listening to this thread.`);
});

// Handle follow-up messages in subscribed threads
bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`${emoji.check} You said: ${message.text}`);
});

// Handle emoji reactions (type-safe emoji values)
bot.onReaction([emoji.thumbs_up, emoji.heart, emoji.fire], async (event) => {
  if (!event.added) return; // Only respond to added reactions
  await event.adapter.addReaction(event.threadId, event.messageId, event.emoji);
});
```

### 2. Create a webhook handler (`app/api/webhooks/[platform]/route.ts`)

```typescript
import { after } from "next/server";
import { bot } from "@/lib/bot";

type Platform = keyof typeof bot.webhooks;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;

  const handler = bot.webhooks[platform as Platform];
  if (!handler) {
    return new Response(`Unknown platform: ${platform}`, { status: 404 });
  }

  return handler(request, {
    waitUntil: (task) => after(() => task),
  });
}
```

This creates endpoints for each platform:

- `POST /api/webhooks/slack`
- `POST /api/webhooks/teams`
- `POST /api/webhooks/gchat`
- `POST /api/webhooks/discord`

The `waitUntil` option ensures message processing completes after the response is sent (required for serverless).

**Note for Discord:** Discord uses HTTP Interactions for slash commands and button clicks, but requires a Gateway WebSocket connection for receiving messages. See [SETUP.md](./SETUP.md) for Discord Gateway configuration.

## Setup

See [SETUP.md](./SETUP.md) for platform configuration instructions including:

- Slack app creation and OAuth scopes
- Microsoft Teams Azure Bot setup
- Google Chat service account and Pub/Sub configuration
- Discord application and Gateway setup
- Environment variables reference

## Emoji Helper

The `emoji` helper provides type-safe, cross-platform emoji that automatically convert to each platform's format. Use it with `thread.post()`:

```
await thread.post(`${emoji.thumbs_up} Great job!`);
// Slack: ":+1: Great job!"
// Teams/GChat: "👍 Great job!"
```

**Available emoji:**

| Name              | Emoji | Name                | Emoji |
| ----------------- | ----- | ------------------- | ----- |
| `emoji.thumbs_up` | 👍    | `emoji.thumbs_down` | 👎    |
| `emoji.heart`     | ❤️    | `emoji.smile`       | 😊    |
| `emoji.laugh`     | 😂    | `emoji.thinking`    | 🤔    |
| `emoji.eyes`      | 👀    | `emoji.fire`        | 🔥    |
| `emoji.check`     | ✅    | `emoji.x`           | ❌    |
| `emoji.question`  | ❓    | `emoji.party`       | 🎉    |
| `emoji.rocket`    | 🚀    | `emoji.star`        | ⭐    |
| `emoji.wave`      | 👋    | `emoji.clap`        | 👏    |
| `emoji["100"]`    | 💯    | `emoji.warning`     | ⚠️    |

For one-off custom emoji, use `emoji.custom("name")`.

### Custom Emoji (Type-Safe)

For workspace-specific emoji with full type safety, use `createEmoji()`:

```typescript
import { createEmoji } from "chat";

// Create emoji helper with custom emoji
const myEmoji = createEmoji({
  unicorn: { slack: "unicorn_face", gchat: "🦄" },
  company_logo: { slack: "company", gchat: "🏢" },
});

// Type-safe access to custom emoji (with autocomplete)
const message = `${myEmoji.unicorn} Magic! ${myEmoji.company_logo}`;
// Slack: ":unicorn_face: Magic! :company:"
// GChat: "🦄 Magic! 🏢"
```

## Rich Cards with Buttons

Send interactive cards with buttons that work across all platforms. Cards automatically convert to Block Kit (Slack), Adaptive Cards (Teams), and Google Chat Cards.

Configure your `tsconfig.json` to use the chat JSX runtime:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "chat"
  }
}
```

Then use JSX syntax:

```tsx
import {
  Card,
  CardText,
  Button,
  Actions,
  Section,
  Fields,
  Field,
  Divider,
  Image,
  Modal,
  TextInput,
  Select,
  SelectOption,
} from "chat";

// Simple card with buttons
await thread.post(
  <Card title="Order #1234">
    <CardText>Your order has been received!</CardText>
    <Section>
      <CardText style="bold">Total: $50.00</CardText>
    </Section>
    <Actions>
      <Button id="approve" style="primary">
        Approve
      </Button>
      <Button id="reject" style="danger">
        Reject
      </Button>
    </Actions>
  </Card>
);

// Card with fields (key-value pairs)
await thread.post(
  <Card title="User Profile">
    <Fields>
      <Field label="Name" value="John Doe" />
      <Field label="Role" value="Developer" />
      <Field label="Team" value="Platform" />
    </Fields>
    <Divider />
    <Actions>
      <Button id="edit">Edit Profile</Button>
    </Actions>
  </Card>
);

// Card with image
await thread.post(
  <Card title="Product Update">
    <Image url="https://example.com/product.png" alt="Product screenshot" />
    <CardText>Check out our new feature!</CardText>
  </Card>
);
```

**Note:** Use `CardText` (not `Text`) when using JSX to avoid conflicts with React's built-in types.

## Action Callbacks

Handle button clicks from cards:

```typescript
import { Chat, type ActionEvent } from "chat";

// Handle a specific action
bot.onAction("approve", async (event: ActionEvent) => {
  await event.thread.post(`Order approved by ${event.user.fullName}!`);
});

// Handle multiple actions
bot.onAction(["approve", "reject"], async (event: ActionEvent) => {
  const action = event.actionId === "approve" ? "approved" : "rejected";
  await event.thread.post(`Order ${action}!`);
});

// Catch-all action handler
bot.onAction(async (event: ActionEvent) => {
  console.log(`Action: ${event.actionId}, Value: ${event.value}`);
});
```

The `ActionEvent` includes `actionId`, `value`, `user`, `thread`, `messageId`, `threadId`, `adapter`, `triggerId`, and `raw` properties.

## Modals & Form Inputs

Open modal dialogs to collect structured user input. Modals support text inputs, dropdowns, and validation. Currently supported on Slack.

### Opening a Modal

Modals are opened in response to button clicks using `event.openModal()`:

```tsx
import {
  Modal,
  TextInput,
  Select,
  SelectOption,
} from "chat";

// Handle a button click that opens a modal
bot.onAction("feedback", async (event) => {
  await event.openModal(
    <Modal
      callbackId="feedback_form"
      title="Send Feedback"
      submitLabel="Send"
      closeLabel="Cancel"
      notifyOnClose
      privateMetadata={event.threadId}
    >
      <TextInput
        id="message"
        label="Your Feedback"
        placeholder="Tell us what you think..."
        multiline
      />
      <Select id="category" label="Category" placeholder="Select a category">
        <SelectOption label="Bug Report" value="bug" />
        <SelectOption label="Feature Request" value="feature" />
        <SelectOption label="General Feedback" value="general" />
      </Select>
      <TextInput
        id="email"
        label="Email (optional)"
        placeholder="your@email.com"
        optional
      />
    </Modal>
  );
});
```

### Modal Components

| Component | Description |
|-----------|-------------|
| `Modal` | Container with `callbackId`, `title`, `submitLabel`, `closeLabel`, `notifyOnClose`, `privateMetadata` |
| `TextInput` | Text field with `id`, `label`, `placeholder`, `initialValue`, `multiline`, `optional`, `maxLength` |
| `Select` | Dropdown with `id`, `label`, `placeholder`, `initialOption`, `optional` |
| `SelectOption` | Option for Select with `label` and `value` |

### Handling Modal Submissions

Handle form submissions with `onModalSubmit`:

```typescript
import type { ModalSubmitEvent } from "chat";

bot.onModalSubmit("feedback_form", async (event: ModalSubmitEvent) => {
  const { message, category, email } = event.values;

  // Validate input - return errors to show in the modal
  if (!message || message.length < 5) {
    return {
      action: "errors",
      errors: { message: "Feedback must be at least 5 characters" },
    };
  }

  // Process the submission
  console.log("Received feedback:", { message, category, email });

  // Post confirmation to the original thread
  if (event.privateMetadata) {
    await event.adapter.postMessage(
      event.privateMetadata,
      `Feedback received! Category: ${category}`
    );
  }

  // Return nothing to close the modal
});
```

### Modal Response Types

Return different responses from `onModalSubmit` to control modal behavior:

| Response | Description |
|----------|-------------|
| `{ action: "close" }` | Close the modal (default if nothing returned) |
| `{ action: "errors", errors: { fieldId: "Error message" } }` | Show validation errors on specific fields |
| `{ action: "update", modal: ModalElement }` | Update the modal content |
| `{ action: "push", modal: ModalElement }` | Push a new modal view onto the stack |

### Handling Modal Close

Optionally handle when users close/cancel a modal (requires `notifyOnClose` on the Modal):

```typescript
import type { ModalCloseEvent } from "chat";

bot.onModalClose("feedback_form", async (event: ModalCloseEvent) => {
  console.log(`${event.user.userName} cancelled the feedback form`);
});
```

The `ModalSubmitEvent` includes `callbackId`, `viewId`, `values`, `privateMetadata`, `user`, `adapter`, and `raw` properties.

## AI Integration & Streaming

Stream LLM responses directly to chat platforms. The SDK accepts any `AsyncIterable<string>` (like AI SDK's `textStream`), automatically using native streaming APIs where available (Slack) or falling back to post+edit for other platforms.

```typescript
import { Chat } from "chat";

// Stream AI response on @mention
bot.onNewMention(async (thread, message) => {
  const result = await agent.stream({ prompt: message.text });
  await thread.post(result.textStream);
});
```

### Platform Behavior

| Platform | Streaming Method |
|----------|------------------|
| Slack | Native streaming API (`chatStream`) |
| Teams | Post + edit with throttling |
| Google Chat | Post + edit with throttling |
| Discord | Post + edit with throttling |

The fallback method posts an initial message, then edits it as chunks arrive (throttled to avoid rate limits).

The SDK also supports **per-thread state** via `thread.setState()` and `thread.state` for tracking conversation modes, user preferences, or any thread-specific context.

## File Uploads

Send files along with messages:

```typescript
import type { Thread } from "chat";

// Send a file with a message
const reportBuffer = Buffer.from("PDF content");
await thread.post({
  markdown: "Here's the report you requested:",
  files: [
    {
      data: reportBuffer,
      filename: "report.pdf",
      mimeType: "application/pdf",
    },
  ],
});

// Send multiple files
const image1 = Buffer.from("image1");
const image2 = Buffer.from("image2");
await thread.post({
  markdown: "Attached are the images:",
  files: [
    { data: image1, filename: "screenshot1.png" },
    { data: image2, filename: "screenshot2.png" },
  ],
});

// Files only (with minimal text)
const buffer = Buffer.from("document content");
await thread.post({
  markdown: "",
  files: [{ data: buffer, filename: "document.xlsx" }],
});
```

### Reading Attachments

Access attachments from incoming messages:

```typescript
import { Chat } from "chat";

bot.onSubscribedMessage(async (thread, message) => {
  for (const attachment of message.attachments ?? []) {
    console.log(`File: ${attachment.name}, Type: ${attachment.mimeType}`);

    // Download the file data
    if (attachment.fetchData) {
      const data = await attachment.fetchData();
      // Process the file...
      console.log(`Downloaded ${data.length} bytes`);
    }
  }
});
```

The `Attachment` interface includes `type`, `url`, `name`, `mimeType`, `size`, `width`, `height`, and `fetchData` properties.

## Direct Messages

Initiate DM conversations programmatically. The adapter is automatically inferred from the userId format:

```typescript
import { Chat } from "chat";

// Open a DM using Author object (convenient in handlers)
bot.onSubscribedMessage(async (thread, message) => {
  if (message.text === "DM me") {
    const dmThread = await bot.openDM(message.author);
    await dmThread.post("Hello! This is a direct message.");
  }
});

// Or use userId string directly - adapter inferred from format:
// - Slack: U... (e.g., "U1234567890")
// - Teams: 29:... (e.g., "29:abc123...")
// - Google Chat: users/... (e.g., "users/123456789")
const dmThread = await bot.openDM("U1234567890");

// Check if a thread is a DM
bot.onSubscribedMessage(async (thread, message) => {
  if (thread.isDM) {
    await thread.post("This is a private conversation.");
  }
});
```

## Development

```bash
pnpm install
pnpm build
pnpm dev         # Run example app
pnpm typecheck
pnpm lint
```

## License

MIT
