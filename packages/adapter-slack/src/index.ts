import { createHmac, timingSafeEqual } from "node:crypto";
import { WebClient } from "@slack/web-api";
import type {
  Adapter,
  ChatInstance,
  FetchOptions,
  FormattedContent,
  Logger,
  Message,
  PostableMessage,
  RawMessage,
  ReactionEvent,
  ThreadInfo,
  WebhookOptions,
} from "chat-sdk";
import { defaultEmojiResolver, RateLimitError } from "chat-sdk";
import { SlackFormatConverter } from "./markdown";

export interface SlackAdapterConfig {
  /** Bot token (xoxb-...) */
  botToken: string;
  /** Signing secret for webhook verification */
  signingSecret: string;
  /** Override bot username (optional) */
  userName?: string;
  /** Bot user ID (will be fetched if not provided) */
  botUserId?: string;
}

/** Slack-specific thread ID data */
export interface SlackThreadId {
  channel: string;
  threadTs: string;
}

/** Slack event payload (raw message format) */
export interface SlackEvent {
  type: string;
  user?: string;
  bot_id?: string;
  channel?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  subtype?: string;
  username?: string;
  edited?: { ts: string };
  files?: Array<{
    mimetype?: string;
    url_private?: string;
    name?: string;
  }>;
}

/** Slack reaction event payload */
export interface SlackReactionEvent {
  type: "reaction_added" | "reaction_removed";
  user: string;
  reaction: string;
  item_user?: string;
  item: {
    type: string;
    channel: string;
    ts: string;
  };
  event_ts: string;
}

/** Slack webhook payload envelope */
interface SlackWebhookPayload {
  type: string;
  challenge?: string;
  event?: SlackEvent | SlackReactionEvent;
  event_id?: string;
  event_time?: number;
}

/** Cached user info */
interface CachedUser {
  displayName: string;
  realName: string;
}

export class SlackAdapter implements Adapter<SlackThreadId, unknown> {
  readonly name = "slack";
  readonly userName: string;

  private client: WebClient;
  private signingSecret: string;
  private chat: ChatInstance | null = null;
  private logger: Logger | null = null;
  private _botUserId: string | null = null;
  private _botId: string | null = null; // Bot app ID (B_xxx) - different from user ID
  private formatConverter = new SlackFormatConverter();
  private static USER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /** Bot user ID (e.g., U_BOT_123) used for mention detection */
  get botUserId(): string | undefined {
    return this._botUserId || undefined;
  }

  constructor(config: SlackAdapterConfig) {
    this.client = new WebClient(config.botToken);
    this.signingSecret = config.signingSecret;
    this.userName = config.userName || "bot";
    this._botUserId = config.botUserId || null;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);

