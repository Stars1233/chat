import type { Activity, ConversationReference, Entity } from "botbuilder";
import {
  ActivityTypes,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type TurnContext,
} from "botbuilder";

/** Minimal request interface for botbuilder process */
interface BotRequest {
  body: unknown;
  headers: Record<string, string>;
  method: string;
}

/** Minimal response interface for botbuilder process */
interface BotResponse {
  status: (code: number) => BotResponse;
  send: (data?: string) => void;
  end: () => void;
}

/** Entity with text property for @mentions */
interface MentionEntity extends Entity {
  text?: string;
}

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
import { TeamsFormatConverter } from "./markdown";

export interface TeamsAdapterConfig {
  /** Microsoft App ID */
  appId: string;
  /** Microsoft App Password */
  appPassword: string;
  /** Override bot username (optional) */
  userName?: string;
}

/** Teams-specific thread ID data */
export interface TeamsThreadId {
  conversationId: string;
  serviceUrl: string;
  replyToId?: string;
}

export class TeamsAdapter implements Adapter<TeamsThreadId, unknown> {
  readonly name = "teams";
  readonly userName: string;
  readonly botUserId?: string;

  private botAdapter: CloudAdapter;
  private chat: ChatInstance | null = null;
  private logger: Logger | null = null;
  private formatConverter = new TeamsFormatConverter();
  private config: TeamsAdapterConfig;

