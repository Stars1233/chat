import type { Activity, ConversationReference } from "botbuilder";
import {
  ActivityTypes,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type TurnContext,
} from "botbuilder";

/** Extended CloudAdapter that exposes processActivity for serverless environments */
class ServerlessCloudAdapter extends CloudAdapter {
  handleActivity(
    authHeader: string,
    activity: Activity,
    logic: (context: TurnContext) => Promise<void>,
  ) {
    return this.processActivity(authHeader, activity, logic);
  }
}

import type {
  Adapter,
  ChatInstance,
  EmojiValue,
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
import {
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  NotImplementedError,
} from "chat-sdk";
import { TeamsFormatConverter } from "./markdown";

export interface TeamsAdapterConfig {
  /** Microsoft App ID */
  appId: string;
  /** Microsoft App Password */
  appPassword: string;
  /** Microsoft App Type */
  appType?: "MultiTenant" | "SingleTenant";
  /** Microsoft App Tenant ID */
  appTenantId?: string;
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

  private botAdapter: ServerlessCloudAdapter;
  private chat: ChatInstance | null = null;
  private logger: Logger | null = null;
  private formatConverter = new TeamsFormatConverter();
  private config: TeamsAdapterConfig;

  constructor(config: TeamsAdapterConfig) {
    this.config = config;
    this.userName = config.userName || "bot";

    if (config.appType === "SingleTenant" && !config.appTenantId) {
      throw new Error("appTenantId is required for SingleTenant app type");
    }

    // Pass empty config object, credentials go via factory
    const auth = new ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId: config.appId,
      MicrosoftAppPassword: config.appPassword,
      MicrosoftAppType: config.appType || "MultiTenant",
      MicrosoftAppTenantId:
        config.appType === "SingleTenant" ? config.appTenantId : undefined,
    });

    this.botAdapter = new ServerlessCloudAdapter(auth);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    const body = await request.text();
    this.logger?.debug("Teams webhook raw body", { body });

    let activity: Activity;
    try {
      activity = JSON.parse(body);
    } catch (e) {
      this.logger?.error("Failed to parse request body", { error: e });
      return new Response("Invalid JSON", { status: 400 });
    }

    // Get the auth header for token validation
    const authHeader = request.headers.get("authorization") || "";

    try {
      // Use handleActivity which takes the activity directly
      // instead of mocking Node.js req/res objects
      await this.botAdapter.handleActivity(
        authHeader,
        activity,
        async (context) => {
          await this.handleTurn(context, options);
        },
      );

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      this.logger?.error("Bot adapter process error", { error });
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async handleTurn(
    context: TurnContext,
    options?: WebhookOptions,
  ): Promise<void> {
    if (!this.chat) {
      this.logger?.warn("Chat instance not initialized, ignoring event");
      return;
    }

    const activity = context.activity;

    // Handle message reactions
    if (activity.type === ActivityTypes.MessageReaction) {
      this.handleReactionActivity(activity, options);
      return;
    }

    // Only handle message activities
    if (activity.type !== ActivityTypes.Message) {
      this.logger?.debug("Ignoring non-message activity", {
        type: activity.type,
      });
      return;
    }

    const threadId = this.encodeThreadId({
      conversationId: activity.conversation?.id || "",
      serviceUrl: activity.serviceUrl || "",
      replyToId: activity.replyToId,
    });

    // Let Chat class handle async processing and waitUntil
    this.chat.processMessage(
      this,
      threadId,
      this.parseTeamsMessage(activity, threadId),
      options,
    );
  }

  /**
   * Handle Teams reaction events (reactionsAdded/reactionsRemoved).
   */
  private handleReactionActivity(
    activity: Activity,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) return;

    // Extract the message ID from conversation ID
    // Format: "19:xxx@thread.tacv2;messageid=1767297849909"
    const conversationId = activity.conversation?.id || "";
    const messageIdMatch = conversationId.match(/messageid=(\d+)/);
    const messageId = messageIdMatch?.[1] || activity.replyToId || "";

    // Build thread ID (strip the messageid part for the thread)
    const baseConversationId = conversationId.split(";")[0] || conversationId;
    const threadId = this.encodeThreadId({
      conversationId: baseConversationId,
      serviceUrl: activity.serviceUrl || "",
    });

    const user = {
      userId: activity.from?.id || "unknown",
      userName: activity.from?.name || "unknown",
      fullName: activity.from?.name,
      isBot: false,
      isMe: this.isMessageFromSelf(activity),
    };

    // Process added reactions
    const reactionsAdded = activity.reactionsAdded || [];
    for (const reaction of reactionsAdded) {
      const rawEmoji = reaction.type || "";
      const emojiValue = defaultEmojiResolver.fromTeams(rawEmoji);

      const event: Omit<ReactionEvent, "adapter"> = {
        emoji: emojiValue,
        rawEmoji,
        added: true,
        user,
        messageId,
        threadId,
        raw: activity,
      };

      this.logger?.debug("Processing Teams reaction added", {
        emoji: emojiValue.name,
        rawEmoji,
        messageId,
      });

      this.chat.processReaction({ ...event, adapter: this }, options);
    }

    // Process removed reactions
    const reactionsRemoved = activity.reactionsRemoved || [];
    for (const reaction of reactionsRemoved) {
      const rawEmoji = reaction.type || "";
      const emojiValue = defaultEmojiResolver.fromTeams(rawEmoji);

      const event: Omit<ReactionEvent, "adapter"> = {
        emoji: emojiValue,
        rawEmoji,
        added: false,
        user,
        messageId,
        threadId,
        raw: activity,
      };

      this.logger?.debug("Processing Teams reaction removed", {
        emoji: emojiValue.name,
        rawEmoji,
        messageId,
      });

      this.chat.processReaction({ ...event, adapter: this }, options);
    }
  }

  private parseTeamsMessage(
    activity: Activity,
    threadId: string,
  ): Message<unknown> {
    const text = activity.text || "";
    // Normalize mentions - format converter will convert <at>name</at> to @name
    const normalizedText = this.normalizeMentions(text, activity);

    const isMe = this.isMessageFromSelf(activity);

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
        isMe,
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

  private normalizeMentions(text: string, _activity: Activity): string {
    // Don't strip mentions - the format converter will convert <at>name</at> to @name
    // Just trim any leading/trailing whitespace that might result from mention placement
    return text.trim();
  }

  async postMessage(
    threadId: string,
    message: PostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    // Convert emoji placeholders to Teams format (unicode)
    const text = convertEmojiPlaceholders(
      this.formatConverter.renderPostable(message),
      "teams",
    );

    const activity: Partial<Activity> = {
      type: ActivityTypes.Message,
      text,
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

    // Convert emoji placeholders to Teams format (unicode)
    const text = convertEmojiPlaceholders(
      this.formatConverter.renderPostable(message),
      "teams",
    );

    const activity: Partial<Activity> = {
      id: messageId,
      type: ActivityTypes.Message,
      text,
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
    _emoji: EmojiValue | string,
  ): Promise<void> {
    throw new NotImplementedError(
      "Teams Bot Framework does not expose reaction APIs",
      "addReaction",
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    throw new NotImplementedError(
      "Teams Bot Framework does not expose reaction APIs",
      "removeReaction",
    );
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
    throw new NotImplementedError(
      "Teams does not provide a bot API to fetch message history. Use Microsoft Graph API instead.",
      "fetchMessages",
    );
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

  /**
   * Check if a Teams activity is from this bot.
   *
   * Teams bot IDs can appear in different formats:
   * - Just the app ID: "abc123-def456-..."
   * - With prefix: "28:abc123-def456-..."
   *
   * We check both exact match and suffix match (after colon delimiter)
   * to handle all formats safely.
   */
  private isMessageFromSelf(activity: Activity): boolean {
    const fromId = activity.from?.id;
    if (!fromId || !this.config.appId) {
      return false;
    }

    // Exact match (bot ID is just the app ID)
    if (fromId === this.config.appId) {
      return true;
    }

    // Teams format: "28:{appId}" or similar prefix patterns
    // Check if it ends with our appId after a colon delimiter
    if (fromId.endsWith(`:${this.config.appId}`)) {
      return true;
    }

    return false;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }
}

export function createTeamsAdapter(config: TeamsAdapterConfig): TeamsAdapter {
  return new TeamsAdapter(config);
}

export { TeamsFormatConverter } from "./markdown";
