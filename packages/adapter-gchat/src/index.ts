import type {
  Adapter,
  ChatInstance,
  FetchOptions,
  FormattedContent,
  Logger,
  Message,
  PostableMessage,
  RawMessage,
  StateAdapter,
  ThreadInfo,
  WebhookOptions,
} from "chat-sdk";
import { RateLimitError } from "chat-sdk";
import { type chat_v1, google } from "googleapis";
import { GoogleChatFormatConverter } from "./markdown";
import {
  createSpaceSubscription,
  decodePubSubMessage,
  listSpaceSubscriptions,
  type PubSubPushMessage,
  type WorkspaceEventNotification,
  type WorkspaceEventsAuthOptions,
} from "./workspace-events";

/** How long before expiry to refresh subscriptions (1 hour) */
const SUBSCRIPTION_REFRESH_BUFFER_MS = 60 * 60 * 1000;
/** TTL for subscription cache entries (25 hours - longer than max subscription lifetime) */
const SUBSCRIPTION_CACHE_TTL_MS = 25 * 60 * 60 * 1000;
/** Key prefix for space subscription cache */
const SPACE_SUB_KEY_PREFIX = "gchat:space-sub:";

/** Service account credentials for JWT auth */
export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/** Base config options shared by all auth methods */
export interface GoogleChatAdapterBaseConfig {
  /** Override bot username (optional) */
  userName?: string;
  /**
   * Pub/Sub topic for receiving all messages via Workspace Events.
   * When set, the adapter will automatically create subscriptions when added to a space.
   * Format: "projects/my-project/topics/my-topic"
   */
  pubsubTopic?: string;
  /**
   * User email to impersonate for Workspace Events API calls.
   * Required when using domain-wide delegation.
   * This user must have access to the Chat spaces you want to subscribe to.
   */
  impersonateUser?: string;
}

/** Config using service account credentials (JSON key file) */
export interface GoogleChatAdapterServiceAccountConfig
  extends GoogleChatAdapterBaseConfig {
  /** Service account credentials JSON */
  credentials: ServiceAccountCredentials;
  auth?: never;
  useApplicationDefaultCredentials?: never;
}

/** Config using Application Default Credentials (ADC) or Workload Identity Federation */
export interface GoogleChatAdapterADCConfig
  extends GoogleChatAdapterBaseConfig {
  /**
   * Use Application Default Credentials.
   * Works with:
   * - GOOGLE_APPLICATION_CREDENTIALS env var pointing to a JSON key file
   * - Workload Identity Federation (external_account JSON)
   * - GCE/Cloud Run/Cloud Functions default service account
   * - gcloud auth application-default login (local development)
   */
  useApplicationDefaultCredentials: true;
  credentials?: never;
  auth?: never;
}

/** Config using a custom auth client */
export interface GoogleChatAdapterCustomAuthConfig
  extends GoogleChatAdapterBaseConfig {
  /** Custom auth client (JWT, OAuth2, GoogleAuth, etc.) */
  auth: Parameters<typeof google.chat>[0]["auth"];
  credentials?: never;
  useApplicationDefaultCredentials?: never;
}

export type GoogleChatAdapterConfig =
  | GoogleChatAdapterServiceAccountConfig
  | GoogleChatAdapterADCConfig
  | GoogleChatAdapterCustomAuthConfig;

/** Google Chat-specific thread ID data */
export interface GoogleChatThreadId {
  spaceName: string;
  threadName?: string;
}

/** Google Chat message structure */
export interface GoogleChatMessage {
  name: string;
  sender: {
    name: string;
    displayName: string;
    type: string;
    email?: string;
  };
  text: string;
  argumentText?: string;
  formattedText?: string;
  thread?: {
    name: string;
  };
  space?: {
    name: string;
    type: string;
    displayName?: string;
  };
  createTime: string;
  annotations?: Array<{
    type: string;
    startIndex?: number;
    length?: number;
    userMention?: {
      user: { name: string; displayName?: string; type: string };
      type: string;
    };
  }>;
  attachment?: Array<{
    name: string;
    contentName: string;
    contentType: string;
    downloadUri?: string;
  }>;
}

