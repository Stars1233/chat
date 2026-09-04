---
"@chat-adapter/slack": minor
---

Rotate long-running native Slack streams before Slack expires them. Once a stream segment passes `streamSegmentMaxAgeMs` (default four minutes) the adapter finalizes it at the next paragraph break and continues the reply in a new message, closing and reopening code fences, repeating table headers, replaying open task cards and the plan title, and keeping the agent session in `processing`. A segment Slack already expired during an idle gap is recovered the same way instead of failing the reply.
