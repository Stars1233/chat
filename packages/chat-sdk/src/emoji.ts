import type {
  CustomEmojiMap,
  Emoji,
  EmojiFormats,
  EmojiMapConfig,
  WellKnownEmoji,
} from "./types";

/**
 * Default emoji map for well-known emoji.
 * Maps normalized emoji names to platform-specific formats.
 */
export const DEFAULT_EMOJI_MAP: Record<string, EmojiFormats> = {
  thumbs_up: { slack: ["+1", "thumbsup"], gchat: "👍" },
  thumbs_down: { slack: ["-1", "thumbsdown"], gchat: "👎" },
  heart: { slack: "heart", gchat: ["❤️", "❤"] },
  smile: { slack: ["smile", "slightly_smiling_face"], gchat: "😊" },
  laugh: { slack: ["laughing", "satisfied", "joy"], gchat: ["😂", "😆"] },
  thinking: { slack: "thinking_face", gchat: "🤔" },
  eyes: { slack: "eyes", gchat: "👀" },
  fire: { slack: "fire", gchat: "🔥" },
  check: {
    slack: ["white_check_mark", "heavy_check_mark"],
    gchat: ["✅", "✔️"],
  },
  x: { slack: ["x", "heavy_multiplication_x"], gchat: ["❌", "✖️"] },
  question: { slack: "question", gchat: ["❓", "?"] },
  party: { slack: ["tada", "partying_face"], gchat: ["🎉", "🥳"] },
  rocket: { slack: "rocket", gchat: "🚀" },
  star: { slack: "star", gchat: "⭐" },
  wave: { slack: "wave", gchat: "👋" },
  clap: { slack: "clap", gchat: "👏" },
  "100": { slack: "100", gchat: "💯" },
  warning: { slack: "warning", gchat: "⚠️" },
};

/**
 * Emoji resolver that handles conversion between platform formats and normalized names.
 */
export class EmojiResolver {
  private emojiMap: Record<string, EmojiFormats>;
  private slackToNormalized: Map<string, string>;
  private gchatToNormalized: Map<string, string>;

  constructor(customMap?: EmojiMapConfig) {
    this.emojiMap = { ...DEFAULT_EMOJI_MAP, ...customMap };
    this.slackToNormalized = new Map();
    this.gchatToNormalized = new Map();
    this.buildReverseMaps();
  }

  private buildReverseMaps(): void {
    for (const [normalized, formats] of Object.entries(this.emojiMap)) {
      // Build Slack reverse map
      const slackFormats = Array.isArray(formats.slack)
        ? formats.slack
        : [formats.slack];
      for (const slack of slackFormats) {
        this.slackToNormalized.set(slack.toLowerCase(), normalized);
      }

      // Build GChat reverse map
      const gchatFormats = Array.isArray(formats.gchat)
        ? formats.gchat
        : [formats.gchat];
      for (const gchat of gchatFormats) {
        this.gchatToNormalized.set(gchat, normalized);
      }
    }
  }

  /**
   * Convert a Slack emoji name to normalized format.
   * Returns the raw emoji if no mapping exists.
   */
  fromSlack(slackEmoji: string): Emoji | string {
    // Remove colons if present (e.g., ":+1:" -> "+1")
    const cleaned = slackEmoji.replace(/^:|:$/g, "").toLowerCase();
    return this.slackToNormalized.get(cleaned) ?? slackEmoji;
  }

  /**
   * Convert a Google Chat unicode emoji to normalized format.
   * Returns the raw emoji if no mapping exists.
   */
  fromGChat(gchatEmoji: string): Emoji | string {
    return this.gchatToNormalized.get(gchatEmoji) ?? gchatEmoji;
  }

  /**
   * Convert a normalized emoji to Slack format.
   * Returns the first Slack format if multiple exist.
   */
  toSlack(emoji: Emoji | string): string {
    const formats = this.emojiMap[emoji];
    if (!formats) return emoji;
    return Array.isArray(formats.slack) ? formats.slack[0] : formats.slack;
  }

  /**
   * Convert a normalized emoji to Google Chat format.
   * Returns the first GChat format if multiple exist.
   */
  toGChat(emoji: Emoji | string): string {
    const formats = this.emojiMap[emoji];
    if (!formats) return emoji;
    return Array.isArray(formats.gchat) ? formats.gchat[0] : formats.gchat;
  }

  /**
   * Check if an emoji (in any format) matches a normalized emoji name.
   */
  matches(rawEmoji: string, normalized: Emoji | string): boolean {
    const formats = this.emojiMap[normalized];
    if (!formats) return rawEmoji === normalized;

    const slackFormats = Array.isArray(formats.slack)
      ? formats.slack
      : [formats.slack];
    const gchatFormats = Array.isArray(formats.gchat)
      ? formats.gchat
      : [formats.gchat];

    const cleanedRaw = rawEmoji.replace(/^:|:$/g, "").toLowerCase();

    return (
      slackFormats.some((s) => s.toLowerCase() === cleanedRaw) ||
      gchatFormats.includes(rawEmoji)
    );
  }

  /**
   * Add or override emoji mappings.
   */
  extend(customMap: EmojiMapConfig): void {
    Object.assign(this.emojiMap, customMap);
    this.buildReverseMaps();
  }
}

/**
 * Default emoji resolver instance.
 */
export const defaultEmojiResolver = new EmojiResolver();

