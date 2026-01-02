/**
 * Core types for chat-sdk
 */

import type { Root } from "mdast";
import type { CardElement } from "./cards";
import type { CardJSXElement } from "./jsx-runtime";

// =============================================================================
// Logging
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  /** Create a sub-logger with a prefix */
  child(prefix: string): Logger;
}

/**
 * Default console logger implementation.
 */
export class ConsoleLogger implements Logger {
  private prefix: string;

  constructor(
    private level: LogLevel = "info",
    prefix = "chat-sdk",
  ) {
    this.prefix = prefix;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error", "silent"];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  child(prefix: string): Logger {
    return new ConsoleLogger(this.level, `${this.prefix}:${prefix}`);
  }

  // eslint-disable-next-line no-console
  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog("debug"))
      console.debug(`[${this.prefix}] ${message}`, ...args);
  }

  // eslint-disable-next-line no-console
  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog("info"))
      console.info(`[${this.prefix}] ${message}`, ...args);
  }

  // eslint-disable-next-line no-console
  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog("warn"))
      console.warn(`[${this.prefix}] ${message}`, ...args);
  }

  // eslint-disable-next-line no-console
  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog("error"))
      console.error(`[${this.prefix}] ${message}`, ...args);
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
    emoji: EmojiValue | string,
  ): Promise<void>;

  /** Remove a reaction from a message */
  removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
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

  /**
   * Optional hook called when a thread is subscribed to.
   * Adapters can use this to set up platform-specific subscriptions
   * (e.g., Google Chat Workspace Events).
   */
  onThreadSubscribe?(threadId: string): Promise<void>;

  /**
   * Open a direct message conversation with a user.
   *
   * @param userId - The platform-specific user ID
   * @returns The thread ID for the DM conversation
   *
   * @example
   * ```typescript
   * const dmThreadId = await adapter.openDM("U123456");
   * await adapter.postMessage(dmThreadId, "Hello!");
   * ```
   */
  openDM?(userId: string): Promise<string>;

  /**
   * Check if a thread is a direct message conversation.
   *
   * @param threadId - The thread ID to check
   * @returns True if the thread is a DM, false otherwise
   */
  isDM?(threadId: string): boolean;
}

/** Internal interface for Chat instance passed to adapters */
export interface ChatInstance {
  /**
   * Process an incoming message from an adapter.
   * Handles waitUntil registration and error catching internally.
   *
   * @param adapter - The adapter that received the message
   * @param threadId - The thread ID
   * @param message - Either a parsed message, or a factory function for lazy async parsing
   * @param options - Webhook options including waitUntil
   */
  processMessage(
    adapter: Adapter,
    threadId: string,
    message: Message | (() => Promise<Message>),
    options?: WebhookOptions,
  ): void;

  /**
   * @deprecated Use processMessage instead. This method is for internal use.
   */
  handleIncomingMessage(
    adapter: Adapter,
    threadId: string,
    message: Message,
  ): Promise<void>;

  /**
   * Process an incoming reaction event from an adapter.
   * Handles waitUntil registration and error catching internally.
   *
   * @param event - The reaction event (without adapter field, will be added)
   * @param options - Webhook options including waitUntil
   */
  processReaction(
    event: Omit<ReactionEvent, "adapter" | "thread"> & { adapter?: Adapter },
    options?: WebhookOptions,
  ): void;

  /**
   * Process an incoming action event (button click) from an adapter.
   * Handles waitUntil registration and error catching internally.
   *
   * @param event - The action event (without thread field, will be added)
   * @param options - Webhook options including waitUntil
   */
  processAction(
    event: Omit<ActionEvent, "thread"> & { adapter: Adapter },
    options?: WebhookOptions,
  ): void;

  getState(): StateAdapter;
  getUserName(): string;
  /** Get the configured logger, optionally with a child prefix */
  getLogger(prefix?: string): Logger;
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

  /** Get a cached value by key */
  get<T = unknown>(key: string): Promise<T | null>;

