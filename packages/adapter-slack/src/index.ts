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
  ThreadInfo,
  WebhookOptions,
} from "chat-sdk";
import { RateLimitError } from "chat-sdk";
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

interface SlackEventPayload {
  type: string;
  challenge?: string;
  event?: SlackEvent;
  event_id?: string;
  event_time?: number;
}

export class SlackAdapter implements Adapter<SlackThreadId, unknown> {
  readonly name = "slack";
  readonly userName: string;

  private client: WebClient;
  private signingSecret: string;
  private chat: ChatInstance | null = null;
  private logger: Logger | null = null;
  private _botUserId: string | null = null;
  private formatConverter = new SlackFormatConverter();

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
    this.logger = chat.getLogger();

    // Fetch bot user ID if not provided
    if (!this._botUserId) {
      try {
        const authResult = await this.client.auth.test();
        this._botUserId = authResult.user_id as string;
        if (authResult.user) {
          (this as { userName: string }).userName = authResult.user as string;
        }
        this.logger.debug("Slack auth completed", {
          botUserId: this._botUserId,
        });
      } catch (error) {
        this.logger.warn("Could not fetch bot user ID", { error });
      }
    }
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    const body = await request.text();

    // Verify request signature
    const timestamp = request.headers.get("x-slack-request-timestamp");
    const signature = request.headers.get("x-slack-signature");

    if (!this.verifySignature(body, timestamp, signature)) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Parse the payload
    let payload: SlackEventPayload;
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
        this.handleMessageEvent(event, options);
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

  private handleMessageEvent(
    event: SlackEvent,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) {
      return;
    }

    // Skip bot messages
    if (event.bot_id) {
      return;
    }

    // Skip message subtypes we don't handle
    if (event.subtype === "message_changed") {
      return;
    }

    if (!event.channel || !event.ts) {
      return;
    }

    const threadTs = event.thread_ts || event.ts;
    const threadId = this.encodeThreadId({
      channel: event.channel,
      threadTs,
    });

    const message = this.parseSlackMessage(event, threadId);

    // Run message handling in background
    const handleTask = this.chat
      .handleIncomingMessage(this, threadId, message)
      .catch((err) => {
        this.logger?.error("Message handling error", { error: err });
      });

    if (options?.waitUntil) {
      options.waitUntil(handleTask);
    } else {
      handleTask.catch((err) => {
        this.logger?.error("Message handling error", { error: err });
      });
    }
  }

  private parseSlackMessage(
    event: SlackEvent,
    threadId: string,
  ): Message<unknown> {
    const isMe = this._botUserId ? event.user === this._botUserId : false;

    const text = event.text || "";

    return {
      id: event.ts || "",
      threadId,
      text: this.formatConverter.extractPlainText(text),
      formatted: this.formatConverter.toAst(text),
      raw: event,
      author: {
        userId: event.user || event.bot_id || "unknown",
        userName: event.username || "unknown",
        fullName: event.username || "unknown",
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
      return messages.map((msg) => this.parseSlackMessage(msg, threadId));
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
    return this.parseSlackMessage(event, threadId);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
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
