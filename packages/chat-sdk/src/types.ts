/**
 * Core types for chat-sdk
 */

import type { Root } from "mdast";

// =============================================================================
// Logging
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Default console logger implementation.
 */
export class ConsoleLogger implements Logger {
  constructor(private level: LogLevel = "info") {}

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error", "silent"];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  // eslint-disable-next-line no-console
  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog("debug"))
      console.debug(`[chat-sdk] ${message}`, ...args);
  }

  // eslint-disable-next-line no-console
  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog("info")) console.info(`[chat-sdk] ${message}`, ...args);
  }

  // eslint-disable-next-line no-console
  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog("warn")) console.warn(`[chat-sdk] ${message}`, ...args);
  }

  // eslint-disable-next-line no-console
  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog("error"))
      console.error(`[chat-sdk] ${message}`, ...args);
  }
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Chat configuration with type-safe adapter inference.
 * @template TAdapters - Record of adapter name to adapter instance
 */
export interface ChatConfig<
  TAdapters extends Record<string, Adapter> = Record<string, Adapter>,
> {
  /** Default bot username across all adapters */
  userName: string;
  /** Map of adapter name to adapter instance */
  adapters: TAdapters;
  /** State adapter for subscriptions and locking */
  state: StateAdapter;
  /**
   * Logger instance or log level. Defaults to "info".
   * Pass "silent" to disable all logging.
   */
  logger?: Logger | LogLevel;
}

/**
 * Options for webhook handling.
 */
export interface WebhookOptions {
  /**
   * Function to run message handling in the background.
   * Use this to ensure fast webhook responses while processing continues.
   *
   * @example
   * // Next.js App Router
   * import { after } from "next/server";
   * chat.webhooks.slack(request, { waitUntil: (p) => after(() => p) });
   *
   * @example
   * // Vercel Functions
   * import { waitUntil } from "@vercel/functions";
   * chat.webhooks.slack(request, { waitUntil });
   */
  waitUntil?: (task: Promise<unknown>) => void;
}

// =============================================================================
// Adapter Interface
// =============================================================================

/**
 * Adapter interface with generics for platform-specific types.
 * @template TThreadId - Platform-specific thread ID data type
 * @template TRawMessage - Platform-specific raw message type
 */
export interface Adapter<TThreadId = unknown, TRawMessage = unknown> {
  /** Unique name for this adapter (e.g., "slack", "teams") */
  readonly name: string;
  /** Bot username (can override global userName) */
  readonly userName: string;
  /** Bot user ID for platforms that use IDs in mentions (e.g., Slack's <@U123>) */
  readonly botUserId?: string;

  /** Called when Chat instance is created (internal use) */
  initialize(chat: ChatInstance): Promise<void>;

  /** Handle incoming webhook request */
  handleWebhook(request: Request, options?: WebhookOptions): Promise<Response>;

  /** Post a message to a thread */
  postMessage(
    threadId: string,
    message: PostableMessage,
  ): Promise<RawMessage<TRawMessage>>;

  /** Edit an existing message */
  editMessage(
    threadId: string,
    messageId: string,
    message: PostableMessage,
  ): Promise<RawMessage<TRawMessage>>;

  /** Delete a message */
  deleteMessage(threadId: string, messageId: string): Promise<void>;

  /** Add a reaction to a message */
  addReaction(
    threadId: string,
    messageId: string,
    emoji: string,
  ): Promise<void>;

  /** Remove a reaction from a message */
  removeReaction(
    threadId: string,
    messageId: string,
    emoji: string,
  ): Promise<void>;

  /** Show typing indicator */
  startTyping(threadId: string): Promise<void>;

  /** Fetch messages from a thread */
  fetchMessages(
    threadId: string,
    options?: FetchOptions,
  ): Promise<Message<TRawMessage>[]>;

  /** Fetch thread metadata */
  fetchThread(threadId: string): Promise<ThreadInfo>;

  /** Encode platform-specific data into a thread ID string */
  encodeThreadId(platformData: TThreadId): string;

  /** Decode thread ID string back to platform-specific data */
  decodeThreadId(threadId: string): TThreadId;

  /** Parse platform message format to normalized format */
  parseMessage(raw: TRawMessage): Message<TRawMessage>;

  /** Render formatted content to platform-specific string */
  renderFormatted(content: FormattedContent): string;
}

/** Internal interface for Chat instance passed to adapters */
export interface ChatInstance {
  handleIncomingMessage(
    adapter: Adapter,
    threadId: string,
    message: Message,
  ): Promise<void>;
  getState(): StateAdapter;
  getUserName(): string;
  /** Get the configured logger */
  getLogger(): Logger;
}

// =============================================================================
// State Adapter Interface
// =============================================================================

export interface StateAdapter {
  /** Connect to the state backend */
  connect(): Promise<void>;

  /** Disconnect from the state backend */
  disconnect(): Promise<void>;

  /** Subscribe to a thread (persists across restarts) */
  subscribe(threadId: string): Promise<void>;

  /** Unsubscribe from a thread */
  unsubscribe(threadId: string): Promise<void>;

  /** Check if subscribed to a thread */
  isSubscribed(threadId: string): Promise<boolean>;

  /** List all subscriptions, optionally filtered by adapter */
  listSubscriptions(adapterName?: string): AsyncIterable<string>;

  /** Acquire a lock on a thread (returns null if already locked) */
  acquireLock(threadId: string, ttlMs: number): Promise<Lock | null>;

  /** Release a lock */
  releaseLock(lock: Lock): Promise<void>;

  /** Extend a lock's TTL */
  extendLock(lock: Lock, ttlMs: number): Promise<boolean>;
}

export interface Lock {
  threadId: string;
  token: string;
  expiresAt: number;
}