/** Google Chat space structure */
export interface GoogleChatSpace {
  name: string;
  type: string;
  displayName?: string;
  spaceThreadingState?: string;
}

/** Google Chat user structure */
export interface GoogleChatUser {
  name: string;
  displayName: string;
  type: string;
  email?: string;
}

/**
 * Google Workspace Add-ons event format.
 * This is the format used when configuring the app via Google Cloud Console.
 */
export interface GoogleChatEvent {
  commonEventObject?: {
    userLocale?: string;
    hostApp?: string;
    platform?: string;
  };
  chat?: {
    user?: GoogleChatUser;
    eventTime?: string;
    messagePayload?: {
      space: GoogleChatSpace;
      message: GoogleChatMessage;
    };
    /** Present when the bot is added to a space */
    addedToSpacePayload?: {
      space: GoogleChatSpace;
    };
    /** Present when the bot is removed from a space */
    removedFromSpacePayload?: {
      space: GoogleChatSpace;
    };
  };
}

/** Cached subscription info */
interface SpaceSubscriptionInfo {
  subscriptionName: string;
  expireTime: number; // Unix timestamp ms
}

export class GoogleChatAdapter implements Adapter<GoogleChatThreadId, unknown> {
  readonly name = "gchat";
  readonly userName: string;
  /** Bot's user ID (e.g., "users/123...") - learned from annotations */
  botUserId?: string;

  private chatApi: chat_v1.Chat;
  private chat: ChatInstance | null = null;
  private state: StateAdapter | null = null;
  private logger: Logger | null = null;
  private formatConverter = new GoogleChatFormatConverter();
  private pubsubTopic?: string;
  private credentials?: ServiceAccountCredentials;
  private useADC = false;
  /** Custom auth client (e.g., Vercel OIDC) */
  private customAuth?: Parameters<typeof google.chat>[0]["auth"];
  /** User email to impersonate for Workspace Events API (domain-wide delegation) */
  private impersonateUser?: string;
  /** In-progress subscription creations to prevent duplicate requests */
  private pendingSubscriptions = new Map<string, Promise<void>>();