  constructor(config: TeamsAdapterConfig) {
    this.config = config;
    this.userName = config.userName || "bot";

    const auth = new ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId: config.appId,
      MicrosoftAppPassword: config.appPassword,
    });

    this.botAdapter = new CloudAdapter(auth);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    // Convert web Request to Node-style req/res for botbuilder
    const body = await request.text();
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return new Promise((resolve) => {
      // Create mock req/res objects for botbuilder
      const req: BotRequest = {
        body: JSON.parse(body),
        headers,
        method: request.method,
      };

      let responseBody = "";
      let responseStatus = 200;

      const res: BotResponse = {
        status: (code: number) => {
          responseStatus = code;
          return res;
        },
        send: (data?: string) => {
          responseBody = data || "";
          resolve(
            new Response(responseBody, {
              status: responseStatus,
              headers: { "Content-Type": "application/json" },
            }),
          );
        },
        end: () => {
          resolve(new Response(responseBody, { status: responseStatus }));
        },
      };

      // Cast to satisfy botbuilder's Node.js-style req/res types
      // Our mock objects implement the minimal interface needed
      // biome-ignore lint/suspicious/noExplicitAny: botbuilder expects Node.js types incompatible with our mock
      this.botAdapter.process(req as any, res as any, async (context) => {
        await this.handleTurn(context, options);
      });
    });
  }

  private async handleTurn(
    context: TurnContext,
    options?: WebhookOptions,
  ): Promise<void> {
    if (!this.chat) {
      this.logger?.warn("Chat instance not initialized");
      return;
    }

    const activity = context.activity;

    // Only handle message activities
    if (activity.type !== ActivityTypes.Message) {
      return;
    }

    // Skip bot's own messages
    if (activity.from?.id === activity.recipient?.id) {
      return;
    }

    const threadId = this.encodeThreadId({
      conversationId: activity.conversation?.id || "",
      serviceUrl: activity.serviceUrl || "",
      replyToId: activity.replyToId,
    });

    const message = this.parseTeamsMessage(activity, threadId);

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

  private parseTeamsMessage(
    activity: Activity,
    threadId: string,
  ): Message<unknown> {
    const text = activity.text || "";
    // Normalize mentions - format converter will convert <at>name</at> to @name
    const normalizedText = this.normalizeMentions(text, activity);

    return {
      id: activity.id || "",
      threadId,
      text: this.formatConverter.extractPlainText(normalizedText),
      formatted: this.formatConverter.toAst(normalizedText),
      raw: activity,
      author: {
        userId: activity.from?.id || "unknown",
        userName: activity.from?.name || "unknown",
        fullName: activity.from?.name || "unknown",
        isBot: activity.from?.role === "bot",
        isMe: false,
      },
      metadata: {
        dateSent: activity.timestamp
          ? new Date(activity.timestamp)
          : new Date(),
        edited: false,
      },
      attachments: (activity.attachments || []).map((att) => ({
        type: att.contentType?.startsWith("image/")
          ? ("image" as const)
          : ("file" as const),
        url: att.contentUrl,
        name: att.name,
        mimeType: att.contentType,
      })),
    };
  }

  private normalizeMentions(text: string, activity: Activity): string {
    // Don't strip mentions - the format converter will convert <at>name</at> to @name
    // Just trim any leading/trailing whitespace that might result from mention placement
    return text.trim();
  }

  async postMessage(
    threadId: string,
    message: PostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    const activity: Partial<Activity> = {
      type: ActivityTypes.Message,
      text: this.formatConverter.renderPostable(message),
      textFormat: "markdown",
    };

    // Use the adapter to send the message
    const conversationReference = {
      channelId: "msteams",
      serviceUrl,
      conversation: { id: conversationId },
    };

    let messageId = "";

    await this.botAdapter.continueConversationAsync(
      this.config.appId,
      conversationReference as Partial<ConversationReference>,
      async (context) => {
        const response = await context.sendActivity(activity);
        messageId = response?.id || "";
      },
    );

    return {
      id: messageId,
      threadId,
      raw: activity,
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: PostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    const activity: Partial<Activity> = {
      id: messageId,
      type: ActivityTypes.Message,
      text: this.formatConverter.renderPostable(message),
      textFormat: "markdown",
    };

    const conversationReference = {
      channelId: "msteams",
      serviceUrl,
      conversation: { id: conversationId },
    };

    await this.botAdapter.continueConversationAsync(
      this.config.appId,
      conversationReference as Partial<ConversationReference>,
      async (context) => {
        await context.updateActivity(activity);
      },
    );

    return {
      id: messageId,
      threadId,
      raw: activity,
    };
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    const conversationReference = {
      channelId: "msteams",
      serviceUrl,
      conversation: { id: conversationId },
    };

    await this.botAdapter.continueConversationAsync(
      this.config.appId,
      conversationReference as Partial<ConversationReference>,
      async (context) => {
        await context.deleteActivity(messageId);
      },
    );
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: string,
  ): Promise<void> {
    // Teams reactions require different API approach
    this.logger?.warn("Reactions not yet implemented");
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: string,
  ): Promise<void> {
    this.logger?.warn("Reactions not yet implemented");
  }

  async startTyping(threadId: string): Promise<void> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    const conversationReference = {
      channelId: "msteams",
      serviceUrl,
      conversation: { id: conversationId },
    };

    await this.botAdapter.continueConversationAsync(
      this.config.appId,
      conversationReference as Partial<ConversationReference>,
      async (context) => {
        await context.sendActivity({ type: ActivityTypes.Typing });
      },
    );
  }

  async fetchMessages(
    _threadId: string,
    _options: FetchOptions = {},
  ): Promise<Message<unknown>[]> {
    // Teams doesn't have a direct API to fetch message history
    // This would require Graph API integration
    this.logger?.warn("fetchMessages not yet implemented");
    return [];
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { conversationId } = this.decodeThreadId(threadId);

    return {
      id: threadId,
      channelId: conversationId,
      metadata: {},
    };
  }

  encodeThreadId(platformData: TeamsThreadId): string {
    // Base64 encode both since conversationId and serviceUrl can contain special characters
    const encodedConversationId = Buffer.from(
      platformData.conversationId,
    ).toString("base64url");
    const encodedServiceUrl = Buffer.from(platformData.serviceUrl).toString(
      "base64url",
    );
    return `teams:${encodedConversationId}:${encodedServiceUrl}`;
  }

  decodeThreadId(threadId: string): TeamsThreadId {
    const parts = threadId.split(":");
    if (parts.length !== 3 || parts[0] !== "teams") {
      throw new Error(`Invalid Teams thread ID: ${threadId}`);
    }
    const conversationId = Buffer.from(
      parts[1] as string,
      "base64url",
    ).toString("utf-8");
    const serviceUrl = Buffer.from(parts[2] as string, "base64url").toString(
      "utf-8",
    );
    return { conversationId, serviceUrl };
  }

  parseMessage(raw: unknown): Message<unknown> {
    const activity = raw as Activity;
    const threadId = this.encodeThreadId({
      conversationId: activity.conversation?.id || "",
      serviceUrl: activity.serviceUrl || "",
    });
    return this.parseTeamsMessage(activity, threadId);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }
}

export function createTeamsAdapter(config: TeamsAdapterConfig): TeamsAdapter {
  return new TeamsAdapter(config);
}

export {
  TeamsFormatConverter,
  TeamsFormatConverter as TeamsMarkdownConverter,
} from "./markdown";
