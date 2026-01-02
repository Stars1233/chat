# Replay Test Fixtures

Replay tests verify the Chat SDK handles real webhook payloads correctly by recording production interactions and replaying them in tests.

## Quick Start: SHA-Based Recording Workflow

The recommended workflow ties recordings to git commits, making it easy to capture and convert production interactions into tests.

### 1. Deploy with recording enabled

```bash
# Set in Vercel environment variables (or .env.local for local dev)
RECORDING_ENABLED=true
REDIS_URL=redis://...
```

When deployed, recordings are automatically tagged with `VERCEL_GIT_COMMIT_SHA`:
```
session-{SHA}-{timestamp}-{random}
```

### 2. Interact with your bot

Perform the interactions you want to test:
- @mention the bot in Slack, Teams, or Google Chat
- Click buttons in cards (actions)
- Add emoji reactions
- Send follow-up messages

### 3. Find recordings for your SHA

```bash
cd examples/nextjs-chat

# List all recording sessions
pnpm recording:list

# Output shows sessions grouped by SHA:
#   session-abc123-2024-01-15T10:30:00.000Z-x7k2m (5 entries)
#   session-abc123-2024-01-15T10:32:15.000Z-p9n3q (3 entries)
#   session-def456-2024-01-14T09:00:00.000Z-m2k8j (8 entries)
```

### 4. Export and inspect recordings

```bash
# Export a specific session
pnpm recording:export session-abc123-2024-01-15T10:30:00.000Z-x7k2m > recording.json

# Or pipe through jq to filter webhooks only
pnpm recording:export <session-id> | jq '[.[] | select(.type == "webhook")]'
```

### 5. Extract webhook payloads into fixtures

From the exported JSON, extract the `body` field from webhook entries:

```bash
# Extract all webhook bodies as parsed JSON
cat recording.json | jq '[.[] | select(.type == "webhook") | {platform, body: (.body | fromjson)}]'
```

Then copy the relevant payloads into fixture files.

### 6. Create fixture file

```json
{
  "botName": "My Bot",
  "botUserId": "U123...",
  "mention": { /* first webhook - the @mention */ },
  "action": { /* button click webhook (if testing actions) */ },
  "reaction": { /* emoji reaction webhook (if testing reactions) */ },
  "followUp": { /* follow-up message webhook (if testing conversations) */ }
}
```

### 7. Write the replay test

See `replay.test.ts` and `replay-actions-reactions.test.ts` for examples.

## Fixture Structure

### Basic messaging (`slack.json`, `gchat.json`, `teams.json`)
```json
{
  "botName": "My Bot",
  "botUserId": "U123...",
  "mention": { /* webhook body for @mention */ },
  "followUp": { /* webhook body for follow-up message */ }
}
```

### Actions & reactions (`actions-reactions/*.json`)
```json
{
  "botName": "My Bot",
  "botUserId": "U123...",
  "mention": { /* webhook to subscribe the thread */ },
  "action": { /* button click webhook */ },
  "reaction": { /* emoji reaction webhook */ }
}
```

## Platform-Specific Webhook Formats

### Google Chat

| Event | Format |
|-------|--------|
| Mention | Direct webhook with `chat.messagePayload` |
| Follow-up | Pub/Sub with `message.data` (base64) |
| Reaction | Pub/Sub with `ce-type: "google.workspace.chat.reaction.v1.created"` |
| Action | `type: "CARD_CLICKED"` event |

### Slack

| Event | Format |
|-------|--------|
| Mention | `event_callback` with `event.type: "app_mention"` |
| Follow-up | `event_callback` with `event.type: "message"` and `thread_ts` |
| Reaction | `event_callback` with `event.type: "reaction_added"` |
| Action | `block_actions` (URL-encoded form: `payload=...`) |

Raw emoji format: Slack shortcode without colons (e.g., `+1`, `heart`)

### Teams

| Event | Format |
|-------|--------|
| Mention | `type: "message"` with bot in `entities` array |
| Follow-up | `type: "message"` with same `conversation.id` |
| Reaction | `type: "messageReaction"` with `reactionsAdded` array |
| Action | `type: "message"` with `value.actionId` |

Raw emoji format: Teams reaction type (e.g., `like`, `heart`)

## Recording Implementation Details

The recorder (`examples/nextjs-chat/src/lib/recorder.ts`) stores entries in Redis:
- Key: `recording:{sessionId}`
- TTL: 24 hours
- Entry types: `webhook` (incoming) and `api-call` (outgoing)

Session ID format when `VERCEL_GIT_COMMIT_SHA` is set:
```
session-{SHA}-{ISO timestamp}-{random 6 chars}
```

This makes it easy to find all recordings from a specific deployment.
