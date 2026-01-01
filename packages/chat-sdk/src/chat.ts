import { ThreadImpl } from "./thread";
import type {
  Adapter,
  ChatConfig,
  ChatInstance,
  Logger,
  LogLevel,
  MentionHandler,
  Message,
  MessageHandler,
  StateAdapter,
  SubscribedMessageHandler,
  Thread,
  WebhookOptions,
} from "./types";
import { ConsoleLogger, LockError } from "./types";

const DEFAULT_LOCK_TTL_MS = 30_000; // 30 seconds
/** TTL for message deduplication entries */
const DEDUPE_TTL_MS = 60_000; // 60 seconds

interface MessagePattern {
  pattern: RegExp;
  handler: MessageHandler;
}

/**
 * Type-safe webhook handler that is available for each adapter.
 */
type WebhookHandler = (
  request: Request,
  options?: WebhookOptions,
) => Promise<Response>;

/**
 * Creates a type-safe webhooks object based on the adapter names.
 */
type Webhooks<TAdapters extends Record<string, Adapter>> = {
  [K in keyof TAdapters]: WebhookHandler;
};

/**
 * Main Chat class with type-safe adapter inference.
 *
 * @example
 * const chat = new Chat({
 *   userName: "mybot",
 *   adapters: {
 *     slack: createSlackAdapter({ ... }),
 *     teams: createTeamsAdapter({ ... }),
 *   },
 *   state: createMemoryState(),
 * });
 *
 * // Type-safe: only 'slack' and 'teams' are valid
 * chat.webhooks.slack(request, { waitUntil });
 */
export class Chat<
  TAdapters extends Record<string, Adapter> = Record<string, Adapter>,