    // Fetch bot user ID and bot ID if not provided
    if (!this._botUserId) {
      try {
        const authResult = await this.client.auth.test();
        this._botUserId = authResult.user_id as string;
        this._botId = (authResult.bot_id as string) || null;
        if (authResult.user) {
          (this as { userName: string }).userName = authResult.user as string;
        }
        this.logger.info("Slack auth completed", {
          botUserId: this._botUserId,
          botId: this._botId,
        });
      } catch (error) {
        this.logger.warn("Could not fetch bot user ID", { error });
      }
    }
  }

  /**
   * Look up user info from Slack API with caching via state adapter.
   * Returns display name and real name, or falls back to user ID.
   */
  private async lookupUser(
    userId: string,
  ): Promise<{ displayName: string; realName: string }> {
    const cacheKey = `slack:user:${userId}`;

    // Check cache first (via state adapter for serverless compatibility)
    if (this.chat) {
      const cached = await this.chat.getState().get<CachedUser>(cacheKey);
      if (cached) {
        return { displayName: cached.displayName, realName: cached.realName };
      }
    }

    try {
      const result = await this.client.users.info({ user: userId });
      const user = result.user as {
        name?: string;
        real_name?: string;
        profile?: { display_name?: string; real_name?: string };
      };

      // Slack user naming: profile.display_name > profile.real_name > real_name > name > userId
      const displayName =
        user?.profile?.display_name ||
        user?.profile?.real_name ||
        user?.real_name ||
        user?.name ||
        userId;
      const realName =
        user?.real_name || user?.profile?.real_name || displayName;

      // Cache the result via state adapter
      if (this.chat) {
        await this.chat
          .getState()
          .set<CachedUser>(
            cacheKey,
            { displayName, realName },
            SlackAdapter.USER_CACHE_TTL_MS,
          );
      }

      this.logger?.debug("Fetched user info", {
        userId,
        displayName,
        realName,
      });
      return { displayName, realName };
    } catch (error) {
      this.logger?.warn("Could not fetch user info", { userId, error });
      // Fall back to user ID
      return { displayName: userId, realName: userId };
    }
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    const body = await request.text();
    this.logger?.debug("Slack webhook raw body", { body });

    // Verify request signature
    const timestamp = request.headers.get("x-slack-request-timestamp");
    const signature = request.headers.get("x-slack-signature");

    if (!this.verifySignature(body, timestamp, signature)) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Parse the payload
    let payload: SlackWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Handle URL verification challenge
    if (payload.type === "url_verification" && payload.challenge) {
      return new Response(JSON.stringify({ challenge: payload.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Handle events
    if (payload.type === "event_callback" && payload.event) {
      // Respond immediately to avoid timeout
      const event = payload.event;

      // Process event asynchronously
      if (event.type === "message" || event.type === "app_mention") {
        this.handleMessageEvent(event as SlackEvent, options);
      } else if (
        event.type === "reaction_added" ||
        event.type === "reaction_removed"
      ) {
        this.handleReactionEvent(event as SlackReactionEvent, options);
      }
    }

    return new Response("ok", { status: 200 });
  }

  private verifySignature(
    body: string,
    timestamp: string | null,
    signature: string | null,
  ): boolean {
    if (!timestamp || !signature) {
      return false;
    }

    // Check timestamp is recent (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      return false;
    }

    // Compute expected signature
    const sigBasestring = `v0:${timestamp}:${body}`;
    const expectedSignature =
      "v0=" +
      createHmac("sha256", this.signingSecret)
        .update(sigBasestring)
        .digest("hex");

    // Compare signatures using timing-safe comparison
    try {
      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
    } catch {
      return false;
    }
  }

  /**
   * Handle message events from Slack.
   * Bot message filtering (isMe) is handled centrally by the Chat class.
   */
  private handleMessageEvent(
    event: SlackEvent,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) {
      this.logger?.warn("Chat instance not initialized, ignoring event");
      return;
    }

    // Skip message subtypes we don't handle (edits, deletes, etc.)
    // Note: bot_message subtype is allowed through - Chat class filters via isMe
    if (event.subtype && event.subtype !== "bot_message") {
      this.logger?.debug("Ignoring message subtype", {
        subtype: event.subtype,
      });
      return;
    }

    if (!event.channel || !event.ts) {
      this.logger?.debug("Ignoring event without channel or ts", {
        channel: event.channel,
        ts: event.ts,
      });
      return;
    }

    const threadTs = event.thread_ts || event.ts;
    const threadId = this.encodeThreadId({
      channel: event.channel,
      threadTs,
    });

    // Let Chat class handle async processing, waitUntil, and isMe filtering
    // Use factory function since parseSlackMessage is async (user lookup)
    this.chat.processMessage(
      this,
      threadId,
      () => this.parseSlackMessage(event, threadId),
      options,
    );
  }

  /**
   * Handle reaction events from Slack (reaction_added, reaction_removed).
   */
  private handleReactionEvent(
    event: SlackReactionEvent,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) {
      this.logger?.warn("Chat instance not initialized, ignoring reaction");
      return;
    }

    // Only handle reactions to messages (not files, etc.)
    if (event.item.type !== "message") {
      this.logger?.debug("Ignoring reaction to non-message item", {
        itemType: event.item.type,
      });
      return;
    }

    // Build thread ID from the reacted message
    const threadId = this.encodeThreadId({
      channel: event.item.channel,
      threadTs: event.item.ts,
    });

    // Message ID is just the timestamp (Slack uses ts as message ID)
    const messageId = event.item.ts;

    // Normalize emoji
    const rawEmoji = event.reaction;
    const normalizedEmoji = defaultEmojiResolver.fromSlack(rawEmoji);

    // Check if reaction is from this bot
    const isMe =
      (this._botUserId !== null && event.user === this._botUserId) ||
      (this._botId !== null && event.user === this._botId);

    // Build reaction event
    const reactionEvent: Omit<ReactionEvent, "adapter"> = {
      emoji: normalizedEmoji,
      rawEmoji,
      added: event.type === "reaction_added",
      user: {
        userId: event.user,
        userName: event.user, // Will be resolved below if possible
        fullName: event.user,
        isBot: false, // Users add reactions, not bots typically
        isMe,
      },
      messageId,
      threadId,
      raw: event,
    };

    // Process reaction
    this.chat.processReaction({ ...reactionEvent, adapter: this }, options);
  }

  private async parseSlackMessage(
    event: SlackEvent,
    threadId: string,
  ): Promise<Message<unknown>> {
    const isMe = this.isMessageFromSelf(event);

    const text = event.text || "";

    // Get user info - for human users we need to look up the display name
    // since Slack events only include the user ID, not the username
    let userName = event.username || "unknown";
    let fullName = event.username || "unknown";

    // If we have a user ID but no username, look up the user info
    if (event.user && !event.username) {
      const userInfo = await this.lookupUser(event.user);
      userName = userInfo.displayName;
      fullName = userInfo.realName;
    }

    return {
      id: event.ts || "",
      threadId,
      text: this.formatConverter.extractPlainText(text),
      formatted: this.formatConverter.toAst(text),
      raw: event,
      author: {
        userId: event.user || event.bot_id || "unknown",
        userName,
        fullName,
        isBot: !!event.bot_id,
        isMe,
      },
      metadata: {
        dateSent: new Date(parseFloat(event.ts || "0") * 1000),
        edited: !!event.edited,
        editedAt: event.edited
          ? new Date(parseFloat(event.edited.ts) * 1000)
          : undefined,
      },
      attachments: (event.files || []).map((file) => ({
        type: file.mimetype?.startsWith("image/")
          ? ("image" as const)
          : ("file" as const),
        url: file.url_private,
        name: file.name,
        mimeType: file.mimetype,
      })),
    };
  }

  async postMessage(
    threadId: string,
    message: PostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { channel, threadTs } = this.decodeThreadId(threadId);

    try {
      const result = await this.client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: this.formatConverter.renderPostable(message),
        unfurl_links: false,
        unfurl_media: false,
      });

      return {
        id: result.ts as string,
        threadId,
        raw: result,
      };
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: PostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { channel } = this.decodeThreadId(threadId);

    try {
      const result = await this.client.chat.update({
        channel,
        ts: messageId,
        text: this.formatConverter.renderPostable(message),
      });

      return {
        id: result.ts as string,
        threadId,
        raw: result,
      };
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { channel } = this.decodeThreadId(threadId);

    try {
      await this.client.chat.delete({
        channel,
        ts: messageId,
      });
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async addReaction(
    threadId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    const { channel } = this.decodeThreadId(threadId);
    const name = emoji.replace(/:/g, "");

    try {
      await this.client.reactions.add({
        channel,
        timestamp: messageId,
        name,
      });
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    const { channel } = this.decodeThreadId(threadId);
    const name = emoji.replace(/:/g, "");

    try {
      await this.client.reactions.remove({
        channel,
        timestamp: messageId,
        name,
      });
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async startTyping(_threadId: string): Promise<void> {
    // Slack doesn't have a direct typing indicator API for bots
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {},
  ): Promise<Message<unknown>[]> {
    const { channel, threadTs } = this.decodeThreadId(threadId);

    try {
      const result = await this.client.conversations.replies({
        channel,
        ts: threadTs,
        limit: options.limit || 100,
        cursor: options.before,
      });

      const messages = (result.messages || []) as SlackEvent[];
      // Use sync version to avoid N API calls for user lookup
      return messages.map((msg) => this.parseSlackMessageSync(msg, threadId));
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { channel, threadTs } = this.decodeThreadId(threadId);

    try {
      const result = await this.client.conversations.info({ channel });
      const channelInfo = result.channel as { name?: string } | undefined;

      return {
        id: threadId,
        channelId: channel,
        channelName: channelInfo?.name,
        metadata: {
          threadTs,
          channel: result.channel,
        },
      };
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  encodeThreadId(platformData: SlackThreadId): string {
    return `slack:${platformData.channel}:${platformData.threadTs}`;
  }

  decodeThreadId(threadId: string): SlackThreadId {
    const parts = threadId.split(":");
    if (parts.length !== 3 || parts[0] !== "slack") {
      throw new Error(`Invalid Slack thread ID: ${threadId}`);
    }
    return {
      channel: parts[1] as string,
      threadTs: parts[2] as string,
    };
  }

  parseMessage(raw: SlackEvent): Message<unknown> {
    const event = raw;
    const threadTs = event.thread_ts || event.ts || "";
    const threadId = this.encodeThreadId({
      channel: event.channel || "",
      threadTs,
    });
    // Use synchronous version without user lookup for interface compliance
    return this.parseSlackMessageSync(event, threadId);
  }

  /**
   * Synchronous message parsing without user lookup.
   * Used for parseMessage interface - falls back to user ID for username.
   */
  private parseSlackMessageSync(
    event: SlackEvent,
    threadId: string,
  ): Message<unknown> {
    const isMe = this.isMessageFromSelf(event);

    const text = event.text || "";
    // Without async lookup, fall back to user ID for human users
    const userName = event.username || event.user || "unknown";
    const fullName = event.username || event.user || "unknown";

    return {
      id: event.ts || "",
      threadId,
      text: this.formatConverter.extractPlainText(text),
      formatted: this.formatConverter.toAst(text),
      raw: event,
      author: {
        userId: event.user || event.bot_id || "unknown",
        userName,
        fullName,
        isBot: !!event.bot_id,
        isMe,
      },
      metadata: {
        dateSent: new Date(parseFloat(event.ts || "0") * 1000),
        edited: !!event.edited,
        editedAt: event.edited
          ? new Date(parseFloat(event.edited.ts) * 1000)
          : undefined,
      },
      attachments: (event.files || []).map((file) => ({
        type: file.mimetype?.startsWith("image/")
          ? ("image" as const)
          : ("file" as const),
        url: file.url_private,
        name: file.name,
        mimeType: file.mimetype,
      })),
    };
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Check if a Slack event is from this bot.
   *
   * Slack messages can come from:
   * - User messages: have `user` field (U_xxx format)
   * - Bot messages: have `bot_id` field (B_xxx format)
   *
   * We check both because:
   * - _botUserId is the user ID (U_xxx) - matches event.user
   * - _botId is the bot ID (B_xxx) - matches event.bot_id
   */
  private isMessageFromSelf(event: SlackEvent): boolean {
    // Primary check: user ID match (for messages sent as the bot user)
    if (this._botUserId && event.user === this._botUserId) {
      return true;
    }

    // Secondary check: bot ID match (for bot_message subtypes)
    if (this._botId && event.bot_id === this._botId) {
      return true;
    }

    return false;
  }

  private handleSlackError(error: unknown): never {
    const slackError = error as { data?: { error?: string }; code?: string };

    if (slackError.code === "slack_webapi_platform_error") {
      if (slackError.data?.error === "ratelimited") {
        throw new RateLimitError("Slack rate limit exceeded", undefined, error);
      }
    }

    throw error;
  }
}

export function createSlackAdapter(config: SlackAdapterConfig): SlackAdapter {
  return new SlackAdapter(config);
}

// Re-export format converter for advanced use
export {
  SlackFormatConverter,
  SlackFormatConverter as SlackMarkdownConverter,
} from "./markdown";