/** Placeholder pattern for emoji in text: {{emoji:name}} */
const EMOJI_PLACEHOLDER_REGEX = /\{\{emoji:([a-z0-9_]+)\}\}/gi;

/**
 * Convert emoji placeholders in text to platform-specific format.
 *
 * @example
 * ```typescript
 * convertEmojiPlaceholders("Thanks! {{emoji:thumbs_up}}", "slack");
 * // Returns: "Thanks! :+1:"
 *
 * convertEmojiPlaceholders("Thanks! {{emoji:thumbs_up}}", "gchat");
 * // Returns: "Thanks! 👍"
 * ```
 */
export function convertEmojiPlaceholders(
  text: string,
  platform: "slack" | "gchat" | "teams",
  resolver: EmojiResolver = defaultEmojiResolver,
): string {
  return text.replace(EMOJI_PLACEHOLDER_REGEX, (_, emojiName: string) => {
    switch (platform) {
      case "slack":
        return `:${resolver.toSlack(emojiName)}:`;
      case "gchat":
        return resolver.toGChat(emojiName);
      case "teams":
        // Teams uses unicode emoji
        return resolver.toGChat(emojiName);
      default:
        return resolver.toGChat(emojiName);
    }
  });
}

/** Type for emoji placeholder strings */
type EmojiPlaceholder<T extends string> = `{{emoji:${T}}}`;

/** Base emoji object with well-known emoji */
type BaseEmojiHelper = {
  [K in WellKnownEmoji]: EmojiPlaceholder<K>;
} & {
  custom: (name: string) => string;
};

/** Extended emoji object including custom emoji from module augmentation */
type ExtendedEmojiHelper = BaseEmojiHelper & {
  [K in keyof CustomEmojiMap]: EmojiPlaceholder<K & string>;
};

/**
 * Create a type-safe emoji helper with custom emoji.
 *
 * Custom emoji are automatically registered with the default resolver,
 * so placeholders will convert correctly in messages.
 *
 * @example
 * ```typescript
 * // First, extend the CustomEmojiMap type (usually in a .d.ts file)
 * declare module "chat-sdk" {
 *   interface CustomEmojiMap {
 *     unicorn: EmojiFormats;
 *     company_logo: EmojiFormats;
 *   }
 * }
 *
 * // Then create the emoji helper with your custom emoji
 * const emoji = createEmoji({
 *   unicorn: { slack: "unicorn_face", gchat: "🦄" },
 *   company_logo: { slack: "company", gchat: "🏢" },
 * });
 *
 * // Now you get type-safe access to custom emoji that auto-convert
 * await thread.post(`${emoji.unicorn} Magic!`);
 * // Slack: ":unicorn_face: Magic!"
 * // GChat: "🦄 Magic!"
 * ```
 */
export function createEmoji<
  T extends Record<
    string,
    { slack: string | string[]; gchat: string | string[] }
  >,
>(
  customEmoji?: T,
): BaseEmojiHelper & { [K in keyof T]: EmojiPlaceholder<K & string> } {
  const base: BaseEmojiHelper = {
    thumbs_up: "{{emoji:thumbs_up}}",
    thumbs_down: "{{emoji:thumbs_down}}",
    heart: "{{emoji:heart}}",
    smile: "{{emoji:smile}}",
    laugh: "{{emoji:laugh}}",
    thinking: "{{emoji:thinking}}",
    eyes: "{{emoji:eyes}}",
    fire: "{{emoji:fire}}",
    check: "{{emoji:check}}",
    x: "{{emoji:x}}",
    question: "{{emoji:question}}",
    party: "{{emoji:party}}",
    rocket: "{{emoji:rocket}}",
    star: "{{emoji:star}}",
    wave: "{{emoji:wave}}",
    clap: "{{emoji:clap}}",
    "100": "{{emoji:100}}",
    warning: "{{emoji:warning}}",
    custom: (name: string): string => `{{emoji:${name}}}`,
  };

  if (customEmoji) {
    // Add custom emoji to the helper object
    for (const key of Object.keys(customEmoji)) {
      (base as unknown as Record<string, string>)[key] = `{{emoji:${key}}}`;
    }
    // Extend the default resolver so placeholders convert correctly
    defaultEmojiResolver.extend(customEmoji as EmojiMapConfig);
  }

  return base as BaseEmojiHelper & {
    [K in keyof T]: EmojiPlaceholder<K & string>;
  };
}

/**
 * Type-safe emoji helper for embedding emoji in messages.
 *
 * @example
 * ```typescript
 * import { emoji } from "chat-sdk";
 *
 * await thread.post(`Great job! ${emoji.thumbs_up} ${emoji.fire}`);
 * // Slack: "Great job! :+1: :fire:"
 * // GChat: "Great job! 👍 🔥"
 * ```
 *
 * For custom emoji, use `createEmoji()` with module augmentation:
 * @example
 * ```typescript
 * // types.d.ts
 * declare module "chat-sdk" {
 *   interface CustomEmojiMap {
 *     unicorn: EmojiFormats;
 *   }
 * }
 *
 * // bot.ts
 * const emoji = createEmoji({ unicorn: { slack: "unicorn", gchat: "🦄" } });
 * await thread.post(`${emoji.unicorn} Magic!`);
 * ```
 */
export const emoji: ExtendedEmojiHelper = createEmoji() as ExtendedEmojiHelper;