// =============================================================================
// Thread
// =============================================================================

export interface Thread<TRawMessage = unknown> {
  /** Unique thread ID (format: "adapter:channel:thread") */
  readonly id: string;
  /** The adapter this thread belongs to */
  readonly adapter: Adapter;
  /** Channel/conversation ID */
  readonly channelId: string;

  /** Recently fetched messages (cached) */
  recentMessages: Message<TRawMessage>[];

  /** Async iterator for all messages in the thread */
  allMessages: AsyncIterable<Message<TRawMessage>>;

  /** Subscribe to future messages in this thread */
  subscribe(): Promise<void>;

  /** Unsubscribe from this thread */
  unsubscribe(): Promise<void>;

  /** Post a message to this thread */
  post(message: string | PostableMessage): Promise<SentMessage<TRawMessage>>;

  /** Show typing indicator */
  startTyping(): Promise<void>;

  /** Refresh recentMessages from the API */
  refresh(): Promise<void>;

  /**
   * Get a platform-specific mention string for a user.
   * Use this to @-mention a user in a message.
   * @example
   * await thread.post(`Hey ${thread.mentionUser(userId)}, check this out!`);
   */
  mentionUser(userId: string): string;
}

export interface ThreadInfo {
  id: string;
  channelId: string;
  channelName?: string;
  /** Platform-specific metadata */
  metadata: Record<string, unknown>;
}

export interface FetchOptions {
  /** Maximum number of messages to fetch */
  limit?: number;
  /** Fetch messages before this message ID */
  before?: string;
  /** Fetch messages after this message ID */
  after?: string;
}

// =============================================================================
// Message
// =============================================================================

/**
 * Formatted content using mdast AST.
 * This is the canonical representation of message formatting.
 */
export type FormattedContent = Root;

export interface Message<TRawMessage = unknown> {
  /** Unique message ID */
  readonly id: string;
  /** Thread this message belongs to */
  readonly threadId: string;

  /** Plain text content (all formatting stripped) */
  text: string;
  /**
   * Structured formatting as an AST (mdast Root).
   * This is the canonical representation - use this for processing.
   * Use `stringifyMarkdown(message.formatted)` to get markdown string.
   */
  formatted: FormattedContent;
  /** Platform-specific raw payload (escape hatch) */
  raw: TRawMessage;

  /** Message author */
  author: Author;
  /** Message metadata */
  metadata: MessageMetadata;
  /** Attachments */
  attachments: Attachment[];
}

/** Raw message returned from adapter (before wrapping as SentMessage) */
export interface RawMessage<TRawMessage = unknown> {
  id: string;
  threadId: string;
  raw: TRawMessage;
}

export interface Author {
  /** Unique user ID */
  userId: string;
  /** Username/handle for @-mentions */
  userName: string;
  /** Display name */
  fullName: string;
  /** Whether the author is a bot */
  isBot: boolean | "unknown";
  /** Whether the author is this bot */
  isMe: boolean;
}

export interface MessageMetadata {
  /** When the message was sent */
  dateSent: Date;
  /** Whether the message has been edited */
  edited: boolean;
  /** When the message was last edited */
  editedAt?: Date;
}

// =============================================================================
// Sent Message (returned from thread.post())
// =============================================================================

export interface SentMessage<TRawMessage = unknown>
  extends Message<TRawMessage> {
  /** Edit this message */
  edit(newContent: string | PostableMessage): Promise<SentMessage<TRawMessage>>;
  /** Delete this message */
  delete(): Promise<void>;
  /** Add a reaction to this message */
  addReaction(emoji: string): Promise<void>;
  /** Remove a reaction from this message */
  removeReaction(emoji: string): Promise<void>;
}

// =============================================================================
// Postable Message
// =============================================================================

/**
 * A message that can be posted to a thread.
 *
 * - `string` - Raw text, passed through as-is to the platform
 * - `{ raw: string }` - Explicit raw text, passed through as-is
 * - `{ markdown: string }` - Markdown text, converted to platform format
 * - `{ ast: Root }` - mdast AST, converted to platform format
 */
export type PostableMessage =
  | string
  | PostableRaw
  | PostableMarkdown
  | PostableAst;

export interface PostableRaw {
  /** Raw text passed through as-is to the platform */
  raw: string;
  /** File/image attachments */
  attachments?: Attachment[];
}

export interface PostableMarkdown {
  /** Markdown text, converted to platform format */
  markdown: string;
  /** File/image attachments */
  attachments?: Attachment[];
}

export interface PostableAst {
  /** mdast AST, converted to platform format */
  ast: Root;
  /** File/image attachments */
  attachments?: Attachment[];
}

export interface Attachment {
  type: "image" | "file";
  /** URL to the file (for linking) */
  url?: string;
  /** Binary data (for uploading) */
  data?: Buffer | Blob;
  /** Filename */
  name?: string;
  /** MIME type */
  mimeType?: string;
}

// =============================================================================
// Event Handlers
// =============================================================================

export type MentionHandler = (
  thread: Thread,
  message: Message,
) => Promise<void>;

export type MessageHandler = (
  thread: Thread,
  message: Message,
) => Promise<void>;

export type SubscribedHandler = (
  thread: Thread,
  message: Message,
) => Promise<void>;

// =============================================================================
// Errors
// =============================================================================

export class ChatError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

export class RateLimitError extends ChatError {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
    cause?: unknown,
  ) {
    super(message, "RATE_LIMITED", cause);
    this.name = "RateLimitError";
  }
}

export class LockError extends ChatError {
  constructor(message: string, cause?: unknown) {
    super(message, "LOCK_FAILED", cause);
    this.name = "LockError";
  }
}
