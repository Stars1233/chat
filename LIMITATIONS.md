# Platform Limitations

This document outlines the capabilities and limitations of each chat platform adapter.

## Feature Support Matrix

| Feature | Slack | Teams | Google Chat |
|---------|:-----:|:-----:|:-----------:|
| `postMessage` | ✅ | ✅ | ✅ |
| `editMessage` | ✅ | ✅ | ✅ |
| `deleteMessage` | ✅ | ✅ | ✅ |
| `addReaction` | ✅ | ❌ | ⚠️* |
| `removeReaction` | ✅ | ❌ | ⚠️* |
| `onReaction` events | ✅ | ✅ | ✅* |
| `startTyping` | ❌ | ✅ | ❌ |
| `fetchMessages` | ✅ | ❌ | ✅ |
| `fetchThread` | ✅ | ✅ | ✅ |

## Platform-Specific Details

### Slack

**Limitations:**
- **Typing indicators**: Slack does not provide an API for bots to show typing indicators. The `startTyping` method is a no-op.

**Notes:**
- Bot user ID is auto-discovered via `auth.test` API call during initialization
- Supports both `bot_id` and `user` fields for message author identification
- File attachments require appropriate OAuth scopes (`files:read`)

### Microsoft Teams

**Limitations:**
- **Adding reactions**: Teams Bot Framework does not expose APIs for bots to add reactions. `addReaction` and `removeReaction` will throw `NotImplementedError`.
- **Message history**: Teams does not provide a bot API to fetch message history. `fetchMessages` will throw `NotImplementedError`.

**Supported:**
- **Reaction events**: Bots can receive `MessageReaction` activities when users add/remove reactions via `onReaction()`.
- **Typing indicators**: Supported via `ActivityTypes.Typing`

**Notes:**
- Bot identification uses `appId` matching against `activity.from.id`
- Service URL varies by tenant and must be preserved per conversation
- Proactive messaging requires storing conversation references

### Google Chat

**Limitations:**
- **Typing indicators**: Google Chat does not provide an API for typing indicators. The `startTyping` method is a no-op.
- **Reactions (addReaction/removeReaction)**: The Google Chat API does not support service account (app) authentication for adding or removing reactions. To use these methods, you must use domain-wide delegation to impersonate a user, but the reaction will appear as coming from that user, not the bot. This is a Google Chat API limitation.

**Notes:**
- Bot user ID is learned dynamically from message annotations (when bot is @mentioned)
- Supports both HTTP endpoint and Pub/Sub delivery modes
- Workspace Events API subscriptions are auto-managed for Pub/Sub mode
- `removeReaction` works by listing reactions and finding by emoji (extra API call)

## isMe Detection

Each adapter detects if a message is from the bot itself using a helper method `isMessageFromSelf()`:

### Slack
- Checks `event.user === botUserId` (primary - for messages sent as bot user)
- Checks `event.bot_id === botId` (secondary - for `bot_message` subtypes)
- Both IDs are fetched during `initialize()` via `auth.test`
- Returns `false` if neither ID is known (safe default)

### Teams
- Checks exact match: `activity.from.id === appId`
- Checks suffix match: `activity.from.id` ends with `:{appId}` (handles `28:{appId}` format)
- The app ID is always known from configuration
- Returns `false` if appId is not configured (safe default)

### Google Chat
- Checks exact match: `message.sender.name === botUserId`
- Bot user ID is learned dynamically from message annotations when bot is @mentioned
- **No fallback**: Returns `false` if bot ID is not yet learned (safer than assuming all BOT messages are from self)
- Bot ID is persisted to state for serverless environments

## Error Handling

All adapters throw errors on API failures. Specific error types:

- `RateLimitError`: Thrown when platform rate limits are exceeded (429 responses)
- `NotImplementedError`: Thrown when calling unsupported features

## Reaction Events

The SDK provides `onReaction()` to handle emoji reaction events. Support varies by platform:

### Platform Support

