/**
 * Discord adapter types.
 */

import type {
  APIEmbed,
  APIMessage,
  ButtonStyle,
  ChannelType,
  InteractionType,
} from "discord-api-types/v10";

/**
 * Discord adapter configuration.
 */
export interface DiscordAdapterConfig {
  /** Discord bot token */
  botToken: string;
  /** Discord application public key for webhook signature verification */
  publicKey: string;
  /** Discord application ID */
  applicationId: string;
}

/**
 * Discord thread ID components.
 * Used for encoding/decoding thread IDs.
 */
export interface DiscordThreadId {
  /** Guild ID, or "@me" for DMs */
  guildId: string;
  /** Channel ID */
  channelId: string;
  /** Thread ID (if message is in a thread) */
  threadId?: string;
}

/**
 * Incoming Discord interaction from webhook.
 */
export interface DiscordInteraction {
  id: string;
  type: InteractionType;
  application_id: string;
  token: string;
  version: number;
  guild_id?: string;
  channel_id?: string;
  channel?: {
    id: string;
    type: ChannelType;
    name?: string;
  };
  member?: {
    user: DiscordUser;
    nick?: string;
    roles: string[];
    joined_at: string;
  };
  user?: DiscordUser;
  message?: APIMessage;
  data?: DiscordInteractionData;
}

/**
 * Discord user object.
 */
export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string;
  avatar?: string;
  bot?: boolean;
}

/**
 * Discord interaction data (for components/commands).
 */
export interface DiscordInteractionData {
  custom_id?: string;
  component_type?: number;
  values?: string[];
  name?: string;
  type?: number;
  options?: DiscordCommandOption[];
}

/**
 * Discord command option.
 */
export interface DiscordCommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordCommandOption[];
}

/**
 * Discord emoji.
 */
export interface DiscordEmoji {
  id?: string;
  name: string;
  animated?: boolean;
}

/**
 * Discord button component.
 */
export interface DiscordButton {
  type: 2; // Component type for button
  style: ButtonStyle;
  label?: string;
  emoji?: DiscordEmoji;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

/**
 * Discord action row component.
 */
export interface DiscordActionRow {
  type: 1; // Component type for action row
  components: DiscordButton[];
}

/**
 * Discord message create payload.
 */
export interface DiscordMessagePayload {
  content?: string;
  embeds?: APIEmbed[];
  components?: DiscordActionRow[];
  allowed_mentions?: {
    parse?: ("roles" | "users" | "everyone")[];
    roles?: string[];
    users?: string[];
    replied_user?: boolean;
  };
  message_reference?: {
    message_id: string;
    fail_if_not_exists?: boolean;
  };
  attachments?: {
    id: string;
    filename: string;
    description?: string;
  }[];
}

/**
 * Discord interaction response types.
 * Note: Only the types currently used are defined here.
 * Additional types: ChannelMessageWithSource (4), UpdateMessage (7)
 */
export enum InteractionResponseType {
  /** ACK a Ping */
  Pong = 1,
  /** ACK and edit later (deferred) */
  DeferredChannelMessageWithSource = 5,
  /** ACK component interaction, update message later */
  DeferredUpdateMessage = 6,
}

/**
 * Discord interaction response.
 */
export interface DiscordInteractionResponse {
  type: InteractionResponseType;
  data?: DiscordMessagePayload;
}