  /** Set a cached value with optional TTL in milliseconds */
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;

  /** Delete a cached value */
  delete(key: string): Promise<void>;
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
  /** Whether this is a direct message conversation */
  readonly isDM: boolean;

  /** Recently fetched messages (cached) */
  recentMessages: Message<TRawMessage>[];

  /** Async iterator for all messages in the thread */
  allMessages: AsyncIterable<Message<TRawMessage>>;

  /**
   * Check if this thread is currently subscribed.
   *
   * In subscribed message handlers, this is optimized to return true immediately
   * without a state lookup, since we already know we're in a subscribed context.
   *
   * @returns Promise resolving to true if subscribed, false otherwise
   */
  isSubscribed(): Promise<boolean>;

  /**
   * Subscribe to future messages in this thread.
   *
   * Once subscribed, all messages in this thread will trigger `onSubscribedMessage` handlers.
   * The initial message that triggered subscription will NOT fire the handler.
   *
   * @example
   * ```typescript
   * chat.onNewMention(async (thread, message) => {
   *   await thread.subscribe();  // Subscribe to follow-up messages
   *   await thread.post("I'm now watching this thread!");
   * });
   * ```
   */
  subscribe(): Promise<void>;

  /**
   * Unsubscribe from this thread.
   *
   * Future messages will no longer trigger `onSubscribedMessage` handlers.
   */
  unsubscribe(): Promise<void>;

  /**
   * Post a message to this thread.
   *
   * @param message - String, PostableMessage, or JSX Card element to send
   * @returns A SentMessage with methods to edit, delete, or add reactions
   *
   * @example
   * ```typescript
   * // Simple string
   * await thread.post("Hello!");
   *
   * // Markdown
   * await thread.post({ markdown: "**Bold** and _italic_" });
   *
   * // With emoji
   * await thread.post(`${emoji.thumbs_up} Great job!`);
   *
   * // JSX Card (with @jsxImportSource chat-sdk)
   * await thread.post(
   *   <Card title="Welcome!">
   *     <Text>Hello world</Text>
   *   </Card>
   * );
   * ```
   */
  post(
    message: string | PostableMessage | CardJSXElement,
  ): Promise<SentMessage<TRawMessage>>;

  /**
   * Show typing indicator in the thread.
   *
   * Some platforms support persistent typing indicators, others just send once.
   */
  startTyping(): Promise<void>;

  /**
   * Refresh `recentMessages` from the API.
   *
   * Fetches the latest 50 messages and updates `recentMessages`.
   */
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
  /** Whether this is a direct message conversation */
  isDM?: boolean;
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

