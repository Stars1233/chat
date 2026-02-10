---
"@chat-adapter/slack": minor
---

Add multi-workspace support. A single Slack adapter instance can now serve multiple workspaces by resolving bot tokens per-request via AsyncLocalStorage. Includes OAuth V2 flow handling, installation management (set/get/delete), optional AES-256-GCM token encryption at rest, and a withBotToken helper for out-of-webhook contexts
