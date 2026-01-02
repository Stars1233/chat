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
  ActionEvent,
  Adapter,
  Attachment,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FileUpload,
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
  isCardElement,
  NotImplementedError,
} from "chat-sdk";
import { cardToAdaptiveCard, cardToFallbackText } from "./cards";
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

    // Handle adaptive card actions (button clicks)
    if (activity.type === ActivityTypes.Invoke) {
      await this.handleInvokeActivity(context, options);
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
   * Handle invoke activities (adaptive card actions, etc.).
   */
  private async handleInvokeActivity(
    context: TurnContext,
    options?: WebhookOptions,
  ): Promise<void> {
    const activity = context.activity;

    // Handle adaptive card action invokes
    if (activity.name === "adaptiveCard/action") {
      await this.handleAdaptiveCardAction(context, activity, options);
      return;
    }

    this.logger?.debug("Ignoring unsupported invoke", {
      name: activity.name,
    });
  }

  /**
   * Handle adaptive card button clicks.
   * The action data is in activity.value with our { actionId, value } structure.
   */
  private async handleAdaptiveCardAction(
    context: TurnContext,
    activity: Activity,
    options?: WebhookOptions,
  ): Promise<void> {
    if (!this.chat) return;

    // Activity.value contains our action data
    const actionData = activity.value?.action?.data as
      | { actionId?: string; value?: string }
      | undefined;

    if (!actionData?.actionId) {
      this.logger?.debug("Adaptive card action missing actionId", {
        value: activity.value,
      });
      // Send acknowledgment response
      await context.sendActivity({
        type: ActivityTypes.InvokeResponse,
        value: { status: 200 },
      });
      return;
    }

    const threadId = this.encodeThreadId({
      conversationId: activity.conversation?.id || "",
      serviceUrl: activity.serviceUrl || "",
    });

    const actionEvent: Omit<ActionEvent, "thread"> & { adapter: TeamsAdapter } = {
      actionId: actionData.actionId,
      value: actionData.value,
      user: {
        userId: activity.from?.id || "unknown",
        userName: activity.from?.name || "unknown",
        fullName: activity.from?.name || "unknown",
        isBot: false,
        isMe: false,
      },
      messageId: activity.replyToId || activity.id || "",
      threadId,
      adapter: this,
      raw: activity,
    };

    this.logger?.debug("Processing Teams adaptive card action", {
      actionId: actionData.actionId,
      value: actionData.value,
      messageId: actionEvent.messageId,
      threadId,
    });

    this.chat.processAction(actionEvent, options);

    // Send acknowledgment response to prevent timeout
    await context.sendActivity({
      type: ActivityTypes.InvokeResponse,
      value: { status: 200 },
    });
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

    // Build thread ID - KEEP the full conversation ID including ;messageid=XXX
    // This is required for Teams to reply in the correct thread
    const threadId = this.encodeThreadId({
      conversationId: conversationId,
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

      const event: Omit<ReactionEvent, "adapter" | "thread"> = {
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

      const event: Omit<ReactionEvent, "adapter" | "thread"> = {
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
      attachments: (activity.attachments || [])
        .filter((att) => att.contentType !== "application/vnd.microsoft.card.adaptive")
        .map((att) => this.createAttachment(att)),
    };
  }

  /**
   * Create an Attachment object from a Teams attachment.
   */
  private createAttachment(att: {
    contentType?: string;
    contentUrl?: string;
    name?: string;
  }): Attachment {
    const url = att.contentUrl;

    // Determine type based on contentType
    let type: Attachment["type"] = "file";
    if (att.contentType?.startsWith("image/")) {
      type = "image";
    } else if (att.contentType?.startsWith("video/")) {
      type = "video";
    } else if (att.contentType?.startsWith("audio/")) {
      type = "audio";
    }

    return {
      type,
      url,
      name: att.name,
      mimeType: att.contentType,
      fetchData: url
        ? async () => {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(
                `Failed to fetch file: ${response.status} ${response.statusText}`,
              );
            }
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
          }
        : undefined,
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

    // Check for files to upload
    const files = this.extractFiles(message);
    const fileAttachments = files.length > 0
      ? await this.filesToAttachments(files)
      : [];

    // Check if message contains a card
    const card = this.extractCard(message);
    let activity: Partial<Activity>;

    if (card) {
      // Render card as Adaptive Card
      const adaptiveCard = cardToAdaptiveCard(card);
      const fallbackText = cardToFallbackText(card);

      activity = {
        type: ActivityTypes.Message,
        text: fallbackText,
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: adaptiveCard,
          },
          ...fileAttachments,
        ],
      };

      this.logger?.debug("Teams API: sendActivity (adaptive card)", {
        conversationId,
        serviceUrl,
        fileCount: fileAttachments.length,
      });
    } else {
      // Regular text message
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "teams",
      );

      activity = {
        type: ActivityTypes.Message,
        text,
        textFormat: "markdown",
        attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
      };

      this.logger?.debug("Teams API: sendActivity (message)", {
        conversationId,
        serviceUrl,
        textLength: text.length,
        fileCount: fileAttachments.length,
      });
    }

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

    this.logger?.debug("Teams API: sendActivity response", { messageId });

    return {
      id: messageId,
      threadId,
      raw: activity,
    };
  }

  /**
   * Extract card element from a PostableMessage if present.
   */
  private extractCard(message: PostableMessage): import("chat-sdk").CardElement | null {
    if (isCardElement(message)) {
      return message;
    }
    if (typeof message === "object" && message !== null && "card" in message) {
      return message.card;
    }
    return null;
  }

  /**
   * Extract files from a PostableMessage if present.
   */
  private extractFiles(message: PostableMessage): FileUpload[] {
    if (typeof message === "object" && message !== null && "files" in message) {
      return (message as { files?: FileUpload[] }).files ?? [];
    }
    return [];
  }

  /**
   * Convert files to Teams attachments.
   * Uses inline data URIs for small files.
   */
  private async filesToAttachments(
    files: FileUpload[],
  ): Promise<Array<{ contentType: string; contentUrl: string; name: string }>> {
    const attachments: Array<{
      contentType: string;
      contentUrl: string;
      name: string;
    }> = [];

    for (const file of files) {
      // Convert data to Buffer
      let buffer: Buffer;
      if (Buffer.isBuffer(file.data)) {
        buffer = file.data;
      } else if (file.data instanceof ArrayBuffer) {
        buffer = Buffer.from(file.data);
      } else if (file.data instanceof Blob) {
        const arrayBuffer = await file.data.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      } else {
        continue;
      }

      // Create data URI
      const mimeType = file.mimeType || "application/octet-stream";
      const base64 = buffer.toString("base64");
      const dataUri = `data:${mimeType};base64,${base64}`;

      attachments.push({
        contentType: mimeType,
        contentUrl: dataUri,
        name: file.filename,
      });
    }

    return attachments;
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: PostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    // Check if message contains a card
    const card = this.extractCard(message);
    let activity: Partial<Activity>;

    if (card) {
      // Render card as Adaptive Card
      const adaptiveCard = cardToAdaptiveCard(card);
      const fallbackText = cardToFallbackText(card);

      activity = {
        id: messageId,
        type: ActivityTypes.Message,
        text: fallbackText,
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: adaptiveCard,
          },
        ],
      };

      this.logger?.debug("Teams API: updateActivity (adaptive card)", {
        conversationId,
        messageId,
      });
    } else {
      // Regular text message
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "teams",
      );

      activity = {
        id: messageId,
        type: ActivityTypes.Message,
        text,
        textFormat: "markdown",
      };

      this.logger?.debug("Teams API: updateActivity", {
        conversationId,
        messageId,
        textLength: text.length,
      });
    }

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

    this.logger?.debug("Teams API: updateActivity response", { ok: true });

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

    this.logger?.debug("Teams API: deleteActivity", {
      conversationId,
      messageId,
    });

    await this.botAdapter.continueConversationAsync(
      this.config.appId,
      conversationReference as Partial<ConversationReference>,
      async (context) => {
        await context.deleteActivity(messageId);
      },
    );

    this.logger?.debug("Teams API: deleteActivity response", { ok: true });
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

    this.logger?.debug("Teams API: sendActivity (typing)", { conversationId });

    await this.botAdapter.continueConversationAsync(
      this.config.appId,
      conversationReference as Partial<ConversationReference>,
      async (context) => {
        await context.sendActivity({ type: ActivityTypes.Typing });
      },
    );

    this.logger?.debug("Teams API: sendActivity (typing) response", {
      ok: true,
    });
  }

  /**
   * Open a direct message conversation with a user.
   * Returns a thread ID that can be used to post messages.
   *
   * Note: This requires a serviceUrl to be known. In Teams, you typically
   * get the serviceUrl from an incoming activity. If you need to proactively
   * message a user, you may need to store the serviceUrl from previous interactions.
   */
  async openDM(
    userId: string,
    serviceUrl = "https://smba.trafficmanager.net/teams/",
  ): Promise<string> {
    this.logger?.debug("Teams: creating 1:1 conversation", { userId });

    // Create a conversation reference for the 1:1 chat
    const conversationReference: Partial<ConversationReference> = {
      channelId: "msteams",
      serviceUrl,
      bot: {
        id: this.config.appId,
        name: this.userName,
      },
    };

    let conversationId = "";

    // Create the 1:1 conversation
    await this.botAdapter.continueConversationAsync(
      this.config.appId,
      conversationReference,
      async (context) => {
        // Create conversation parameters
        const members = [{ id: userId }];

        // biome-ignore lint/suspicious/noExplicitAny: BotBuilder types are incomplete
        const result = await (context.adapter as any).createConversationAsync(
          this.config.appId,
          "msteams",
          serviceUrl,
          "", // empty audience
          {
            isGroup: false,
            bot: { id: this.config.appId, name: this.userName },
            members,
            tenantId: this.config.appTenantId,
          },
          // The callback is optional in the newer SDK but types require it
          async () => {},
        );

        // Get conversation ID from the result
        conversationId = result?.activityId || result?.id || "";

        // If we got a context reference back, extract the conversation ID
        if (result?.conversation?.id) {
          conversationId = result.conversation.id;
        }
      },
    );

    if (!conversationId) {
      throw new Error("Failed to create 1:1 conversation - no ID returned");
    }

    this.logger?.debug("Teams: 1:1 conversation created", { conversationId });

    return this.encodeThreadId({
      conversationId,
      serviceUrl,
    });
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

  /**
   * Check if a thread is a direct message conversation.
   * Teams DMs have conversation IDs that don't start with "19:" (which is for groups/channels).
   */
  isDM(threadId: string): boolean {
    const { conversationId } = this.decodeThreadId(threadId);
    // Group chats and channels start with "19:", DMs don't
    return !conversationId.startsWith("19:");
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

// Re-export card converter for advanced use
export { cardToAdaptiveCard, cardToFallbackText } from "./cards";