  constructor(config: GoogleChatAdapterConfig) {
    this.userName = config.userName || "bot";
    this.pubsubTopic = config.pubsubTopic;
    this.impersonateUser = config.impersonateUser;

    let auth: Parameters<typeof google.chat>[0]["auth"];

    if ("credentials" in config && config.credentials) {
      // Service account credentials (JWT)
      this.credentials = config.credentials;
      auth = new google.auth.JWT({
        email: config.credentials.client_email,
        key: config.credentials.private_key,
        scopes: ["https://www.googleapis.com/auth/chat.bot"],
      });
    } else if (
      "useApplicationDefaultCredentials" in config &&
      config.useApplicationDefaultCredentials
    ) {
      // Application Default Credentials (ADC)
      // Works with Workload Identity Federation, GCE metadata, GOOGLE_APPLICATION_CREDENTIALS env var
      this.useADC = true;
      auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/chat.bot"],
      });
    } else if ("auth" in config && config.auth) {
      // Custom auth client provided directly (e.g., Vercel OIDC)
      this.customAuth = config.auth;
      auth = config.auth;
    } else {
      throw new Error(
        "GoogleChatAdapter requires one of: credentials, useApplicationDefaultCredentials, or auth",
      );
    }

    this.chatApi = google.chat({ version: "v1", auth });
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.state = chat.getState();
    this.logger = chat.getLogger(this.name);

    // Restore persisted bot user ID from state (for serverless environments)
    if (!this.botUserId) {
      const savedBotUserId = await this.state.get<string>("gchat:botUserId");
      if (savedBotUserId) {
        this.botUserId = savedBotUserId;
        this.logger?.debug("Restored bot user ID from state", {
          botUserId: this.botUserId,
        });
      }
    }
  }

  /**
   * Called when a thread is subscribed to.
   * Ensures the space has a Workspace Events subscription so we receive all messages.
   */
  async onThreadSubscribe(threadId: string): Promise<void> {
    this.logger?.info("onThreadSubscribe called", {
      threadId,
      hasPubsubTopic: !!this.pubsubTopic,
      pubsubTopic: this.pubsubTopic,
    });

    if (!this.pubsubTopic) {
      this.logger?.warn(
        "No pubsubTopic configured, skipping space subscription. Set GOOGLE_CHAT_PUBSUB_TOPIC env var.",
      );
      return;
    }

    const { spaceName } = this.decodeThreadId(threadId);
    await this.ensureSpaceSubscription(spaceName);
  }

  /**
   * Ensure a Workspace Events subscription exists for a space.
   * Creates one if it doesn't exist or is about to expire.
   */
  private async ensureSpaceSubscription(spaceName: string): Promise<void> {
    this.logger?.info("ensureSpaceSubscription called", {
      spaceName,
      hasPubsubTopic: !!this.pubsubTopic,
      hasState: !!this.state,
      hasCredentials: !!this.credentials,
      hasADC: this.useADC,
    });

    if (!this.pubsubTopic || !this.state) {
      this.logger?.warn("ensureSpaceSubscription skipped - missing config", {
        hasPubsubTopic: !!this.pubsubTopic,
        hasState: !!this.state,
      });
      return;
    }

    const cacheKey = `${SPACE_SUB_KEY_PREFIX}${spaceName}`;

    // Check if we already have a valid subscription
    const cached = await this.state.get<SpaceSubscriptionInfo>(cacheKey);
    if (cached) {
      const timeUntilExpiry = cached.expireTime - Date.now();
      if (timeUntilExpiry > SUBSCRIPTION_REFRESH_BUFFER_MS) {
        this.logger?.debug("Space subscription still valid", {
          spaceName,
          expiresIn: Math.round(timeUntilExpiry / 1000 / 60),
        });
        return;
      }
      this.logger?.debug("Space subscription expiring soon, will refresh", {
        spaceName,
        expiresIn: Math.round(timeUntilExpiry / 1000 / 60),
      });
    }

    // Check if we're already creating a subscription for this space
    const pending = this.pendingSubscriptions.get(spaceName);
    if (pending) {
      this.logger?.debug("Subscription creation already in progress", {
        spaceName,
      });
      return pending;
    }

    // Create the subscription
    const createPromise = this.createSpaceSubscriptionWithCache(
      spaceName,
      cacheKey,
    );
    this.pendingSubscriptions.set(spaceName, createPromise);

    try {
      await createPromise;
    } finally {
      this.pendingSubscriptions.delete(spaceName);
    }
  }

  /**
   * Create a Workspace Events subscription and cache the result.
   */
  private async createSpaceSubscriptionWithCache(
    spaceName: string,
    cacheKey: string,
  ): Promise<void> {
    const authOptions = this.getAuthOptions();
    this.logger?.info("createSpaceSubscriptionWithCache", {
      spaceName,
      hasAuthOptions: !!authOptions,
      hasCredentials: !!this.credentials,
      hasADC: this.useADC,
    });

    if (!authOptions) {
      this.logger?.error(
        "Cannot create subscription: no auth configured. Use GOOGLE_CHAT_CREDENTIALS, GOOGLE_CHAT_USE_ADC=true, or custom auth.",
      );
      return;
    }

    const pubsubTopic = this.pubsubTopic;
    if (!pubsubTopic) return;

    try {
      // First check if a subscription already exists via the API
      const existing = await this.findExistingSubscription(
        spaceName,
        authOptions,
      );
      if (existing) {
        this.logger?.debug("Found existing subscription", {
          spaceName,
          subscriptionName: existing.subscriptionName,
        });
        // Cache it
        if (this.state) {
          await this.state.set<SpaceSubscriptionInfo>(
            cacheKey,
            existing,
            SUBSCRIPTION_CACHE_TTL_MS,
          );
        }
        return;
      }

      this.logger?.info("Creating Workspace Events subscription", {
        spaceName,
        pubsubTopic,
      });

      const result = await createSpaceSubscription(
        { spaceName, pubsubTopic },
        authOptions,
      );

      const subscriptionInfo: SpaceSubscriptionInfo = {
        subscriptionName: result.name,
        expireTime: new Date(result.expireTime).getTime(),
      };

      // Cache the subscription info
      if (this.state) {
        await this.state.set<SpaceSubscriptionInfo>(
          cacheKey,
          subscriptionInfo,
          SUBSCRIPTION_CACHE_TTL_MS,
        );
      }

      this.logger?.info("Workspace Events subscription created", {
        spaceName,
        subscriptionName: result.name,
        expireTime: result.expireTime,
      });
    } catch (error) {
      this.logger?.error("Failed to create Workspace Events subscription", {
        spaceName,
        error,
      });
      // Don't throw - subscription failure shouldn't break the main flow
    }
  }

  /**
   * Check if a subscription already exists for this space.
   */
  private async findExistingSubscription(
    spaceName: string,
    authOptions: WorkspaceEventsAuthOptions,
  ): Promise<SpaceSubscriptionInfo | null> {
    try {
      const subscriptions = await listSpaceSubscriptions(
        spaceName,
        authOptions,
      );
      for (const sub of subscriptions) {
        // Check if this subscription is still valid
        const expireTime = new Date(sub.expireTime).getTime();
        if (expireTime > Date.now() + SUBSCRIPTION_REFRESH_BUFFER_MS) {
          return {
            subscriptionName: sub.name,
            expireTime,
          };
        }
      }
    } catch (error) {
      this.logger?.debug("Error checking existing subscriptions", { error });
    }
    return null;
  }

  /**
   * Get auth options for Workspace Events API calls.
   */
  private getAuthOptions(): WorkspaceEventsAuthOptions | null {
    if (this.credentials) {
      return {
        credentials: this.credentials,
        impersonateUser: this.impersonateUser,
      };
    }
    if (this.useADC) {
      return {
        useApplicationDefaultCredentials: true as const,
        impersonateUser: this.impersonateUser,
      };
    }
    if (this.customAuth) {
      return { auth: this.customAuth };
    }
    return null;
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    const body = await request.text();
    this.logger?.debug("GChat webhook raw body", { body });

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Check if this is a Pub/Sub push message (from Workspace Events subscription)
    const maybePubSub = parsed as PubSubPushMessage;
    if (maybePubSub.message?.data && maybePubSub.subscription) {
      return this.handlePubSubMessage(maybePubSub, options);
    }

    // Otherwise, treat as a direct Google Chat webhook event
    const event = parsed as GoogleChatEvent;

    // Handle ADDED_TO_SPACE - automatically create subscription
    const addedPayload = event.chat?.addedToSpacePayload;
    if (addedPayload) {
      this.logger?.debug("Bot added to space", {
        space: addedPayload.space.name,
        spaceType: addedPayload.space.type,
      });
      this.handleAddedToSpace(addedPayload.space, options);
    }

    // Handle REMOVED_FROM_SPACE (for logging)
    const removedPayload = event.chat?.removedFromSpacePayload;
    if (removedPayload) {
      this.logger?.debug("Bot removed from space", {
        space: removedPayload.space.name,
      });
    }

    // Check for message payload in the Add-ons format
    const messagePayload = event.chat?.messagePayload;
    if (messagePayload) {
      this.logger?.debug("message event", {
        space: messagePayload.space.name,
        sender: messagePayload.message.sender?.displayName,
        text: messagePayload.message.text?.slice(0, 50),
      });
      this.handleMessageEvent(event, options);
    } else if (!addedPayload && !removedPayload) {
      this.logger?.debug("Non-message event received", {
        hasChat: !!event.chat,
        hasCommonEventObject: !!event.commonEventObject,
      });
    }

    // Google Chat expects an empty response or a message response
    return new Response(JSON.stringify({}), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Handle Pub/Sub push messages from Workspace Events subscriptions.
   * These contain all messages in a space, not just @mentions.
   */
  private handlePubSubMessage(
    pushMessage: PubSubPushMessage,
    options?: WebhookOptions,
  ): Response {
    // Early filter: Check event type BEFORE base64 decoding to save CPU
    // The ce-type attribute is available in message.attributes
    const eventType = pushMessage.message?.attributes?.["ce-type"];
    if (eventType && eventType !== "google.workspace.chat.message.v1.created") {
      this.logger?.debug("Skipping non-created Pub/Sub event", { eventType });
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const notification = decodePubSubMessage(pushMessage);
      this.logger?.debug("Pub/Sub notification decoded", {
        eventType: notification.eventType,
        messageId: notification.message?.name,
      });

      // Handle message.created events
      if (notification.message) {
        this.handlePubSubMessageEvent(notification, options);
      }

      // Acknowledge the message
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      this.logger?.error("Error processing Pub/Sub message", { error });
      // Return 200 to avoid retries for malformed messages
      return new Response(JSON.stringify({ error: "Processing failed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  /**
   * Handle message events received via Pub/Sub (Workspace Events).
   */
  private handlePubSubMessageEvent(
    notification: WorkspaceEventNotification,
    options?: WebhookOptions,
  ): void {
    if (!this.chat || !notification.message) {
      return;
    }

    const message = notification.message;
    // Extract space name from targetResource: "//chat.googleapis.com/spaces/AAAA"
    const spaceName = notification.targetResource?.replace(
      "//chat.googleapis.com/",
      "",
    );
    const threadName = message.thread?.name || message.name;
    const threadId = this.encodeThreadId({
      spaceName: spaceName || message.space?.name || "",
      threadName,
    });

    // Refresh subscription if needed (runs in background)
    const resolvedSpaceName = spaceName || message.space?.name;
    if (resolvedSpaceName && options?.waitUntil) {
      options.waitUntil(
        this.ensureSpaceSubscription(resolvedSpaceName).catch((err) => {
          this.logger?.debug("Subscription refresh failed", { error: err });
        }),
      );
    }

    // Let Chat class handle async processing and waitUntil
    this.chat.processMessage(
      this,
      threadId,
      this.parsePubSubMessage(notification, threadId),
      options,
    );
  }

  /**
   * Parse a Pub/Sub message into the standard Message format.
   */
  private parsePubSubMessage(
    notification: WorkspaceEventNotification,
    threadId: string,
  ): Message<unknown> {
    const message = notification.message;
    if (!message) {
      throw new Error("PubSub notification missing message");
    }
    const text = this.normalizeBotMentions(message);
    const isBot = message.sender?.type === "BOT";
    const isMe = this.isMessageFromSelf(message);

    const parsedMessage: Message<unknown> = {
      id: message.name,
      threadId,
      text: this.formatConverter.extractPlainText(text),
      formatted: this.formatConverter.toAst(text),
      raw: notification,
      author: {
        userId: message.sender?.name || "unknown",
        userName: message.sender?.displayName || "unknown",
        fullName: message.sender?.displayName || "unknown",
        isBot,
        isMe,
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

    this.logger?.debug("Pub/Sub parsed message", {
      threadId,
      messageId: parsedMessage.id,
      text: parsedMessage.text,
      isBot: parsedMessage.author.isBot,
      isMe: parsedMessage.author.isMe,
    });

    return parsedMessage;
  }

  /**
   * Handle bot being added to a space - create Workspace Events subscription.
   */
  private handleAddedToSpace(
    space: GoogleChatSpace,
    options?: WebhookOptions,
  ): void {
    const subscribeTask = this.ensureSpaceSubscription(space.name);

    if (options?.waitUntil) {
      options.waitUntil(subscribeTask);
    }
  }

  /**
   * Handle direct webhook message events (Add-ons format).
   */
  private handleMessageEvent(
    event: GoogleChatEvent,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) {
      this.logger?.warn("Chat instance not initialized, ignoring event");
      return;
    }

    const messagePayload = event.chat?.messagePayload;
    if (!messagePayload) {
      this.logger?.debug("Ignoring event without messagePayload");
      return;
    }

    const message = messagePayload.message;
    const threadName = message.thread?.name || message.name;
    const threadId = this.encodeThreadId({
      spaceName: messagePayload.space.name,
      threadName,
    });

    // Let Chat class handle async processing and waitUntil
    this.chat.processMessage(
      this,
      threadId,
      this.parseGoogleChatMessage(event, threadId),
      options,
    );
  }

  private parseGoogleChatMessage(
    event: GoogleChatEvent,
    threadId: string,
  ): Message<unknown> {
    const message = event.chat?.messagePayload?.message;
    if (!message) {
      throw new Error("Event has no message payload");
    }

    // Normalize bot mentions: replace @BotDisplayName with @{userName}
    // so the Chat SDK's mention detection works properly
    const text = this.normalizeBotMentions(message);

    const isBot = message.sender?.type === "BOT";
    const isMe = this.isMessageFromSelf(message);

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
        isBot,
        isMe,
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
        // Required to reply in an existing thread
        messageReplyOption: threadName
          ? "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"
          : undefined,
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
        const msgIsBot = msg.sender?.type === "BOT";
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
            isBot: msgIsBot,
            isMe: msgIsBot,
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
    const messagePayload = event.chat?.messagePayload;
    if (!messagePayload) {
      throw new Error("Cannot parse non-message event");
    }
    const threadName =
      messagePayload.message.thread?.name || messagePayload.message.name;
    const threadId = this.encodeThreadId({
      spaceName: messagePayload.space.name,
      threadName,
    });
    return this.parseGoogleChatMessage(event, threadId);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Normalize bot mentions in message text.
   * Google Chat uses the bot's display name (e.g., "@Chat SDK Demo") but the
   * Chat SDK expects "@{userName}" format. This method replaces bot mentions
   * with the adapter's userName so mention detection works properly.
   * Also learns the bot's user ID from annotations for isMe detection.
   */
  private normalizeBotMentions(message: GoogleChatMessage): string {
    let text = message.text || "";

    // Find bot mentions in annotations and replace with @{userName}
    const annotations = message.annotations || [];
    for (const annotation of annotations) {
      if (
        annotation.type === "USER_MENTION" &&
        annotation.userMention?.user?.type === "BOT"
      ) {
        const botUser = annotation.userMention.user;
        const botDisplayName = botUser.displayName;

        // Learn our bot's user ID from mentions and persist to state
        if (botUser.name && !this.botUserId) {
          this.botUserId = botUser.name;
          this.logger?.info("Learned bot user ID from mention", {
            botUserId: this.botUserId,
          });
          // Persist to state for serverless environments
          this.state
            ?.set("gchat:botUserId", this.botUserId)
            .catch((err) =>
              this.logger?.debug("Failed to persist botUserId", { error: err }),
            );
        }

        // Replace the bot mention with @{userName}
        // Pub/Sub messages don't include displayName, so use startIndex/length
        if (
          annotation.startIndex !== undefined &&
          annotation.length !== undefined
        ) {
          const startIndex = annotation.startIndex;
          const length = annotation.length;
          const mentionText = text.slice(startIndex, startIndex + length);
          text =
            text.slice(0, startIndex) +
            `@${this.userName}` +
            text.slice(startIndex + length);
          this.logger?.debug("Normalized bot mention", {
            original: mentionText,
            replacement: `@${this.userName}`,
          });
        } else if (botDisplayName) {
          // Fallback: use displayName if available (direct webhook)
          const mentionText = `@${botDisplayName}`;
          text = text.replace(mentionText, `@${this.userName}`);
        }
      }
    }

    return text;
  }

  /**
   * Check if a message is from this bot.
   */
  private isMessageFromSelf(message: GoogleChatMessage): boolean {
    const senderType = message.sender?.type;
    const senderId = message.sender?.name;

    // If we know our bot's user ID, use it for precise matching
    if (this.botUserId && senderId) {
      return senderId === this.botUserId;
    }

    // Fallback: assume all BOT messages are from us
    // (This is safe for direct webhooks but may miss other bots in Pub/Sub)
    return senderType === "BOT";
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

export { GoogleChatFormatConverter } from "./markdown";

export {
  type CreateSpaceSubscriptionOptions,
  createSpaceSubscription,
  decodePubSubMessage,
  deleteSpaceSubscription,
  listSpaceSubscriptions,
  type PubSubPushMessage,
  type SpaceSubscriptionResult,
  verifyPubSubRequest,
  type WorkspaceEventNotification,
  type WorkspaceEventsAuthOptions,
} from "./workspace-events";
