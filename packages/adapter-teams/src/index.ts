import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import {
  TokenCredentialAuthenticationProvider,
  type TokenCredentialAuthenticationProviderOptions,
} from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
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
  AdapterPostableMessage,
  Attachment,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FileUpload,
  FormattedContent,
  Logger,
  Message,
  RawMessage,
  ReactionEvent,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import {
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  isCardElement,
  NotImplementedError,
} from "chat";
import { cardToAdaptiveCard } from "./cards";
import { TeamsFormatConverter } from "./markdown";

/** Microsoft Graph API chat message type */
interface GraphChatMessage {
  id: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  replyToId?: string; // ID of parent message for channel threads
  body?: {
    content?: string;
    contentType?: "text" | "html";
  };
  from?: {
    user?: {
      id?: string;
      displayName?: string;
    };
    application?: {
      id?: string;
      displayName?: string;
    };
  };
  attachments?: Array<{
    id?: string;
    contentType?: string;
    contentUrl?: string;
    name?: string;
  }>;
}

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

/** Teams channel context extracted from activity.channelData */
interface TeamsChannelContext {
  teamId: string;
  channelId: string;
  tenantId: string;
}

export class TeamsAdapter implements Adapter<TeamsThreadId, unknown> {
  readonly name = "teams";
  readonly userName: string;
  readonly botUserId?: string;

  private botAdapter: ServerlessCloudAdapter;
  private graphClient: Client | null = null;
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

    // Initialize Microsoft Graph client for message history (requires tenant ID)
    if (config.appTenantId) {
      const credential = new ClientSecretCredential(
        config.appTenantId,
        config.appId,
        config.appPassword,
      );

      const authProvider = new TokenCredentialAuthenticationProvider(
        credential,
        {
          scopes: ["https://graph.microsoft.com/.default"],
        } as TokenCredentialAuthenticationProviderOptions,
      );

      this.graphClient = Client.initWithMiddleware({ authProvider });
    }
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

    // Cache serviceUrl and tenantId for the user - needed for opening DMs later
    if (activity.from?.id && activity.serviceUrl) {
      const userId = activity.from.id;
      const channelData = activity.channelData as {
        tenant?: { id?: string };
        team?: { id?: string };
        channel?: { id?: string };
      };
      const tenantId = channelData?.tenant?.id;
      const ttl = 30 * 24 * 60 * 60 * 1000; // 30 days

      // Store serviceUrl and tenantId for DM creation
      this.chat
        .getState()
        .set(`teams:serviceUrl:${userId}`, activity.serviceUrl, ttl);
      if (tenantId) {
        this.chat.getState().set(`teams:tenantId:${userId}`, tenantId, ttl);
      }

      // Cache team/channel context for proper message fetching in channel threads
      // This allows fetchMessages to use the channel-specific endpoint for thread filtering
      if (channelData?.team?.id && channelData?.channel?.id && tenantId) {
        const conversationId = activity.conversation?.id || "";
        // Extract the base channel ID (without ;messageid=) for mapping
        const baseChannelId = conversationId.replace(/;messageid=\d+/, "");
        const context: TeamsChannelContext = {
          teamId: channelData.team.id,
          channelId: channelData.channel.id,
          tenantId,
        };
        this.chat
          .getState()
          .set(
            `teams:channelContext:${baseChannelId}`,
            JSON.stringify(context),
            ttl,
          );
        this.logger?.debug("Cached Teams channel context", {
          conversationId: baseChannelId,
          teamId: context.teamId,
          channelId: context.channelId,
        });
      }
    }

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

