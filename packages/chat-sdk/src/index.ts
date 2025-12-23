// Main exports
export { Chat } from "./chat";
// Re-export mdast types for adapters
export type {
  Blockquote,
  Code,
  Content,
  Delete,
  Emphasis,
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph,
  Root,
  Strong,
  Text,
} from "./markdown";
// Markdown/AST utilities
export {
  // Format converter base class
  BaseFormatConverter,
  blockquote,
  codeBlock,
  emphasis,
  // Types
  type FormatConverter,
  inlineCode,
  link,
  type MarkdownConverter,
  markdownToPlainText,
  paragraph,
  // Parsing and stringifying
  parseMarkdown,
  root,
  strikethrough,
  stringifyMarkdown,
  strong,
  // AST node builders
  text,
  toPlainText,
  walkAst,
} from "./markdown";

// Types
export type {
  Adapter,
  Attachment,
  Author,
  ChatConfig,
  ChatInstance,
  FetchOptions,
  FormattedContent,
  Lock,
  Logger,
  LogLevel,
  MentionHandler,
  Message,
  MessageHandler,
  MessageMetadata,
  PostableAst,
  PostableMarkdown,
  PostableMessage,
  PostableRaw,
  RawMessage,
  SentMessage,
  StateAdapter,
  SubscribedMessageHandler,
  Thread,
  ThreadInfo,
  WebhookOptions,
} from "./types";

// Logger
export { ChatError, ConsoleLogger, LockError, RateLimitError } from "./types";