  /**
   * Whether the bot is @-mentioned in this message.
   *
   * This is set by the Chat SDK before passing the message to handlers.
   * It checks for `@username` in the message text using the adapter's
   * configured `userName` and optional `botUserId`.
   *
   * @example
   * ```typescript
   * chat.onSubscribedMessage(async (thread, message) => {
   *   if (message.isMention) {
   *     await thread.post("You mentioned me!");
   *   }
   * });
   * ```
   */
  isMention?: boolean;
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
  /** Edit this message with text, a PostableMessage, or a JSX Card element */
  edit(
    newContent: string | PostableMessage | CardJSXElement,
  ): Promise<SentMessage<TRawMessage>>;
  /** Delete this message */
  delete(): Promise<void>;
  /** Add a reaction to this message */
  addReaction(emoji: EmojiValue | string): Promise<void>;
  /** Remove a reaction from this message */
  removeReaction(emoji: EmojiValue | string): Promise<void>;
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
 * - `{ card: CardElement }` - Rich card with buttons (Block Kit / Adaptive Cards / GChat Cards)
 * - `CardElement` - Direct card element
 */
export type PostableMessage =
  | string
  | PostableRaw
  | PostableMarkdown
  | PostableAst
  | PostableCard
  | CardElement;

export interface PostableRaw {
  /** Raw text passed through as-is to the platform */
  raw: string;
  /** File/image attachments */
  attachments?: Attachment[];
  /** Files to upload */
  files?: FileUpload[];
}

export interface PostableMarkdown {
  /** Markdown text, converted to platform format */
  markdown: string;
  /** File/image attachments */
  attachments?: Attachment[];
  /** Files to upload */
  files?: FileUpload[];
}

export interface PostableAst {
  /** mdast AST, converted to platform format */
  ast: Root;
  /** File/image attachments */
  attachments?: Attachment[];
  /** Files to upload */
  files?: FileUpload[];
}

export interface PostableCard {
  /** Rich card element */
  card: CardElement;
  /** Fallback text for platforms/clients that can't render cards */
  fallbackText?: string;
  /** Files to upload */
  files?: FileUpload[];
}

export interface Attachment {
  /** Type of attachment */
  type: "image" | "file" | "video" | "audio";
  /** URL to the file (for linking/downloading) */
  url?: string;
  /** Binary data (for uploading or if already fetched) */
  data?: Buffer | Blob;
  /** Filename */
  name?: string;
  /** MIME type */
  mimeType?: string;
  /** File size in bytes */
  size?: number;
  /** Image/video width (if applicable) */
  width?: number;
  /** Image/video height (if applicable) */
  height?: number;
  /**
   * Fetch the attachment data.
   * For platforms that require authentication (like Slack private URLs),
   * this method handles the auth automatically.
   */
  fetchData?: () => Promise<Buffer>;
}

/**
 * File to upload with a message.
 */
export interface FileUpload {
  /** Binary data */
  data: Buffer | Blob | ArrayBuffer;
  /** Filename */
  filename: string;
  /** MIME type (optional, will be inferred from filename if not provided) */
  mimeType?: string;
}

// =============================================================================
// Event Handlers
// =============================================================================

/**
 * Handler for new @-mentions of the bot.
 *
 * **Important**: This handler is ONLY called for mentions in **unsubscribed** threads.
 * Once a thread is subscribed (via `thread.subscribe()`), subsequent messages
 * including @-mentions go to `onSubscribedMessage` handlers instead.
 *
 * To detect mentions in subscribed threads, check `message.isMention`:
 *
 * @example
 * ```typescript
 * // Handle new mentions (unsubscribed threads only)
 * chat.onNewMention(async (thread, message) => {
 *   await thread.subscribe();  // Subscribe to follow-up messages
 *   await thread.post("Hello! I'll be watching this thread.");
 * });
 *
 * // Handle all messages in subscribed threads
 * chat.onSubscribedMessage(async (thread, message) => {
 *   if (message.isMention) {
 *     // User @-mentioned us in a thread we're already watching
 *     await thread.post("You mentioned me again!");
 *   }
 * });
 * ```
 */
export type MentionHandler = (
  thread: Thread,
  message: Message,
) => Promise<void>;

/**
 * Handler for messages matching a regex pattern.
 *
 * Registered via `chat.onNewMessage(pattern, handler)`. Called when a message
 * matches the pattern in an unsubscribed thread.
 */
export type MessageHandler = (
  thread: Thread,
  message: Message,
) => Promise<void>;

/**
 * Handler for messages in subscribed threads.
 *
 * Called for all messages in threads that have been subscribed via `thread.subscribe()`.
 * This includes:
 * - Follow-up messages from users
 * - Messages that @-mention the bot (check `message.isMention`)
 *
 * Does NOT fire for:
 * - The message that triggered the subscription (e.g., the initial @mention)
 * - Messages sent by the bot itself
 *
 * @example
 * ```typescript
 * chat.onSubscribedMessage(async (thread, message) => {
 *   // Handle all follow-up messages
 *   if (message.isMention) {
 *     // User @-mentioned us in a subscribed thread
 *   }
 *   await thread.post(`Got your message: ${message.text}`);
 * });
 * ```
 */
export type SubscribedMessageHandler = (
  thread: Thread,
  message: Message,
) => Promise<void>;

// =============================================================================
// Reactions / Emoji
// =============================================================================

/**
 * Well-known emoji that work across platforms (Slack and Google Chat).
 * These are normalized to a common format regardless of platform.
 */
export type WellKnownEmoji =
  // Reactions & Gestures
  | "thumbs_up"
  | "thumbs_down"
  | "clap"
  | "wave"
  | "pray"
  | "muscle"
  | "ok_hand"
  | "point_up"
  | "point_down"
  | "point_left"
  | "point_right"
  | "raised_hands"
  | "shrug"
  | "facepalm"
  // Emotions & Faces
  | "heart"
  | "smile"
  | "laugh"
  | "thinking"
  | "sad"
  | "cry"
  | "angry"
  | "love_eyes"
  | "cool"
  | "wink"
  | "surprised"
  | "worried"
  | "confused"
  | "neutral"
  | "sleeping"
  | "sick"
  | "mind_blown"
  | "relieved"
  | "grimace"
  | "rolling_eyes"
  | "hug"
  | "zany"
  // Status & Symbols
  | "check"
  | "x"
  | "question"
  | "exclamation"
  | "warning"
  | "stop"
  | "info"
  | "100"
  | "fire"
  | "star"
  | "sparkles"
  | "lightning"
  | "boom"
  | "eyes"
  // Status Indicators
  | "green_circle"
  | "yellow_circle"
  | "red_circle"
  | "blue_circle"
  | "white_circle"
  | "black_circle"
  // Objects & Tools
  | "rocket"
  | "party"
  | "confetti"
  | "balloon"
  | "gift"
  | "trophy"
  | "medal"
  | "lightbulb"
  | "gear"
  | "wrench"
  | "hammer"
  | "bug"
  | "link"
  | "lock"
  | "unlock"
  | "key"
  | "pin"
  | "memo"
  | "clipboard"
  | "calendar"
  | "clock"
  | "hourglass"
  | "bell"
  | "megaphone"
  | "speech_bubble"
  | "email"
  | "inbox"
  | "outbox"
  | "package"
  | "folder"
  | "file"
  | "chart_up"
  | "chart_down"
  | "coffee"
  | "pizza"
  | "beer"
  // Arrows & Directions
  | "arrow_up"
  | "arrow_down"
  | "arrow_left"
  | "arrow_right"
  | "refresh"
  // Nature & Weather
  | "sun"
  | "cloud"
  | "rain"
  | "snow"
  | "rainbow";

/**
 * Platform-specific emoji formats for a single emoji.
 */
export interface EmojiFormats {
  /** Slack emoji name (without colons), e.g., "+1", "heart" */
  slack: string | string[];
  /** Google Chat unicode emoji, e.g., "👍", "❤️" */
  gchat: string | string[];
}

/**
 * Emoji map type - can be extended by users to add custom emoji.
 *
 * @example
 * ```typescript
 * // Extend with custom emoji
 * declare module "chat-sdk" {
 *   interface CustomEmojiMap {
 *     "custom_emoji": EmojiFormats;
 *   }
 * }
 *
 * const myEmojiMap: EmojiMapConfig = {
 *   custom_emoji: { slack: "custom", gchat: "🎯" },
 * };
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Required for TypeScript module augmentation
export interface CustomEmojiMap {}

/**
 * Full emoji type including well-known and custom emoji.
 */
export type Emoji = WellKnownEmoji | keyof CustomEmojiMap;

/**
 * Configuration for emoji mapping.
 */
export type EmojiMapConfig = Partial<Record<Emoji, EmojiFormats>>;

/**
 * Immutable emoji value object with object identity.
 *
 * These objects are singletons - the same emoji name always returns
 * the same frozen object instance, enabling `===` comparison.
 *
 * @example
 * ```typescript
 * // Object identity comparison works
 * if (event.emoji === emoji.thumbs_up) {
 *   console.log("User gave a thumbs up!");
 * }
 *
 * // Works in template strings via toString()
 * await thread.post(`${emoji.thumbs_up} Great job!`);
 * ```
 */
export interface EmojiValue {
  /** The normalized emoji name (e.g., "thumbs_up") */
  readonly name: string;
  /** Returns the placeholder string for message formatting */
  toString(): string;
  /** Returns the placeholder string (for JSON.stringify) */
  toJSON(): string;
}

/**
 * Reaction event fired when a user adds or removes a reaction.
 */
export interface ReactionEvent<TRawMessage = unknown> {
  /** The normalized emoji as an EmojiValue singleton (enables `===` comparison) */
  emoji: EmojiValue;
  /** The raw platform-specific emoji (e.g., "+1" for Slack, "👍" for GChat) */
  rawEmoji: string;
  /** Whether the reaction was added (true) or removed (false) */
  added: boolean;
  /** The user who added/removed the reaction */
  user: Author;
  /** The message that was reacted to (if available) */
  message?: Message<TRawMessage>;
  /** The message ID that was reacted to */
  messageId: string;
  /** The thread ID */
  threadId: string;
  /**
   * The thread where the reaction occurred.
   * Use this to post replies or check subscription status.
   *
   * @example
   * ```typescript
   * chat.onReaction([emoji.thumbs_up], async (event) => {
   *   await event.thread.post(`Thanks for the ${event.emoji}!`);
   * });
   * ```
   */
  thread: Thread<TRawMessage>;
  /** The adapter that received the event */
  adapter: Adapter;
  /** Platform-specific raw event data */
  raw: unknown;
}

/**
 * Handler for reaction events.
 *
 * @example
 * ```typescript
 * // Handle specific emoji
 * chat.onReaction(["thumbs_up", "heart"], async (event) => {
 *   console.log(`${event.user.userName} ${event.added ? "added" : "removed"} ${event.emoji}`);
 * });
 *
 * // Handle all reactions
 * chat.onReaction(async (event) => {
 *   // ...
 * });
 * ```
 */
export type ReactionHandler = (event: ReactionEvent) => Promise<void>;

// =============================================================================
// Action Events (Button Clicks)
// =============================================================================

/**
 * Action event fired when a user clicks a button in a card.
 *
 * @example
 * ```typescript
 * chat.onAction("approve", async (event) => {
 *   await event.thread.post(`Order ${event.value} approved by ${event.user.userName}`);
 * });
 * ```
 */
export interface ActionEvent<TRawMessage = unknown> {
  /** The action ID from the button (matches Button's `id` prop) */
  actionId: string;
  /** Optional value/payload from the button */
  value?: string;
  /** User who clicked the button */
  user: Author;
  /** The thread where the action occurred */
  thread: Thread<TRawMessage>;
  /** The message ID containing the card */
  messageId: string;
  /** The thread ID */
  threadId: string;
  /** The adapter that received the event */
  adapter: Adapter;
  /** Platform-specific raw event data */
  raw: unknown;
}

/**
 * Handler for action events (button clicks in cards).
 *
 * @example
 * ```typescript
 * // Handle specific action
 * chat.onAction("approve", async (event) => {
 *   await event.thread.post("Approved!");
 * });
 *
 * // Handle multiple actions
 * chat.onAction(["approve", "reject"], async (event) => {
 *   if (event.actionId === "approve") {
 *     // ...
 *   }
 * });
 *
 * // Handle all actions (catch-all)
 * chat.onAction(async (event) => {
 *   console.log(`Action: ${event.actionId}`);
 * });
 * ```
 */
export type ActionHandler = (event: ActionEvent) => Promise<void>;

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

export class NotImplementedError extends ChatError {
  constructor(
    message: string,
    public readonly feature?: string,
    cause?: unknown,
  ) {
    super(message, "NOT_IMPLEMENTED", cause);
    this.name = "NotImplementedError";
  }
}
