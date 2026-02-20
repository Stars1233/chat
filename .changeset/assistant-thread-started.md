---
"chat": minor
"@chat-adapter/slack": minor
---

feat(slack): full Slack Assistants API support

- Route `assistant_thread_started` and `assistant_thread_context_changed` events
- Add `onAssistantThreadStarted` and `onAssistantContextChanged` handler registration
- Add `setSuggestedPrompts`, `setAssistantStatus`, `setAssistantTitle` methods on Slack adapter
- Extend `stream()` to accept `stopBlocks` for Block Kit on stream finalization
- Bump `@slack/web-api` to `^7.11.0` for `chatStream` support
- Export all new types