    // Check if this message activity is actually a button click (Action.Submit)
    // Teams sends Action.Submit as a message with value.actionId
    const actionValue = activity.value as
      | { actionId?: string; value?: string }
      | undefined;
    if (actionValue?.actionId) {
      this.handleMessageAction(activity, actionValue, options);
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
   * Handle Action.Submit button clicks sent as message activities.
   * Teams sends these with type "message" and value.actionId.
   */
  private handleMessageAction(
    activity: Activity,
    actionValue: { actionId?: string; value?: string },
    options?: WebhookOptions,
  ): void {
    if (!this.chat || !actionValue.actionId) return;

    const threadId = this.encodeThreadId({
      conversationId: activity.conversation?.id || "",
      serviceUrl: activity.serviceUrl || "",
    });

    const actionEvent: Omit<ActionEvent, "thread"> & { adapter: TeamsAdapter } =
      {
        actionId: actionValue.actionId,
        value: actionValue.value,
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

    this.logger?.debug("Processing Teams message action (Action.Submit)", {
      actionId: actionValue.actionId,
      value: actionValue.value,
      messageId: actionEvent.messageId,
      threadId,
    });

    this.chat.processAction(actionEvent, options);
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

    const actionEvent: Omit<ActionEvent, "thread"> & { adapter: TeamsAdapter } =
      {
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
        .filter(
          (att) =>
            att.contentType !== "application/vnd.microsoft.card.adaptive",
        )
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
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    // Check for files to upload
    const files = this.extractFiles(message);
    const fileAttachments =
      files.length > 0 ? await this.filesToAttachments(files) : [];

    // Check if message contains a card
    const card = this.extractCard(message);
    let activity: Partial<Activity>;

    if (card) {
      // Render card as Adaptive Card
      const adaptiveCard = cardToAdaptiveCard(card);

      activity = {
        type: ActivityTypes.Message,
        // Don't include text - Teams shows both text and card if text is present
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
   * Extract card element from a AdapterPostableMessage if present.
   */
  private extractCard(
    message: AdapterPostableMessage,
  ): import("chat").CardElement | null {
    if (isCardElement(message)) {
      return message;
    }
    if (typeof message === "object" && message !== null && "card" in message) {
      return message.card;
    }
    return null;
  }

  /**
   * Extract files from a AdapterPostableMessage if present.
   */
  private extractFiles(message: AdapterPostableMessage): FileUpload[] {
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
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    // Check if message contains a card
    const card = this.extractCard(message);
    let activity: Partial<Activity>;

    if (card) {
      // Render card as Adaptive Card
      const adaptiveCard = cardToAdaptiveCard(card);

      activity = {
        id: messageId,
        type: ActivityTypes.Message,
        // Don't include text - Teams shows both text and card if text is present
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
   * The serviceUrl and tenantId are automatically resolved from cached user interactions.
   * If no cached values are found, defaults are used (which may not work for all tenants).
   */
  async openDM(userId: string): Promise<string> {
    // Look up cached serviceUrl and tenantId for this user from state
    const cachedServiceUrl = await this.chat
      ?.getState()
      .get<string>(`teams:serviceUrl:${userId}`);
    const cachedTenantId = await this.chat
      ?.getState()
      .get<string>(`teams:tenantId:${userId}`);

    const serviceUrl =
      cachedServiceUrl || "https://smba.trafficmanager.net/teams/";
    // Use cached tenant ID, config tenant ID, or undefined (will fail for multi-tenant)
    const tenantId = cachedTenantId || this.config.appTenantId;

    this.logger?.debug("Teams: creating 1:1 conversation", {
      userId,
      serviceUrl,
      tenantId,
      cachedServiceUrl: !!cachedServiceUrl,
      cachedTenantId: !!cachedTenantId,
    });

    if (!tenantId) {
      throw new Error(
        "Cannot open DM: tenant ID not found. User must interact with the bot first (via @mention) to cache their tenant ID.",
      );
    }

    let conversationId = "";

    // Create the 1:1 conversation using createConversationAsync
    // The conversation ID is captured from within the callback, not from the return value
    // biome-ignore lint/suspicious/noExplicitAny: BotBuilder types are incomplete
    await (this.botAdapter as any).createConversationAsync(
      this.config.appId,
      "msteams",
      serviceUrl,
      "", // empty audience
      {
        isGroup: false,
        bot: { id: this.config.appId, name: this.userName },
        members: [{ id: userId }],
        tenantId,
        channelData: {
          tenant: { id: tenantId },
        },
      },
      async (turnContext: TurnContext) => {
        // Capture the conversation ID from the new context
        conversationId = turnContext?.activity?.conversation?.id || "";
        this.logger?.debug("Teams: conversation created in callback", {
          conversationId,
          activityId: turnContext?.activity?.id,
        });
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
    threadId: string,
    options: FetchOptions = {},
  ): Promise<FetchResult<unknown>> {
    if (!this.graphClient) {
      throw new NotImplementedError(
        "Teams fetchMessages requires appTenantId to be configured for Microsoft Graph API access.",
        "fetchMessages",
      );
    }

    const { conversationId } = this.decodeThreadId(threadId);
    const limit = options.limit || 50;
    const cursor = options.cursor;
    const direction = options.direction ?? "backward";

    // Extract message ID for thread filtering (format: "19:xxx@thread.tacv2;messageid=123456")
    const messageIdMatch = conversationId.match(/;messageid=(\d+)/);
    const threadMessageId = messageIdMatch?.[1];

    // Strip ;messageid= from conversation ID
    const baseConversationId = conversationId.replace(/;messageid=\d+/, "");

    // Try to get cached channel context for proper thread-level message fetching
    let channelContext: TeamsChannelContext | null = null;
    if (threadMessageId && this.chat) {
      const cachedContext = await this.chat
        .getState()
        .get<string>(`teams:channelContext:${baseConversationId}`);
      if (cachedContext) {
        try {
          channelContext = JSON.parse(cachedContext) as TeamsChannelContext;
        } catch {
          // Invalid cached data, ignore
        }
      }
    }

    try {
      this.logger?.debug("Teams Graph API: fetching messages", {
        conversationId: baseConversationId,
        threadMessageId,
        hasChannelContext: !!channelContext,
        limit,
        cursor,
        direction,
      });

      // If we have channel context and a thread message ID, use the channel replies endpoint
      // This gives us proper thread-level filtering instead of all messages in the channel
      if (channelContext && threadMessageId) {
        return this.fetchChannelThreadMessages(
          channelContext,
          threadMessageId,
          threadId,
          options,
        );
      }

      // Teams conversation IDs:
      // - Channels: "19:xxx@thread.tacv2"
      // - Group chats: "19:xxx@thread.v2"
      // - 1:1 chats: other formats (e.g., "a]xxx", "8:orgid:xxx")
      // For Graph API, we use /chats/{chat-id}/messages for all chat types

      // Note: Teams Graph API only supports orderby("createdDateTime desc")
      // Ascending order is not supported, so we work around this limitation.
      // Also, max page size is 50 messages per request.

      let graphMessages: GraphChatMessage[];
      let hasMoreMessages = false;

      if (direction === "forward") {
        // Forward direction: need to fetch ALL messages to find the oldest ones
        // since API only supports descending order. Paginate with max 50 per request.
        const allMessages: GraphChatMessage[] = [];
        let nextLink: string | undefined;
        const apiUrl = `/chats/${encodeURIComponent(baseConversationId)}/messages`;

        do {
          const request = nextLink
            ? this.graphClient.api(nextLink)
            : this.graphClient
                .api(apiUrl)
                .top(50) // Max allowed by Teams API
                .orderby("createdDateTime desc");

          const response = await request.get();
          const pageMessages = (response.value || []) as GraphChatMessage[];
          allMessages.push(...pageMessages);
          nextLink = response["@odata.nextLink"];
        } while (nextLink);

        // Reverse to get chronological order (oldest first)
        allMessages.reverse();

        // Find starting position based on cursor (cursor is a timestamp)
        let startIndex = 0;
        if (cursor) {
          startIndex = allMessages.findIndex(
            (msg) => msg.createdDateTime && msg.createdDateTime > cursor,
          );
          if (startIndex === -1) startIndex = allMessages.length;
        }

        // Check if there are more messages beyond our slice
        hasMoreMessages = startIndex + limit < allMessages.length;
        // Take only the requested limit
        graphMessages = allMessages.slice(startIndex, startIndex + limit);
      } else {
        // Backward direction: simple pagination
        let request = this.graphClient
          .api(`/chats/${encodeURIComponent(baseConversationId)}/messages`)
          .top(limit)
          .orderby("createdDateTime desc");

        if (cursor) {
          // Get messages older than cursor
          request = request.filter(`createdDateTime lt ${cursor}`);
        }

        const response = await request.get();
        graphMessages = (response.value || []) as GraphChatMessage[];

        // API returns newest first, reverse to get chronological order
        graphMessages.reverse();

        // We have more if we got a full page
        hasMoreMessages = graphMessages.length >= limit;
      }

      this.logger?.debug("Teams Graph API: fetched messages", {
        count: graphMessages.length,
        direction,
        hasMoreMessages,
      });

      const messages = graphMessages.map((msg: GraphChatMessage) => {
        const isFromBot =
          msg.from?.application?.id === this.config.appId ||
          msg.from?.user?.id === this.config.appId;

        return {
          id: msg.id,
          threadId,
          text: this.extractTextFromGraphMessage(msg),
          formatted: this.formatConverter.toAst(
            this.extractTextFromGraphMessage(msg),
          ),
          raw: msg,
          author: {
            userId:
              msg.from?.user?.id || msg.from?.application?.id || "unknown",
            userName:
              msg.from?.user?.displayName ||
              msg.from?.application?.displayName ||
              "unknown",
            fullName:
              msg.from?.user?.displayName ||
              msg.from?.application?.displayName ||
              "unknown",
            isBot: !!msg.from?.application,
            isMe: isFromBot,
          },
          metadata: {
            dateSent: msg.createdDateTime
              ? new Date(msg.createdDateTime)
              : new Date(),
            edited: !!msg.lastModifiedDateTime,
          },
          attachments: this.extractAttachmentsFromGraphMessage(msg),
        };
      });

      // Determine nextCursor based on direction
      let nextCursor: string | undefined;
      if (hasMoreMessages && graphMessages.length > 0) {
        if (direction === "forward") {
          // Forward: use the newest message's timestamp (last in returned slice)
          const lastMsg = graphMessages[graphMessages.length - 1];
          if (lastMsg?.createdDateTime) {
            nextCursor = lastMsg.createdDateTime;
          }
        } else {
          // Backward: use the oldest message's timestamp (first in returned array)
          const oldestMsg = graphMessages[0];
          if (oldestMsg?.createdDateTime) {
            nextCursor = oldestMsg.createdDateTime;
          }
        }
      }

      return { messages, nextCursor };
    } catch (error) {
      this.logger?.error("Teams Graph API: fetchMessages error", { error });

      // Check if it's a permission error
      if (error instanceof Error && error.message?.includes("403")) {
        throw new NotImplementedError(
          "Teams fetchMessages requires one of these Azure AD app permissions: ChatMessage.Read.Chat, Chat.Read.All, or Chat.Read.WhereInstalled",
          "fetchMessages",
        );
      }

      throw error;
    }
  }

  /**
   * Fetch messages from a Teams channel thread using the channel-specific Graph API endpoint.
   * This provides proper thread-level filtering by fetching only replies to a specific message.
   *
   * Endpoint: GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies
   */
  private async fetchChannelThreadMessages(
    context: TeamsChannelContext,
    threadMessageId: string,
    threadId: string,
    options: FetchOptions,
  ): Promise<FetchResult<unknown>> {
    const limit = options.limit || 50;
    const cursor = options.cursor;
    const direction = options.direction ?? "backward";

    this.logger?.debug("Teams Graph API: fetching channel thread messages", {
      teamId: context.teamId,
      channelId: context.channelId,
      threadMessageId,
      limit,
      cursor,
      direction,
    });

    // Build the endpoint URL:
    // /teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies
    const apiUrl = `/teams/${encodeURIComponent(context.teamId)}/channels/${encodeURIComponent(context.channelId)}/messages/${encodeURIComponent(threadMessageId)}/replies`;

    let graphMessages: GraphChatMessage[];
    let hasMoreMessages = false;

    if (direction === "forward") {
      // Forward direction: fetch all replies and paginate in chronological order
      const allMessages: GraphChatMessage[] = [];
      let nextLink: string | undefined;
      const graphClient = this.graphClient;
      if (!graphClient) {
        throw new Error("Graph client not initialized");
      }

      do {
        const request = nextLink
          ? graphClient.api(nextLink)
          : graphClient.api(apiUrl).top(50);

        const response = await request.get();
        const pageMessages = (response.value || []) as GraphChatMessage[];
        allMessages.push(...pageMessages);
        nextLink = response["@odata.nextLink"];
      } while (nextLink);

      // Find starting position based on cursor
      let startIndex = 0;
      if (cursor) {
        startIndex = allMessages.findIndex(
          (msg) => msg.createdDateTime && msg.createdDateTime > cursor,
        );
        if (startIndex === -1) startIndex = allMessages.length;
      }

      hasMoreMessages = startIndex + limit < allMessages.length;
      graphMessages = allMessages.slice(startIndex, startIndex + limit);
    } else {
      // Backward direction: replies endpoint returns in chronological order (oldest first)
      // We need to get all and then return the most recent
      const allMessages: GraphChatMessage[] = [];
      let nextLink: string | undefined;
      const graphClient = this.graphClient;
      if (!graphClient) {
        throw new Error("Graph client not initialized");
      }

      do {
        const request = nextLink
          ? graphClient.api(nextLink)
          : graphClient.api(apiUrl).top(50);

        const response = await request.get();
        const pageMessages = (response.value || []) as GraphChatMessage[];
        allMessages.push(...pageMessages);
        nextLink = response["@odata.nextLink"];
      } while (nextLink);

      // For backward, we want most recent first, then reverse for chronological output
      if (cursor) {
        // Find position of cursor and take messages before it
        const cursorIndex = allMessages.findIndex(
          (msg) => msg.createdDateTime && msg.createdDateTime >= cursor,
        );
        if (cursorIndex > 0) {
          const sliceStart = Math.max(0, cursorIndex - limit);
          graphMessages = allMessages.slice(sliceStart, cursorIndex);
          hasMoreMessages = sliceStart > 0;
        } else {
          graphMessages = allMessages.slice(-limit);
          hasMoreMessages = allMessages.length > limit;
        }
      } else {
        // No cursor - get the most recent messages
        graphMessages = allMessages.slice(-limit);
        hasMoreMessages = allMessages.length > limit;
      }
    }

    this.logger?.debug("Teams Graph API: fetched channel thread messages", {
      count: graphMessages.length,
      direction,
      hasMoreMessages,
    });

    const messages = graphMessages.map((msg: GraphChatMessage) => {
      const isFromBot =
        msg.from?.application?.id === this.config.appId ||
        msg.from?.user?.id === this.config.appId;

      return {
        id: msg.id,
        threadId,
        text: this.extractTextFromGraphMessage(msg),
        formatted: this.formatConverter.toAst(
          this.extractTextFromGraphMessage(msg),
        ),
        raw: msg,
        author: {
          userId: msg.from?.user?.id || msg.from?.application?.id || "unknown",
          userName:
            msg.from?.user?.displayName ||
            msg.from?.application?.displayName ||
            "unknown",
          fullName:
            msg.from?.user?.displayName ||
            msg.from?.application?.displayName ||
            "unknown",
          isBot: !!msg.from?.application,
          isMe: isFromBot,
        },
        metadata: {
          dateSent: msg.createdDateTime
            ? new Date(msg.createdDateTime)
            : new Date(),
          edited: !!msg.lastModifiedDateTime,
        },
        attachments: this.extractAttachmentsFromGraphMessage(msg),
      };
    });

    // Determine nextCursor
    let nextCursor: string | undefined;
    if (hasMoreMessages && graphMessages.length > 0) {
      if (direction === "forward") {
        const lastMsg = graphMessages[graphMessages.length - 1];
        if (lastMsg?.createdDateTime) {
          nextCursor = lastMsg.createdDateTime;
        }
      } else {
        const oldestMsg = graphMessages[0];
        if (oldestMsg?.createdDateTime) {
          nextCursor = oldestMsg.createdDateTime;
        }
      }
    }

    return { messages, nextCursor };
  }

  /**
   * Extract plain text from a Graph API message.
   */
  private extractTextFromGraphMessage(msg: GraphChatMessage): string {
    // body.content contains the message text (HTML or text depending on contentType)
    if (msg.body?.contentType === "text") {
      return msg.body.content || "";
    }
    // For HTML content, strip tags (basic implementation)
    if (msg.body?.content) {
      return msg.body.content.replace(/<[^>]*>/g, "").trim();
    }
    return "";
  }

  /**
   * Extract attachments from a Graph API message.
   */
  private extractAttachmentsFromGraphMessage(
    msg: GraphChatMessage,
  ): Attachment[] {
    if (!msg.attachments?.length) {
      return [];
    }

    return msg.attachments.map((att) => ({
      type: att.contentType?.includes("image") ? "image" : "file",
      name: att.name || undefined,
      url: att.contentUrl || undefined,
      mimeType: att.contentType || undefined,
    }));
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

// Re-export card converter for advanced use
export { cardToAdaptiveCard, cardToFallbackText } from "./cards";
export { TeamsFormatConverter } from "./markdown";