| Platform | Supported | Notes |
|----------|:---------:|-------|
| Slack | ✅ | Via `reaction_added` and `reaction_removed` events |
| Teams | ✅ | Via `reactionsAdded` and `reactionsRemoved` in `MessageReaction` activities |
| Google Chat | ✅* | Requires Workspace Events API (Pub/Sub subscription) |

*Google Chat reaction events are only delivered via Pub/Sub (Workspace Events API), not direct HTTP webhooks.

**GChat addReaction limitation**: The Google Chat API does not support adding reactions with service account authentication. Bots can receive reaction events but cannot add reactions as themselves. To add reactions, use domain-wide delegation to impersonate a user (the reaction will appear from that user, not the bot).

### Emoji Normalization

Platforms use different formats for emoji:
- **Slack**: Names like `+1`, `thumbsup`, `fire`
- **Teams**: Names like `like`, `heart`, `laugh`
- **Google Chat**: Unicode like `👍`, `🔥`

The SDK normalizes these to `EmojiValue` objects with a common `name` property:

| Normalized Name | Slack | Teams | Google Chat |
|-----------------|-------|-------|-------------|
| `thumbs_up` | `+1`, `thumbsup` | `like` | `👍` |
| `thumbs_down` | `-1`, `thumbsdown` | `dislike` | `👎` |
| `heart` | `heart` | `heart` | `❤️`, `❤` |
| `fire` | `fire` | - | `🔥` |
| `check` | `white_check_mark` | - | `✅`, `✔️` |
| `rocket` | `rocket` | - | `🚀` |
| ... | (86 total well-known emoji) | |

### Extending Emoji Types

You can extend the emoji system with custom emoji using `createEmoji()`:

```typescript
import { createEmoji, emoji } from "chat";

// Create custom emoji with cross-platform mappings
const myEmoji = createEmoji({
  unicorn: { slack: "unicorn_face", gchat: "🦄" },
  company_logo: { slack: "company", gchat: "🏢" },
});

// Use type-safe emoji values in reactions
chat.onReaction([emoji.thumbs_up, myEmoji.unicorn], async (event) => {
  // event.emoji is an EmojiValue object
  console.log(event.emoji.name); // "thumbs_up" or "unicorn"
});
```

For TypeScript module augmentation to extend the global emoji helper:

```typescript
declare module "chat" {
  interface CustomEmojiMap {
    unicorn: true;
    custom_team_emoji: true;
  }
}
```

### ReactionEvent Properties

| Property | Type | Description |
|----------|------|-------------|
| `emoji` | `EmojiValue` | Normalized emoji object with `name`, `unicode`, etc. |
| `rawEmoji` | `string` | Platform-specific emoji (e.g., `+1`, `like`, or `👍`) |
| `added` | `boolean` | `true` if reaction was added, `false` if removed |
| `user` | `Author` | The user who added/removed the reaction |
| `messageId` | `string` | ID of the message that was reacted to |
| `threadId` | `string` | Thread ID for the message |
| `adapter` | `Adapter` | The adapter that received the event |
| `raw` | `unknown` | Raw platform event data |

## Markdown Support

| Feature | Slack | Teams | Google Chat |
|---------|:-----:|:-----:|:-----------:|
| Bold | ✅ `*text*` | ✅ `**text**` | ✅ `*text*` |
| Italic | ✅ `_text_` | ✅ `_text_` | ✅ `_text_` |
| Strikethrough | ✅ `~text~` | ✅ `~~text~~` | ✅ `~text~` |
| Code | ✅ `` `code` `` | ✅ `` `code` `` | ✅ `` `code` `` |
| Code blocks | ✅ | ✅ | ✅ |
| Links | ✅ `<url\|text>` | ✅ `[text](url)` | ✅ `[text](url)` |
| Lists | ✅ | ✅ | ✅ |
| Blockquotes | ✅ `>` | ✅ `>` | ⚠️ Simulated with `>` prefix |
| Mentions | ✅ `<@USER>` | ✅ `<at>name</at>` | ✅ `<users/{id}>` |
