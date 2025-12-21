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
import { type chat_v1, google } from "googleapis";
import { GoogleChatFormatConverter } from "./markdown";

export interface GoogleChatAdapterConfig {
  /** Service account credentials JSON */
  credentials: {
    client_email: string;
    private_key: string;
    project_id?: string;
  };
  /** Override bot username (optional) */
  userName?: string;
}

/** Google Chat-specific thread ID data */
export interface GoogleChatThreadId {
  spaceName: string;
  threadName?: string;
}

/** Google Chat event payload (raw message format) */
export interface GoogleChatEvent {
  type: string;
  eventTime: string;
  space: {
    name: string;
    type: string;
    displayName?: string;
  };
  message?: {
    name: string;
    sender: {
      name: string;
      displayName: string;
      type: string;
    };
    text: string;
    thread?: {
      name: string;
    };
    createTime: string;
    annotations?: Array<{
      type: string;
      userMention?: {
        user: { name: string; displayName: string };
        type: string;
      };
    }>;
    attachment?: Array<{
      name: string;
      contentName: string;
      contentType: string;
      downloadUri?: string;
    }>;
  };
  user?: {
    name: string;
    displayName: string;
    type: string;
  };
}

export class GoogleChatAdapter implements Adapter<GoogleChatThreadId, unknown> {
  readonly name = "gchat";
  readonly userName: string;

  private chatApi: chat_v1.Chat;
  private chat: ChatInstance | null = null;
  private logger: Logger | null = null;
  private formatConverter = new GoogleChatFormatConverter();

