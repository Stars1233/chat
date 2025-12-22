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
  SubscribedHandler,
  Thread,
  WebhookOptions,
} from "./types";
import { ConsoleLogger, LockError } from "./types";

const DEFAULT_LOCK_TTL_MS = 30_000; // 30 seconds

interface MessagePattern {
  pattern: RegExp;
  handler: MessageHandler;
}

/**
 * Type-safe webhook handler that is available for each adapter.
 */
type WebhookHandler = (
  request: Request,
  options?: WebhookOptions
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
  TAdapters extends Record<string, Adapter> = Record<string, Adapter>
> implements ChatInstance
{
  private adapters: Map<string, Adapter>;
  private state: StateAdapter;
  private userName: string;
  private logger: Logger;

  private mentionHandlers: MentionHandler[] = [];
  private messagePatterns: MessagePattern[] = [];
  private subscribedHandlers: SubscribedHandler[] = [];

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
    options?: WebhookOptions
  ): Promise<Response> {
    this.logger.debug("Webhook received", { adapter: adapterName });

    // Ensure initialization
    await this.ensureInitialized();
    this.logger.debug("Initialization complete", { adapter: adapterName });

    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      return new Response(`Unknown adapter: ${adapterName}`, { status: 404 });
    }

    this.logger.debug("Calling adapter webhook handler", {
      adapter: adapterName,
    });
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
      }
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
   */
  onSubscribed(handler: SubscribedHandler): void {
    this.subscribedHandlers.push(handler);
    this.logger.debug("Registered subscribed handler");
  }

  /**
   * Get an adapter by name with type safety.
   */
  getAdapter<K extends keyof TAdapters>(name: K): TAdapters[K] {
    return this.adapters.get(name as string) as TAdapters[K];
  }

  // ChatInstance interface implementations
  getState(): StateAdapter {
    return this.state;
  }

  getUserName(): string {
    return this.userName;
  }

  getLogger(): Logger {
    return this.logger;
  }

  /**
   * Handle an incoming message from an adapter.
   * This is called by adapters when they receive a webhook.
   */
  async handleIncomingMessage(
    adapter: Adapter,
    threadId: string,
    message: Message
  ): Promise<void> {
    this.logger.debug("Incoming message", {
      adapter: adapter.name,
      threadId,
      author: message.author.userName,
      isMe: message.author.isMe,
    });

    // Skip messages from self
    if (message.author.isMe) {
      this.logger.debug("Skipping self message");
      return;
    }

    // Try to acquire lock on thread
    const lock = await this.state.acquireLock(threadId, DEFAULT_LOCK_TTL_MS);
    if (!lock) {
      this.logger.warn("Could not acquire lock on thread", { threadId });
      throw new LockError(
        `Could not acquire lock on thread ${threadId}. Another instance may be processing.`
      );
    }

    this.logger.debug("Lock acquired", { threadId, token: lock.token });

    try {
      // Create thread object
      const thread = await this.createThread(adapter, threadId, message);

      // Check if this is a subscribed thread first
      const isSubscribed = await this.state.isSubscribed(threadId);
      if (isSubscribed) {
        this.logger.debug("Message in subscribed thread", { threadId });
        await this.runHandlers(this.subscribedHandlers, thread, message);
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
      for (const { pattern, handler } of this.messagePatterns) {
        if (pattern.test(message.text)) {
          this.logger.debug("Message matched pattern", {
            pattern: pattern.toString(),
          });
          await handler(thread, message);
        }
      }
    } finally {
      await this.state.releaseLock(lock);
      this.logger.debug("Lock released", { threadId });
    }
  }

  private async createThread(
    adapter: Adapter,
    threadId: string,
    initialMessage: Message
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
      "i"
    );
    if (usernamePattern.test(message.text)) {
      return true;
    }

    // Fallback: check for user ID mention if available (e.g., @U_BOT_123)
    if (botUserId) {
      const userIdPattern = new RegExp(
        `@${this.escapeRegex(botUserId)}\\b`,
        "i"
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
    message: Message
  ): Promise<void> {
    for (const handler of handlers) {
      await handler(thread, message);
    }
  }
}
