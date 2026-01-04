/**
 * Discord adapter for chat-sdk.
 *
 * Uses Discord's HTTP Interactions API (not Gateway WebSocket) for
 * serverless compatibility. Webhook signature verification uses Ed25519.
 */

import {
  extractCard,
  extractFiles,
  NetworkError,
  toBuffer,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  ActionEvent,
  Adapter,
  AdapterPostableMessage,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  Message,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { convertEmojiPlaceholders, defaultEmojiResolver } from "chat";
import {
  type APIEmbed,
  type APIMessage,
  ChannelType,
  InteractionType,
} from "discord-api-types/v10";
import nacl from "tweetnacl";
import { cardToDiscordPayload, cardToFallbackText } from "./cards";
import { DiscordFormatConverter } from "./markdown";
import {
  type DiscordActionRow,
  type DiscordAdapterConfig,
  type DiscordInteraction,
  type DiscordInteractionResponse,
  type DiscordMessagePayload,
  type DiscordThreadId,
  InteractionResponseType,
} from "./types";

const DISCORD_API_BASE = "https://discord.com/api/v10";

export class DiscordAdapter implements Adapter<DiscordThreadId, unknown> {
  readonly name = "discord";
  readonly userName: string;
  readonly botUserId?: string;

  private botToken: string;
  private publicKey: string;
  private applicationId: string;
  private chat: ChatInstance | null = null;
  private logger: Logger;
  private formatConverter = new DiscordFormatConverter();

  constructor(
    config: DiscordAdapterConfig & { logger: Logger; userName?: string },
  ) {
    this.botToken = config.botToken;
    this.publicKey = config.publicKey;
    this.applicationId = config.applicationId;
    this.logger = config.logger;
    this.userName = config.userName ?? "bot";
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger.info("Discord adapter initialized", {
      applicationId: this.applicationId,
    });
  }

  /**
   * Handle incoming Discord webhook (HTTP Interactions).
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    const body = await request.text();

    // Verify Ed25519 signature
    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");

    if (!this.verifySignature(body, signature, timestamp)) {
      return new Response("Invalid signature", { status: 401 });
    }

    let interaction: DiscordInteraction;
    try {
      interaction = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    this.logger.debug("Discord webhook received", {
      type: interaction.type,
      id: interaction.id,
    });

    // Handle PING (Discord verification)
    if (interaction.type === InteractionType.Ping) {
      return this.respondToInteraction({ type: InteractionResponseType.Pong });
    }

    // Handle MESSAGE_COMPONENT (button clicks)
    if (interaction.type === InteractionType.MessageComponent) {
      this.handleComponentInteraction(interaction, options);
      // ACK the interaction immediately
      return this.respondToInteraction({
        type: InteractionResponseType.DeferredUpdateMessage,
      });
    }

    // Handle APPLICATION_COMMAND (slash commands - not implemented yet)
    if (interaction.type === InteractionType.ApplicationCommand) {
      // For now, just ACK
      return this.respondToInteraction({
        type: InteractionResponseType.DeferredChannelMessageWithSource,
      });
    }

    return new Response("Unknown interaction type", { status: 400 });
  }

  /**
   * Verify Discord's Ed25519 signature.
   */
  private verifySignature(
    body: string,
    signature: string | null,
    timestamp: string | null,
  ): boolean {
    if (!signature || !timestamp) {
      return false;
    }

    try {
      const message = timestamp + body;
      const publicKeyHex = this.publicKey;
      const signatureHex = signature;

      return nacl.sign.detached.verify(
        new TextEncoder().encode(message),
        hexToUint8Array(signatureHex),
        hexToUint8Array(publicKeyHex),
      );
    } catch (error) {
      this.logger.warn("Signature verification failed", { error });
      return false;
    }
  }

  /**
   * Create a JSON response for Discord interactions.
   */
  private respondToInteraction(response: DiscordInteractionResponse): Response {
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Handle MESSAGE_COMPONENT interactions (button clicks).
   */
  private handleComponentInteraction(
    interaction: DiscordInteraction,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring interaction");
      return;
    }

    const customId = interaction.data?.custom_id;
    if (!customId) {
      this.logger.warn("No custom_id in component interaction");
      return;
    }

    const user = interaction.member?.user || interaction.user;
    if (!user) {
      this.logger.warn("No user in component interaction");
      return;
    }

    const channelId = interaction.channel_id;
    const guildId = interaction.guild_id || "@me";
    const messageId = interaction.message?.id;

    if (!channelId || !messageId) {
      this.logger.warn("Missing channel_id or message_id in interaction");
      return;
    }

    const threadId = this.encodeThreadId({
      guildId,
      channelId,
    });

    const actionEvent: Omit<ActionEvent, "thread"> & {
      adapter: DiscordAdapter;
    } = {
      actionId: customId,
      value: customId, // Discord custom_id often contains the value
      user: {
        userId: user.id,
        userName: user.username,
        fullName: user.global_name || user.username,
        isBot: user.bot ?? false,
        isMe: false,
      },
      messageId,
      threadId,
      adapter: this,
      raw: interaction,
    };

    this.logger.debug("Processing Discord button action", {
      actionId: customId,
      messageId,
      threadId,
    });

    this.chat.processAction(actionEvent, options);
  }

  /**
   * Post a message to a Discord channel.
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { channelId } = this.decodeThreadId(threadId);

    // Build message payload
    const payload: DiscordMessagePayload = {};
    const embeds: APIEmbed[] = [];
    const components: DiscordActionRow[] = [];

    // Check for card
    const card = extractCard(message);
    if (card) {
      const cardPayload = cardToDiscordPayload(card);
      embeds.push(...cardPayload.embeds);
      components.push(...cardPayload.components);
      // Fallback text
      payload.content = cardToFallbackText(card);
    } else {
      // Regular text message
      payload.content = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "discord",
      );
    }

    if (embeds.length > 0) {
      payload.embeds = embeds;
    }
    if (components.length > 0) {
      payload.components = components;
    }

    // Handle file uploads
    const files = extractFiles(message);
    if (files.length > 0) {
      return this.postMessageWithFiles(channelId, threadId, payload, files);
    }

    this.logger.debug("Discord API: POST message", {
      channelId,
      contentLength: payload.content?.length || 0,
      embedCount: embeds.length,
      componentCount: components.length,
    });

    const response = await this.discordFetch(
      `/channels/${channelId}/messages`,
      "POST",
      payload,
    );

    const result = (await response.json()) as APIMessage;

    this.logger.debug("Discord API: POST message response", {
      messageId: result.id,
    });

    return {
      id: result.id,
      threadId,
      raw: result,
    };
  }

  /**
   * Post a message with file attachments.
   */
  private async postMessageWithFiles(
    channelId: string,
    threadId: string,
    payload: DiscordMessagePayload,
    files: Array<{
      filename: string;
      data: Buffer | Blob | ArrayBuffer;
      mimeType?: string;
    }>,
  ): Promise<RawMessage<unknown>> {
    const formData = new FormData();

    // Add JSON payload
    formData.append("payload_json", JSON.stringify(payload));

    // Add files
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;
      const buffer = await toBuffer(file.data, {
        platform: "discord" as "slack",
      });
      if (!buffer) continue;
      const blob = new Blob([buffer], {
        type: file.mimeType || "application/octet-stream",
      });
      formData.append(`files[${i}]`, blob, file.filename);
    }

    const response = await fetch(
      `${DISCORD_API_BASE}/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.botToken}`,
        },
        body: formData,
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new NetworkError(
        "discord",
        `Failed to post message: ${response.status} ${error}`,
      );
    }

    const result = (await response.json()) as APIMessage;

    return {
      id: result.id,
      threadId,
      raw: result,
    };
  }

  /**
   * Edit an existing Discord message.
   */
  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { channelId } = this.decodeThreadId(threadId);

    // Build message payload
    const payload: DiscordMessagePayload = {};
    const embeds: APIEmbed[] = [];
    const components: DiscordActionRow[] = [];

    // Check for card
    const card = extractCard(message);
    if (card) {
      const cardPayload = cardToDiscordPayload(card);
      embeds.push(...cardPayload.embeds);
      components.push(...cardPayload.components);
      payload.content = cardToFallbackText(card);
    } else {
      payload.content = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "discord",
      );
    }

    if (embeds.length > 0) {
      payload.embeds = embeds;
    }
    if (components.length > 0) {
      payload.components = components;
    }

    this.logger.debug("Discord API: PATCH message", {
      channelId,
      messageId,
      contentLength: payload.content?.length || 0,
    });

    const response = await this.discordFetch(
      `/channels/${channelId}/messages/${messageId}`,
      "PATCH",
      payload,
    );

    const result = (await response.json()) as APIMessage;

    this.logger.debug("Discord API: PATCH message response", {
      messageId: result.id,
    });

    return {
      id: result.id,
      threadId,
      raw: result,
    };
  }

  /**
   * Delete a Discord message.
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { channelId } = this.decodeThreadId(threadId);

    this.logger.debug("Discord API: DELETE message", {
      channelId,
      messageId,
    });

    await this.discordFetch(
      `/channels/${channelId}/messages/${messageId}`,
      "DELETE",
    );

    this.logger.debug("Discord API: DELETE message response", { ok: true });
  }

  /**
   * Add a reaction to a Discord message.
   */
  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    const { channelId } = this.decodeThreadId(threadId);
    const emojiEncoded = this.encodeEmoji(emoji);

    this.logger.debug("Discord API: PUT reaction", {
      channelId,
      messageId,
      emoji: emojiEncoded,
    });

    await this.discordFetch(
      `/channels/${channelId}/messages/${messageId}/reactions/${emojiEncoded}/@me`,
      "PUT",
    );

    this.logger.debug("Discord API: PUT reaction response", { ok: true });
  }

  /**
   * Remove a reaction from a Discord message.
   */
  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    const { channelId } = this.decodeThreadId(threadId);
    const emojiEncoded = this.encodeEmoji(emoji);

    this.logger.debug("Discord API: DELETE reaction", {
      channelId,
      messageId,
      emoji: emojiEncoded,
    });

    await this.discordFetch(
      `/channels/${channelId}/messages/${messageId}/reactions/${emojiEncoded}/@me`,
      "DELETE",
    );

    this.logger.debug("Discord API: DELETE reaction response", { ok: true });
  }

  /**
   * Encode an emoji for use in Discord API URLs.
   */
  private encodeEmoji(emoji: EmojiValue | string): string {
    const emojiStr = defaultEmojiResolver.toDiscord
      ? defaultEmojiResolver.toDiscord(emoji)
      : String(emoji);
    // URL-encode the emoji for the API path
    return encodeURIComponent(emojiStr);
  }

  /**
   * Start typing indicator in a Discord channel.
   */
  async startTyping(threadId: string): Promise<void> {
    const { channelId } = this.decodeThreadId(threadId);

    this.logger.debug("Discord API: POST typing", { channelId });

    await this.discordFetch(`/channels/${channelId}/typing`, "POST");
  }

  /**
   * Fetch messages from a Discord channel.
   */
  async fetchMessages(
    threadId: string,
    options: FetchOptions = {},
  ): Promise<FetchResult<unknown>> {
    const { channelId } = this.decodeThreadId(threadId);
    const limit = options.limit || 50;
    const direction = options.direction ?? "backward";

    const params = new URLSearchParams();
    params.set("limit", String(limit));

    // Handle pagination cursor
    if (options.cursor) {
      if (direction === "backward") {
        params.set("before", options.cursor);
      } else {
        params.set("after", options.cursor);
      }
    }

    this.logger.debug("Discord API: GET messages", {
      channelId,
      limit,
      direction,
      cursor: options.cursor,
    });

    const response = await this.discordFetch(
      `/channels/${channelId}/messages?${params.toString()}`,
      "GET",
    );

    const rawMessages = (await response.json()) as APIMessage[];

    this.logger.debug("Discord API: GET messages response", {
      messageCount: rawMessages.length,
    });

    // Discord returns messages in reverse chronological order (newest first)
    // For consistency, reverse to chronological order (oldest first)
    const sortedMessages = [...rawMessages].reverse();

    const messages = sortedMessages.map((msg) =>
      this.parseDiscordMessage(msg, threadId),
    );

    // Determine next cursor
    let nextCursor: string | undefined;
    if (rawMessages.length === limit) {
      if (direction === "backward") {
        // For backward, cursor is the oldest message ID in the batch
        const oldest = rawMessages[rawMessages.length - 1];
        nextCursor = oldest?.id;
      } else {
        // For forward, cursor is the newest message ID in the batch
        const newest = rawMessages[0];
        nextCursor = newest?.id;
      }
    }

    return {
      messages,
      nextCursor,
    };
  }

  /**
   * Fetch thread/channel information.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { channelId, guildId } = this.decodeThreadId(threadId);

    this.logger.debug("Discord API: GET channel", { channelId });

    const response = await this.discordFetch(`/channels/${channelId}`, "GET");
    const channel = (await response.json()) as {
      id: string;
      name?: string;
      type: ChannelType;
    };

    return {
      id: threadId,
      channelId,
      channelName: channel.name,
      isDM:
        channel.type === ChannelType.DM || channel.type === ChannelType.GroupDM,
      metadata: {
        guildId,
        channelType: channel.type,
        raw: channel,
      },
    };
  }

  /**
   * Open a DM with a user.
   */
  async openDM(userId: string): Promise<string> {
    this.logger.debug("Discord API: POST DM channel", { userId });

    const response = await this.discordFetch(`/users/@me/channels`, "POST", {
      recipient_id: userId,
    });

    const dmChannel = (await response.json()) as {
      id: string;
      type: ChannelType;
    };

    this.logger.debug("Discord API: POST DM channel response", {
      channelId: dmChannel.id,
    });

    return this.encodeThreadId({
      guildId: "@me",
      channelId: dmChannel.id,
    });
  }

  /**
   * Check if a thread is a DM.
   */
  isDM(threadId: string): boolean {
    const { guildId } = this.decodeThreadId(threadId);
    return guildId === "@me";
  }

  /**
   * Encode platform data into a thread ID string.
   */
  encodeThreadId(platformData: DiscordThreadId): string {
    const threadPart = platformData.threadId ? `:${platformData.threadId}` : "";
    return `discord:${platformData.guildId}:${platformData.channelId}${threadPart}`;
  }

  /**
   * Decode thread ID string back to platform data.
   */
  decodeThreadId(threadId: string): DiscordThreadId {
    const parts = threadId.split(":");
    if (parts.length < 3 || parts[0] !== "discord") {
      throw new ValidationError(
        "discord",
        `Invalid Discord thread ID: ${threadId}`,
      );
    }

    return {
      guildId: parts[1] as string,
      channelId: parts[2] as string,
      threadId: parts[3],
    };
  }

  /**
   * Parse a Discord message into normalized format.
   */
  parseMessage(raw: unknown): Message<unknown> {
    const msg = raw as APIMessage & { guild_id?: string };
    const guildId = msg.guild_id || "@me";
    const threadId = this.encodeThreadId({
      guildId,
      channelId: msg.channel_id,
    });
    return this.parseDiscordMessage(msg, threadId);
  }

  /**
   * Parse a Discord API message into normalized format.
   */
  private parseDiscordMessage(
    msg: APIMessage,
    threadId: string,
  ): Message<unknown> {
    const author = msg.author;
    const isBot = author.bot ?? false;
    const isMe = author.id === this.botUserId;

    return {
      id: msg.id,
      threadId,
      text: this.formatConverter.extractPlainText(msg.content),
      formatted: this.formatConverter.toAst(msg.content),
      raw: msg,
      author: {
        userId: author.id,
        userName: author.username,
        fullName: author.global_name || author.username,
        isBot,
        isMe,
      },
      metadata: {
        dateSent: new Date(msg.timestamp),
        edited: msg.edited_timestamp !== null,
        editedAt: msg.edited_timestamp
          ? new Date(msg.edited_timestamp)
          : undefined,
      },
      attachments: (msg.attachments || []).map((att) => ({
        type: this.getAttachmentType(att.content_type),
        url: att.url,
        name: att.filename,
        mimeType: att.content_type,
        size: att.size,
        width: att.width ?? undefined,
        height: att.height ?? undefined,
      })),
    };
  }

  /**
   * Determine attachment type from MIME type.
   */
  private getAttachmentType(
    mimeType?: string,
  ): "image" | "video" | "audio" | "file" {
    if (!mimeType) return "file";
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return "file";
  }

  /**
   * Render formatted content to Discord markdown.
   */
  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Make a request to the Discord API.
   */
  private async discordFetch(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${DISCORD_API_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bot ${this.botToken}`,
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error("Discord API error", {
        path,
        method,
        status: response.status,
        error: errorText,
      });
      throw new NetworkError(
        "discord",
        `Discord API error: ${response.status} ${errorText}`,
      );
    }

    return response;
  }
}

/**
 * Convert hex string to Uint8Array.
 */
function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Create a Discord adapter instance.
 */
export function createDiscordAdapter(
  config: DiscordAdapterConfig & { logger: Logger; userName?: string },
): DiscordAdapter {
  return new DiscordAdapter(config);
}

// Re-export card converter for advanced use
export { cardToDiscordPayload, cardToFallbackText } from "./cards";

// Re-export format converter for advanced use
export {
  DiscordFormatConverter,
  DiscordFormatConverter as DiscordMarkdownConverter,
} from "./markdown";
// Re-export types
export type { DiscordAdapterConfig, DiscordThreadId } from "./types";