  constructor(config: GoogleChatAdapterConfig) {
    this.userName = config.userName || "bot";

    // Create JWT auth client
    const auth = new google.auth.JWT({
      email: config.credentials.client_email,
      key: config.credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/chat.bot"],
    });

    this.chatApi = google.chat({ version: "v1", auth });
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger();
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    // Google Chat sends events as JSON POST requests
    // Verification is done via the service account / bearer token
    const body = await request.text();
    let event: GoogleChatEvent;

    try {
      event = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Handle different event types
    switch (event.type) {
      case "MESSAGE":
        this.handleMessageEvent(event, options);
        break;
      case "ADDED_TO_SPACE":
        // Bot was added to a space
        this.logger?.info("Added to space", { space: event.space?.name });
        break;
      case "REMOVED_FROM_SPACE":
        // Bot was removed from a space
        this.logger?.info("Removed from space", { space: event.space?.name });
        break;
    }

    // Google Chat expects an empty response or a message response
    return new Response(JSON.stringify({}), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private handleMessageEvent(
    event: GoogleChatEvent,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) {
      this.logger?.warn("Chat instance not initialized");
      return;
    }

    const message = event.message;
    if (!message) return;

    // Skip bot's own messages
    if (message.sender?.type === "BOT") {
      return;
    }

    const threadName = message.thread?.name || message.name;
    const threadId = this.encodeThreadId({
      spaceName: event.space.name,
      threadName,
    });

    const parsedMessage = this.parseGoogleChatMessage(event, threadId);

    // Run message handling in background
    const handleTask = this.chat
      .handleIncomingMessage(this, threadId, parsedMessage)
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

  private parseGoogleChatMessage(
    event: GoogleChatEvent,
    threadId: string,
  ): Message<unknown> {
    const message = event.message;
    if (!message) {
      throw new Error("Event has no message");
    }
    const text = message.text || "";

    // Check for @mentions to detect if this is a mention of our bot
    const _isMentionedBot = message.annotations?.some(
      (ann) => ann.type === "USER_MENTION" && ann.userMention?.type === "BOT",
    );

    return {
      id: message.name,
      threadId,
      text: this.formatConverter.extractPlainText(text),
      formatted: this.formatConverter.toAst(text),
      raw: event,
      author: {
        userId: message.sender?.name || "unknown",
        userName: message.sender?.displayName || "unknown",
        fullName: message.sender?.displayName || "unknown",
        isBot: message.sender?.type === "BOT",
        isMe: false,
      },
      metadata: {
        dateSent: new Date(message.createTime),
        edited: false,
      },
      attachments: (message.attachment || []).map((att) => ({
        type: att.contentType?.startsWith("image/")
          ? ("image" as const)
          : ("file" as const),
        url: att.downloadUri,
        name: att.contentName,
        mimeType: att.contentType,
      })),
    };
  }

  async postMessage(
    threadId: string,
    message: PostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { spaceName, threadName } = this.decodeThreadId(threadId);

    try {
      const response = await this.chatApi.spaces.messages.create({
        parent: spaceName,
        requestBody: {
          text: this.formatConverter.renderPostable(message),
          thread: threadName ? { name: threadName } : undefined,
        },
      });

      return {
        id: response.data.name || "",
        threadId,
        raw: response.data,
      };
    } catch (error) {
      this.handleGoogleChatError(error);
    }
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: PostableMessage,
  ): Promise<RawMessage<unknown>> {
    try {
      const response = await this.chatApi.spaces.messages.update({
        name: messageId,
        updateMask: "text",
        requestBody: {
          text: this.formatConverter.renderPostable(message),
        },
      });

      return {
        id: response.data.name || "",
        threadId,
        raw: response.data,
      };
    } catch (error) {
      this.handleGoogleChatError(error);
    }
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    try {
      await this.chatApi.spaces.messages.delete({
        name: messageId,
      });
    } catch (error) {
      this.handleGoogleChatError(error);
    }
  }

  async addReaction(
    _threadId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    try {
      await this.chatApi.spaces.messages.reactions.create({
        parent: messageId,
        requestBody: {
          emoji: { unicode: emoji },
        },
      });
    } catch (error) {
      this.handleGoogleChatError(error);
    }
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: string,
  ): Promise<void> {
    // Google Chat requires the reaction name to delete it
    // This is a simplified implementation
    this.logger?.warn("removeReaction requires reaction name, not implemented");
  }

  async startTyping(_threadId: string): Promise<void> {
    // Google Chat doesn't have a typing indicator API for bots
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {},
  ): Promise<Message<unknown>[]> {
    const { spaceName } = this.decodeThreadId(threadId);

    try {
      const response = await this.chatApi.spaces.messages.list({
        parent: spaceName,
        pageSize: options.limit || 100,
        pageToken: options.before,
      });

      const messages = response.data.messages || [];
      return messages.map((msg) => {
        const msgThreadId = this.encodeThreadId({
          spaceName,
          threadName: msg.thread?.name ?? undefined,
        });
        return {
          id: msg.name || "",
          threadId: msgThreadId,
          text: this.formatConverter.extractPlainText(msg.text || ""),
          formatted: this.formatConverter.toAst(msg.text || ""),
          raw: msg,
          author: {
            userId: msg.sender?.name || "unknown",
            userName: msg.sender?.displayName || "unknown",
            fullName: msg.sender?.displayName || "unknown",
            isBot: msg.sender?.type === "BOT",
            isMe: false,
          },
          metadata: {
            dateSent: msg.createTime ? new Date(msg.createTime) : new Date(),
            edited: false,
          },
          attachments: [],
        };
      });
    } catch (error) {
      this.handleGoogleChatError(error);
    }
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { spaceName } = this.decodeThreadId(threadId);

    try {
      const response = await this.chatApi.spaces.get({ name: spaceName });

      return {
        id: threadId,
        channelId: spaceName,
        channelName: response.data.displayName ?? undefined,
        metadata: {
          space: response.data,
        },
      };
    } catch (error) {
      this.handleGoogleChatError(error);
    }
  }

  encodeThreadId(platformData: GoogleChatThreadId): string {
    const threadPart = platformData.threadName
      ? `:${Buffer.from(platformData.threadName).toString("base64url")}`
      : "";
    return `gchat:${platformData.spaceName}${threadPart}`;
  }

  decodeThreadId(threadId: string): GoogleChatThreadId {
    const parts = threadId.split(":");
    if (parts.length < 2 || parts[0] !== "gchat") {
      throw new Error(`Invalid Google Chat thread ID: ${threadId}`);
    }

    const spaceName = parts[1] as string;
    const threadName = parts[2]
      ? Buffer.from(parts[2], "base64url").toString("utf-8")
      : undefined;

    return { spaceName, threadName };
  }

  parseMessage(raw: unknown): Message<unknown> {
    const event = raw as GoogleChatEvent;
    const threadName = event.message?.thread?.name || event.message?.name || "";
    const threadId = this.encodeThreadId({
      spaceName: event.space.name,
      threadName,
    });
    return this.parseGoogleChatMessage(event, threadId);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  private handleGoogleChatError(error: unknown): never {
    const gError = error as { code?: number; message?: string };

    if (gError.code === 429) {
      throw new RateLimitError(
        "Google Chat rate limit exceeded",
        undefined,
        error,
      );
    }

    throw error;
  }
}

export function createGoogleChatAdapter(
  config: GoogleChatAdapterConfig,
): GoogleChatAdapter {
  return new GoogleChatAdapter(config);
}

export {
  GoogleChatFormatConverter,
  GoogleChatFormatConverter as GoogleChatMarkdownConverter,
} from "./markdown";
