import { describe, expect, it } from "vitest";
import {
  convertEmojiPlaceholders,
  createEmoji,
  DEFAULT_EMOJI_MAP,
  defaultEmojiResolver,
  EmojiResolver,
  emoji,
} from "./emoji";

describe("EmojiResolver", () => {
  describe("fromSlack", () => {
    it("should convert Slack emoji to normalized format", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromSlack("+1")).toBe("thumbs_up");
      expect(resolver.fromSlack("thumbsup")).toBe("thumbs_up");
      expect(resolver.fromSlack("-1")).toBe("thumbs_down");
      expect(resolver.fromSlack("heart")).toBe("heart");
      expect(resolver.fromSlack("fire")).toBe("fire");
    });

    it("should handle colons around emoji names", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromSlack(":+1:")).toBe("thumbs_up");
      expect(resolver.fromSlack(":fire:")).toBe("fire");
    });

    it("should be case-insensitive", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromSlack("FIRE")).toBe("fire");
      expect(resolver.fromSlack("Heart")).toBe("heart");
    });

    it("should return raw emoji if no mapping exists", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromSlack("custom_emoji")).toBe("custom_emoji");
    });
  });

  describe("fromGChat", () => {
    it("should convert GChat unicode emoji to normalized format", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromGChat("👍")).toBe("thumbs_up");
      expect(resolver.fromGChat("👎")).toBe("thumbs_down");
      expect(resolver.fromGChat("❤️")).toBe("heart");
      expect(resolver.fromGChat("🔥")).toBe("fire");
      expect(resolver.fromGChat("🚀")).toBe("rocket");
    });

    it("should handle multiple unicode variants", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromGChat("❤")).toBe("heart");
      expect(resolver.fromGChat("❤️")).toBe("heart");
      expect(resolver.fromGChat("✅")).toBe("check");
      expect(resolver.fromGChat("✔️")).toBe("check");
    });

    it("should return raw emoji if no mapping exists", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromGChat("🦄")).toBe("🦄");
    });
  });

  describe("toSlack", () => {
    it("should convert normalized emoji to Slack format", () => {
      const resolver = new EmojiResolver();
      expect(resolver.toSlack("thumbs_up")).toBe("+1");
      expect(resolver.toSlack("fire")).toBe("fire");
      expect(resolver.toSlack("heart")).toBe("heart");
    });

    it("should return raw emoji if no mapping exists", () => {
      const resolver = new EmojiResolver();
      expect(resolver.toSlack("custom")).toBe("custom");
    });
  });

  describe("toGChat", () => {
    it("should convert normalized emoji to GChat format", () => {
      const resolver = new EmojiResolver();
      expect(resolver.toGChat("thumbs_up")).toBe("👍");
      expect(resolver.toGChat("fire")).toBe("🔥");
      expect(resolver.toGChat("rocket")).toBe("🚀");
    });

    it("should return raw emoji if no mapping exists", () => {
      const resolver = new EmojiResolver();
      expect(resolver.toGChat("custom")).toBe("custom");
    });
  });

  describe("matches", () => {
    it("should match Slack format to normalized emoji", () => {
      const resolver = new EmojiResolver();
      expect(resolver.matches("+1", "thumbs_up")).toBe(true);
      expect(resolver.matches("thumbsup", "thumbs_up")).toBe(true);
      expect(resolver.matches(":+1:", "thumbs_up")).toBe(true);
      expect(resolver.matches("fire", "fire")).toBe(true);
    });

    it("should match GChat format to normalized emoji", () => {
      const resolver = new EmojiResolver();
      expect(resolver.matches("👍", "thumbs_up")).toBe(true);
      expect(resolver.matches("🔥", "fire")).toBe(true);
      expect(resolver.matches("❤️", "heart")).toBe(true);
    });

    it("should not match different emoji", () => {
      const resolver = new EmojiResolver();
      expect(resolver.matches("+1", "thumbs_down")).toBe(false);
      expect(resolver.matches("👍", "fire")).toBe(false);
    });

    it("should match unmapped emoji by equality", () => {
      const resolver = new EmojiResolver();
      expect(resolver.matches("custom", "custom")).toBe(true);
      expect(resolver.matches("custom", "other")).toBe(false);
    });
  });

  describe("extend", () => {
    it("should add new emoji mappings", () => {
      const resolver = new EmojiResolver();
      resolver.extend({
        unicorn: { slack: "unicorn_face", gchat: "🦄" },
      });

      expect(resolver.fromSlack("unicorn_face")).toBe("unicorn");
      expect(resolver.fromGChat("🦄")).toBe("unicorn");
      expect(resolver.toSlack("unicorn")).toBe("unicorn_face");
      expect(resolver.toGChat("unicorn")).toBe("🦄");
    });

    it("should override existing mappings", () => {
      const resolver = new EmojiResolver();
      resolver.extend({
        fire: { slack: "flames", gchat: "🔥" },
      });

      expect(resolver.fromSlack("flames")).toBe("fire");
      expect(resolver.toSlack("fire")).toBe("flames");
    });
  });

  describe("defaultEmojiResolver", () => {
    it("should be a pre-configured resolver instance", () => {
      expect(defaultEmojiResolver).toBeInstanceOf(EmojiResolver);
      expect(defaultEmojiResolver.fromSlack("+1")).toBe("thumbs_up");
    });
  });

  describe("DEFAULT_EMOJI_MAP", () => {
    it("should contain all well-known emoji", () => {
      const expectedEmoji = [
        "thumbs_up",
        "thumbs_down",
        "heart",
        "smile",
        "laugh",
        "thinking",
        "eyes",
        "fire",
        "check",
        "x",
        "question",
        "party",
        "rocket",
        "star",
        "wave",
        "clap",
        "100",
        "warning",
      ];

      for (const e of expectedEmoji) {
        expect(DEFAULT_EMOJI_MAP[e]).toBeDefined();
        expect(DEFAULT_EMOJI_MAP[e].slack).toBeDefined();
        expect(DEFAULT_EMOJI_MAP[e].gchat).toBeDefined();
      }
    });
  });
});