> implements ChatInstance
{
  private adapters: Map<string, Adapter>;
  private state: StateAdapter;
  private userName: string;
  private logger: Logger;

  private mentionHandlers: MentionHandler[] = [];
  private messagePatterns: MessagePattern[] = [];
  private subscribedMessageHandlers: SubscribedMessageHandler[] = [];

  /** Initialization state */
  private initPromise: Promise<void> | null = null;
  private initialized = false;

  /**
   * Type-safe webhook handlers keyed by adapter name.
   * @example
   * chat.webhooks.slack(request, { backgroundTask: waitUntil });
   */
  public readonly webhooks: Webhooks<TAdapters>;

  constructor(config: ChatConfig<TAdapters>) {
    this.userName = config.userName;
    this.state = config.state;
    this.adapters = new Map();

    // Initialize logger
    if (!config.logger) {
      this.logger = new ConsoleLogger("info");
    } else if (typeof config.logger === "string") {
      this.logger = new ConsoleLogger(config.logger as LogLevel);
    } else {
      this.logger = config.logger;
    }

    // Register adapters and create webhook handlers
    const webhooks = {} as Record<string, WebhookHandler>;
    for (const [name, adapter] of Object.entries(config.adapters)) {
      this.adapters.set(name, adapter);
      // Create webhook handler for each adapter
      webhooks[name] = (request: Request, options?: WebhookOptions) =>
        this.handleWebhook(name, request, options);
    }
    this.webhooks = webhooks as Webhooks<TAdapters>;

    this.logger.debug("Chat instance created", {
      adapters: Object.keys(config.adapters),
    });
  }

  /**
   * Handle a webhook request for a specific adapter.
   * Automatically initializes adapters on first call.
   */
  private async handleWebhook(
    adapterName: string,
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    // Ensure initialization
    await this.ensureInitialized();

    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      return new Response(`Unknown adapter: ${adapterName}`, { status: 404 });
    }

    return adapter.handleWebhook(request, options);
  }

  /**
   * Ensure the chat instance is initialized.
   * This is called automatically before handling webhooks.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Avoid concurrent initialization
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }

    await this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    this.logger.info("Initializing chat instance...");
    await this.state.connect();
    this.logger.debug("State connected");

    const initPromises = Array.from(this.adapters.values()).map(
      async (adapter) => {
        this.logger.debug("Initializing adapter", adapter.name);
        const result = await adapter.initialize(this);
        this.logger.debug("Adapter initialized", adapter.name);
        return result;
      },
    );
    await Promise.all(initPromises);

    this.initialized = true;
    this.logger.info("Chat instance initialized", {
      adapters: Array.from(this.adapters.keys()),
    });
  }

  /**
   * Gracefully shut down the chat instance.
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down chat instance...");
    await this.state.disconnect();
    this.initialized = false;
    this.initPromise = null;
    this.logger.info("Chat instance shut down");
  }

  /**
   * Register a handler for new @-mentions of the bot.
   */
  onNewMention(handler: MentionHandler): void {
    this.mentionHandlers.push(handler);
    this.logger.debug("Registered mention handler");
  }

  /**
   * Register a handler for messages matching a pattern.
   */
  onNewMessage(pattern: RegExp, handler: MessageHandler): void {
    this.messagePatterns.push({ pattern, handler });
    this.logger.debug("Registered message pattern handler", {
      pattern: pattern.toString(),
    });
  }

  /**
   * Register a handler for messages in subscribed threads.
   * This will NOT fire for:
   * - The message that triggered the subscription (e.g., the initial @mention)
   * - Messages sent by the bot itself
   */
  onSubscribedMessage(handler: SubscribedMessageHandler): void {
    this.subscribedMessageHandlers.push(handler);
    this.logger.debug("Registered subscribed message handler");
  }

  /**
   * Get an adapter by name with type safety.
   */
  getAdapter<K extends keyof TAdapters>(name: K): TAdapters[K] {
    return this.adapters.get(name as string) as TAdapters[K];
  }

  // ChatInstance interface implementations

  /**
   * Process an incoming message from an adapter.
   * Handles waitUntil registration and error catching internally.
   * Adapters should call this instead of handleIncomingMessage directly.
   */
  processMessage(
    adapter: Adapter,
    threadId: string,
    messageOrFactory: Message | (() => Promise<Message>),
    options?: WebhookOptions,
  ): void {
    const task = (async () => {
      const message =
        typeof messageOrFactory === "function"
          ? await messageOrFactory()
          : messageOrFactory;
      await this.handleIncomingMessage(adapter, threadId, message);
    })().catch((err) => {
      this.logger.error("Message processing error", { error: err, threadId });
    });

    if (options?.waitUntil) {
      options.waitUntil(task);
    }
  }

  getState(): StateAdapter {
    return this.state;
  }

  getUserName(): string {
    return this.userName;
  }

  getLogger(prefix?: string): Logger {
    if (prefix) {
      return this.logger.child(prefix);
    }
    return this.logger;
  }

  /**
   * Handle an incoming message from an adapter.
   * This is called by adapters when they receive a webhook.
   *
   * The Chat class handles common concerns centrally:
   * - Deduplication: Same message may arrive multiple times (e.g., Slack sends
   *   both `message` and `app_mention` events, GChat sends direct webhook + Pub/Sub)
   * - Bot filtering: Messages from the bot itself are skipped
   * - Locking: Only one instance processes a thread at a time
   */
  async handleIncomingMessage(
    adapter: Adapter,
    threadId: string,
    message: Message,
  ): Promise<void> {
    this.logger.debug("Incoming message", {
      adapter: adapter.name,
      threadId,
      messageId: message.id,
      text: message.text,
      author: message.author.userName,
      authorUserId: message.author.userId,
      isBot: message.author.isBot,
      isMe: message.author.isMe,
    });

    // Skip messages from self (bot's own messages)
    if (message.author.isMe) {
      this.logger.debug("Skipping message from self (isMe=true)", {
        adapter: adapter.name,
        threadId,
        author: message.author.userName,
      });
      return;
    }

    // Deduplicate messages - same message can arrive via multiple paths
    // (e.g., Slack message + app_mention events, GChat direct webhook + Pub/Sub)
    const dedupeKey = `dedupe:${adapter.name}:${message.id}`;
    const alreadyProcessed = await this.state.get<boolean>(dedupeKey);
    if (alreadyProcessed) {
      this.logger.debug("Skipping duplicate message", {
        adapter: adapter.name,
        messageId: message.id,
      });
      return;
    }
    await this.state.set(dedupeKey, true, DEDUPE_TTL_MS);

    // Try to acquire lock on thread
    const lock = await this.state.acquireLock(threadId, DEFAULT_LOCK_TTL_MS);
    if (!lock) {
      this.logger.warn("Could not acquire lock on thread", { threadId });
      throw new LockError(
        `Could not acquire lock on thread ${threadId}. Another instance may be processing.`,
      );
    }

    this.logger.debug("Lock acquired", { threadId, token: lock.token });

    try {
      // Create thread object
      const thread = await this.createThread(adapter, threadId, message);

      // Check if this is a subscribed thread first
      const isSubscribed = await this.state.isSubscribed(threadId);
      this.logger.debug("Subscription check", {
        threadId,
        isSubscribed,
        subscribedHandlerCount: this.subscribedMessageHandlers.length,
      });
      if (isSubscribed) {
        this.logger.debug("Message in subscribed thread - calling handlers", {
          threadId,
          handlerCount: this.subscribedMessageHandlers.length,
        });
        await this.runHandlers(this.subscribedMessageHandlers, thread, message);
        return;
      }

      // Check for @-mention of bot
      const isMention = this.detectMention(adapter, message);
      if (isMention) {
        this.logger.debug("Bot mentioned", {
          threadId,
          text: message.text.slice(0, 100),
        });
        await this.runHandlers(this.mentionHandlers, thread, message);
        return;
      }

      // Check message patterns
      this.logger.debug("Checking message patterns", {
        patternCount: this.messagePatterns.length,
        patterns: this.messagePatterns.map((p) => p.pattern.toString()),
        messageText: message.text,
      });
      let matchedPattern = false;
      for (const { pattern, handler } of this.messagePatterns) {
        const matches = pattern.test(message.text);
        this.logger.debug("Pattern test", {
          pattern: pattern.toString(),
          text: message.text,
          matches,
        });
        if (matches) {
          this.logger.debug("Message matched pattern - calling handler", {
            pattern: pattern.toString(),
          });
          matchedPattern = true;
          await handler(thread, message);
        }
      }

      // Log if no handlers matched
      if (!matchedPattern) {
        this.logger.debug("No handlers matched message", {
          threadId,
          text: message.text.slice(0, 100),
        });
      }
    } finally {
      await this.state.releaseLock(lock);
      this.logger.debug("Lock released", { threadId });
    }
  }

  private async createThread(
    adapter: Adapter,
    threadId: string,
    initialMessage: Message,
  ): Promise<Thread> {
    // Parse thread ID to get channel info
    // Format: "adapter:channel:thread"
    const parts = threadId.split(":");
    const channelId = parts[1] || "";

    return new ThreadImpl({
      id: threadId,
      adapter,
      channelId,
      state: this.state,
      initialMessage,
    });
  }

  /**
   * Detect if the bot was mentioned in the message.
   * All adapters normalize mentions to @name format, so we just check for @username.
   */
  private detectMention(adapter: Adapter, message: Message): boolean {
    const botUserName = adapter.userName || this.userName;
    const botUserId = adapter.botUserId;

    // Primary check: @username format (normalized by all adapters)
    const usernamePattern = new RegExp(
      `@${this.escapeRegex(botUserName)}\\b`,
      "i",
    );
    if (usernamePattern.test(message.text)) {
      return true;
    }

    // Fallback: check for user ID mention if available (e.g., @U_BOT_123)
    if (botUserId) {
      const userIdPattern = new RegExp(
        `@${this.escapeRegex(botUserId)}\\b`,
        "i",
      );
      if (userIdPattern.test(message.text)) {
        return true;
      }
    }

    return false;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private async runHandlers(
    handlers: Array<(thread: Thread, message: Message) => Promise<void>>,
    thread: Thread,
    message: Message,
  ): Promise<void> {
    for (const handler of handlers) {
      await handler(thread, message);
    }
  }
}