describe("emoji helper", () => {
  it("should provide placeholders for well-known emoji", () => {
    expect(emoji.thumbs_up).toBe("{{emoji:thumbs_up}}");
    expect(emoji.fire).toBe("{{emoji:fire}}");
    expect(emoji.rocket).toBe("{{emoji:rocket}}");
    expect(emoji["100"]).toBe("{{emoji:100}}");
  });

  it("should have a custom() method for custom emoji", () => {
    expect(emoji.custom("unicorn")).toBe("{{emoji:unicorn}}");
    expect(emoji.custom("custom_team_emoji")).toBe(
      "{{emoji:custom_team_emoji}}",
    );
  });
});

describe("convertEmojiPlaceholders", () => {
  it("should convert placeholders to Slack format", () => {
    const text = `Thanks! ${emoji.thumbs_up} Great work! ${emoji.fire}`;
    const result = convertEmojiPlaceholders(text, "slack");
    expect(result).toBe("Thanks! :+1: Great work! :fire:");
  });

  it("should convert placeholders to GChat format", () => {
    const text = `Thanks! ${emoji.thumbs_up} Great work! ${emoji.fire}`;
    const result = convertEmojiPlaceholders(text, "gchat");
    expect(result).toBe("Thanks! 👍 Great work! 🔥");
  });

  it("should convert placeholders to Teams format (unicode)", () => {
    const text = `Thanks! ${emoji.thumbs_up} Great work! ${emoji.fire}`;
    const result = convertEmojiPlaceholders(text, "teams");
    expect(result).toBe("Thanks! 👍 Great work! 🔥");
  });

  it("should handle unknown emoji by passing through", () => {
    const text = "Check this {{emoji:unknown_emoji}}!";
    const result = convertEmojiPlaceholders(text, "slack");
    expect(result).toBe("Check this :unknown_emoji:!");
  });

  it("should handle multiple emoji in a message", () => {
    const text = `${emoji.wave} Hello! ${emoji.smile} How are you? ${emoji.thumbs_up}`;
    const result = convertEmojiPlaceholders(text, "gchat");
    expect(result).toBe("👋 Hello! 😊 How are you? 👍");
  });

  it("should handle text with no emoji", () => {
    const text = "Just a regular message";
    const result = convertEmojiPlaceholders(text, "slack");
    expect(result).toBe("Just a regular message");
  });
});

describe("createEmoji", () => {
  it("should create emoji helper with well-known emoji", () => {
    const e = createEmoji();
    expect(e.thumbs_up).toBe("{{emoji:thumbs_up}}");
    expect(e.fire).toBe("{{emoji:fire}}");
    expect(e.rocket).toBe("{{emoji:rocket}}");
  });

  it("should include custom() method", () => {
    const e = createEmoji();
    expect(e.custom("unicorn")).toBe("{{emoji:unicorn}}");
  });

  it("should add custom emoji to the helper", () => {
    const e = createEmoji({
      unicorn: { slack: "unicorn_face", gchat: "🦄" },
      company_logo: { slack: "company", gchat: "🏢" },
    });

    // Custom emoji are accessible
    expect(e.unicorn).toBe("{{emoji:unicorn}}");
    expect(e.company_logo).toBe("{{emoji:company_logo}}");

    // Well-known emoji still work
    expect(e.thumbs_up).toBe("{{emoji:thumbs_up}}");
  });

  it("should automatically register custom emoji with default resolver", () => {
    const e = createEmoji({
      unicorn: { slack: "unicorn_face", gchat: "🦄" },
    });

    const text = `${e.unicorn} Magic!`;
    // No need to manually extend resolver - createEmoji does it automatically
    expect(convertEmojiPlaceholders(text, "slack")).toBe(
      ":unicorn_face: Magic!",
    );
    expect(convertEmojiPlaceholders(text, "gchat")).toBe("🦄 Magic!");
  });
});
