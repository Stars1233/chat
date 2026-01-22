/**
 * Tests for the Slack adapter - webhook handling, message operations, and format conversion.
 */

import { createHmac } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import type { Logger } from "chat";
import { describe, expect, it, vi } from "vitest";
import {
  createSlackAdapter,
  decodeSlackModalContext,
  encodeSlackModalContext,
  SlackAdapter,
} from "./index";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => mockLogger),
};

// ============================================================================
// Test Helpers
// ============================================================================

function createSlackSignature(
  body: string,
  secret: string,
  timestamp: number,
): string {
  const sigBasestring = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", secret).update(sigBasestring).digest("hex")}`;
}

function createWebhookRequest(
  body: string,
  secret: string,
  options?: { timestampOffset?: number; contentType?: string },
): Request {
  const timestamp =
    Math.floor(Date.now() / 1000) + (options?.timestampOffset ?? 0);
  const signature = createSlackSignature(body, secret, timestamp);

  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": signature,
      "content-type": options?.contentType ?? "application/json",
    },
    body,
  });
}

// ============================================================================
// Factory Function Tests
// ============================================================================

describe("createSlackAdapter", () => {
  it("creates a SlackAdapter instance", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-secret",
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(SlackAdapter);
    expect(adapter.name).toBe("slack");
  });

  it("sets default userName to 'bot'", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-secret",
      logger: mockLogger,
    });
    expect(adapter.userName).toBe("bot");
  });

  it("uses provided userName", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-secret",
      logger: mockLogger,
      userName: "custombot",
    });
    expect(adapter.userName).toBe("custombot");
  });

  it("stores botUserId when provided", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-secret",
      logger: mockLogger,
      botUserId: "U12345",
    });
    expect(adapter.botUserId).toBe("U12345");
  });
});

// ============================================================================
// Thread ID Encoding/Decoding Tests
// ============================================================================

describe("encodeThreadId", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("encodes channel and threadTs correctly", () => {
    const threadId = adapter.encodeThreadId({
      channel: "C12345",
      threadTs: "1234567890.123456",
    });
    expect(threadId).toBe("slack:C12345:1234567890.123456");
  });

  it("handles empty threadTs", () => {
    const threadId = adapter.encodeThreadId({
      channel: "C12345",
      threadTs: "",
    });
    expect(threadId).toBe("slack:C12345:");
  });
});

describe("decodeThreadId", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("decodes valid thread ID", () => {
    const result = adapter.decodeThreadId("slack:C12345:1234567890.123456");
    expect(result).toEqual({
      channel: "C12345",
      threadTs: "1234567890.123456",
    });
  });

  it("decodes thread ID with empty threadTs", () => {
    const result = adapter.decodeThreadId("slack:C12345:");
    expect(result).toEqual({
      channel: "C12345",
      threadTs: "",
    });
  });

  it("throws on invalid thread ID format", () => {
    expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("slack:C12345")).toThrow(
      ValidationError,
    );
    expect(() => adapter.decodeThreadId("teams:C12345:123")).toThrow(
      ValidationError,
    );
  });
});

describe("isDM", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("returns true for DM channels (D prefix)", () => {
    expect(adapter.isDM("slack:D12345:1234567890.123456")).toBe(true);
  });

  it("returns false for public channels (C prefix)", () => {
    expect(adapter.isDM("slack:C12345:1234567890.123456")).toBe(false);
  });

  it("returns false for private channels (G prefix)", () => {
    expect(adapter.isDM("slack:G12345:1234567890.123456")).toBe(false);
  });
});

// ============================================================================
// Webhook Signature Verification Tests
// ============================================================================

describe("handleWebhook - signature verification", () => {
  const secret = "test-signing-secret";
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: secret,
    logger: mockLogger,
  });

  it("rejects requests without timestamp header", async () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-slack-signature": "v0=invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "url_verification" }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("rejects requests without signature header", async () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "url_verification" }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("rejects requests with invalid signature", async () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-slack-signature": "v0=invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "url_verification" }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("rejects requests with old timestamp (>5 min)", async () => {
    const body = JSON.stringify({ type: "url_verification" });
    const request = createWebhookRequest(body, secret, {
      timestampOffset: -400, // 400 seconds old
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("accepts requests with valid signature", async () => {
    const body = JSON.stringify({
      type: "url_verification",
      challenge: "test-challenge",
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// URL Verification Challenge Tests
// ============================================================================

describe("handleWebhook - URL verification", () => {
  const secret = "test-signing-secret";
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: secret,
    logger: mockLogger,
  });

  it("responds to url_verification challenge", async () => {
    const body = JSON.stringify({
      type: "url_verification",
      challenge: "test-challenge-123",
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const responseBody = await response.json();
    expect(responseBody).toEqual({ challenge: "test-challenge-123" });
  });
});

// ============================================================================
// Event Callback Tests
// ============================================================================

describe("handleWebhook - event_callback", () => {
  const secret = "test-signing-secret";
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: secret,
    logger: mockLogger,
  });

  it("handles message events", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        user: "U123",
        channel: "C456",
        text: "Hello world",
        ts: "1234567890.123456",
      },
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("handles app_mention events", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "app_mention",
        user: "U123",
        channel: "C456",
        text: "<@U_BOT> hello",
        ts: "1234567890.123456",
      },
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("handles reaction_added events", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "reaction_added",
        user: "U123",
        reaction: "thumbsup",
        item: {
          type: "message",
          channel: "C456",
          ts: "1234567890.123456",
        },
      },
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("handles reaction_removed events", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "reaction_removed",
        user: "U123",
        reaction: "thumbsup",
        item: {
          type: "message",
          channel: "C456",
          ts: "1234567890.123456",
        },
      },
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// Interactive Payload Tests (Block Actions)
// ============================================================================

describe("handleWebhook - interactive payloads", () => {
  const secret = "test-signing-secret";
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: secret,
    logger: mockLogger,
  });

  it("handles block_actions payload", async () => {
    const payload = JSON.stringify({
      type: "block_actions",
      user: {
        id: "U123",
        username: "testuser",
        name: "Test User",
      },
      container: {
        type: "message",
        message_ts: "1234567890.123456",
        channel_id: "C456",
      },
      channel: {
        id: "C456",
        name: "general",
      },
      message: {
        ts: "1234567890.123456",
        thread_ts: "1234567890.000000",
      },
      actions: [
        {
          type: "button",
          action_id: "approve_btn",
          value: "approved",
        },
      ],
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("returns 400 for missing payload", async () => {
    const body = "foo=bar";
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid payload JSON", async () => {
    const body = "payload=invalid-json";
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("handles view_submission payload", async () => {
    const payload = JSON.stringify({
      type: "view_submission",
      trigger_id: "trigger123",
      user: {
        id: "U123",
        username: "testuser",
        name: "Test User",
      },
      view: {
        id: "V123",
        callback_id: "feedback_form",
        private_metadata: "thread-context",
        state: {
          values: {
            message_block: {
              message_input: { value: "Great feedback!" },
            },
            category_block: {
              category_select: { selected_option: { value: "feature" } },
            },
          },
        },
      },
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("handles view_closed payload", async () => {
    const payload = JSON.stringify({
      type: "view_closed",
      user: {
        id: "U123",
        username: "testuser",
        name: "Test User",
      },
      view: {
        id: "V123",
        callback_id: "feedback_form",
        private_metadata: "thread-context",
      },
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("includes trigger_id in block_actions event", async () => {
    const payload = JSON.stringify({
      type: "block_actions",
      trigger_id: "trigger456",
      user: {
        id: "U123",
        username: "testuser",
        name: "Test User",
      },
      container: {
        type: "message",
        message_ts: "1234567890.123456",
        channel_id: "C456",
      },
      channel: {
        id: "C456",
        name: "general",
      },
      message: {
        ts: "1234567890.123456",
      },
      actions: [
        {
          type: "button",
          action_id: "open_modal",
          value: "modal-data",
        },
      ],
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// JSON Parsing Tests
// ============================================================================

describe("handleWebhook - JSON parsing", () => {
  const secret = "test-signing-secret";
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: secret,
    logger: mockLogger,
  });

  it("returns 400 for invalid JSON", async () => {
    const body = "not valid json";
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });
});

// ============================================================================
// parseMessage Tests
// ============================================================================

describe("parseMessage", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
    botUserId: "U_BOT",
  });

  it("parses a basic message event", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Hello world",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);

    expect(message.id).toBe("1234567890.123456");
    expect(message.text).toBe("Hello world");
    expect(message.author.userId).toBe("U123");
    expect(message.author.isBot).toBe(false);
    expect(message.author.isMe).toBe(false);
  });

  it("parses a bot message", () => {
    const event = {
      type: "message",
      bot_id: "B123",
      channel: "C456",
      text: "Bot message",
      ts: "1234567890.123456",
      subtype: "bot_message",
    };

    const message = adapter.parseMessage(event);

    expect(message.author.userId).toBe("B123");
    expect(message.author.isBot).toBe(true);
  });

  it("detects messages from self", () => {
    const event = {
      type: "message",
      user: "U_BOT",
      channel: "C456",
      text: "Self message",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.author.isMe).toBe(true);
  });

  it("parses message with thread_ts", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Thread reply",
      ts: "1234567891.123456",
      thread_ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.threadId).toBe("slack:C456:1234567890.123456");
  });

  it("parses edited message", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Edited message",
      ts: "1234567890.123456",
      edited: { ts: "1234567891.000000" },
    };

    const message = adapter.parseMessage(event);
    expect(message.metadata?.edited).toBe(true);
    expect(message.metadata?.editedAt).toBeDefined();
  });

  it("parses message with files", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Message with file",
      ts: "1234567890.123456",
      files: [
        {
          id: "F123",
          mimetype: "image/png",
          url_private: "https://files.slack.com/file.png",
          name: "image.png",
          size: 12345,
          original_w: 800,
          original_h: 600,
        },
      ],
    };

    const message = adapter.parseMessage(event);
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments?.[0].type).toBe("image");
    expect(message.attachments?.[0].name).toBe("image.png");
    expect(message.attachments?.[0].mimeType).toBe("image/png");
    expect(message.attachments?.[0].width).toBe(800);
    expect(message.attachments?.[0].height).toBe(600);
  });

  it("handles different file types", () => {
    const createEvent = (mimetype: string) => ({
      type: "message",
      user: "U123",
      channel: "C456",
      text: "",
      ts: "1234567890.123456",
      files: [{ id: "F123", mimetype, url_private: "https://example.com" }],
    });

    const imageMsg = adapter.parseMessage(createEvent("image/jpeg"));
    expect(imageMsg.attachments?.[0].type).toBe("image");

    const videoMsg = adapter.parseMessage(createEvent("video/mp4"));
    expect(videoMsg.attachments?.[0].type).toBe("video");

    const audioMsg = adapter.parseMessage(createEvent("audio/mpeg"));
    expect(audioMsg.attachments?.[0].type).toBe("audio");

    const fileMsg = adapter.parseMessage(createEvent("application/pdf"));
    expect(fileMsg.attachments?.[0].type).toBe("file");
  });
});

// ============================================================================
// renderFormatted Tests
// ============================================================================

describe("renderFormatted", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("renders AST to Slack mrkdwn format", () => {
    const ast = {
      type: "root" as const,
      children: [
        {
          type: "paragraph" as const,
          children: [
            {
              type: "strong" as const,
              children: [{ type: "text" as const, value: "bold" }],
            },
          ],
        },
      ],
    };

    const result = adapter.renderFormatted(ast);
    expect(result).toBe("*bold*");
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("edge cases", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("handles missing text in event", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.text).toBe("");
  });

  it("handles missing user in event", () => {
    const event = {
      type: "message",
      channel: "C456",
      text: "Anonymous message",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.author.userId).toBe("unknown");
  });

  it("handles missing ts in event", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "No timestamp",
    };

    const message = adapter.parseMessage(event);
    expect(message.id).toBe("");
  });

  it("parses username from event when available", () => {
    const event = {
      type: "message",
      user: "U123",
      username: "testuser",
      channel: "C456",
      text: "Hello",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.author.userName).toBe("testuser");
  });
});

// ============================================================================
// Date Parsing Tests
// ============================================================================

describe("date parsing", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("parses Slack timestamp to Date", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Hello",
      ts: "1609459200.000000", // 2021-01-01 00:00:00 UTC
    };

    const message = adapter.parseMessage(event);
    expect(message.metadata?.dateSent).toEqual(new Date(1609459200000));
  });

  it("handles edited timestamp", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Hello",
      ts: "1609459200.000000",
      edited: { ts: "1609459260.000000" }, // 1 minute later
    };

    const message = adapter.parseMessage(event);
    expect(message.metadata?.editedAt).toEqual(new Date(1609459260000));
  });
});

// ============================================================================
// Formatted Text Extraction Tests
// ============================================================================

describe("formatted text extraction", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("extracts plain text from mrkdwn", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "*bold* and _italic_",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.text).toBe("bold and italic");
  });

  it("extracts text from links", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Check <https://example.com|this link>",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.text).toContain("this link");
  });

  it("extracts text from user mentions", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Hey <@U456|john>!",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.text).toContain("@john");
  });
});

// ============================================================================
// Modal Context Encoding/Decoding Tests
// ============================================================================

describe("encodeSlackModalContext", () => {
  it("encodes threadId only", () => {
    const encoded = encodeSlackModalContext("slack:C123:1234567890.123456");
    const parsed = JSON.parse(encoded);

    expect(parsed._type).toBe("chat:SlackModalContext");
    expect(parsed.v).toBe(1);
    expect(parsed.t).toBe("slack:C123:1234567890.123456");
    expect(parsed.m).toBeUndefined();
    expect(parsed.u).toBeUndefined();
  });

  it("encodes threadId and messageId", () => {
    const encoded = encodeSlackModalContext(
      "slack:C123:1234567890.123456",
      "1234567890.999999",
    );
    const parsed = JSON.parse(encoded);

    expect(parsed.t).toBe("slack:C123:1234567890.123456");
    expect(parsed.m).toBe("1234567890.999999");
    expect(parsed.u).toBeUndefined();
  });

  it("encodes threadId, messageId, and user metadata", () => {
    const encoded = encodeSlackModalContext(
      "slack:C123:1234567890.123456",
      "1234567890.999999",
      "user-custom-data",
    );
    const parsed = JSON.parse(encoded);

    expect(parsed.t).toBe("slack:C123:1234567890.123456");
    expect(parsed.m).toBe("1234567890.999999");
    expect(parsed.u).toBe("user-custom-data");
  });

  it("truncates user metadata when too large", () => {
    const largeMetadata = "x".repeat(5000); // Exceeds 3000 char limit
    const warnMock = vi.fn();
    const logger = { ...mockLogger, warn: warnMock };

    const encoded = encodeSlackModalContext(
      "slack:C123:1234567890.123456",
      "1234567890.999999",
      largeMetadata,
      logger,
    );
    const parsed = JSON.parse(encoded);

    expect(parsed.u.length).toBeLessThan(5000);
    expect(encoded.length).toBeLessThanOrEqual(3000);
    expect(warnMock).toHaveBeenCalledWith(
      "Modal privateMetadata truncated to fit Slack's 3000 char limit",
      expect.objectContaining({
        originalSize: 5000,
        limit: 3000,
      }),
    );
  });

  it("does not truncate user metadata when it fits", () => {
    const smallMetadata = "small-data";
    const warnMock = vi.fn();
    const logger = { ...mockLogger, warn: warnMock };

    const encoded = encodeSlackModalContext(
      "slack:C123:1234567890.123456",
      undefined,
      smallMetadata,
      logger,
    );
    const parsed = JSON.parse(encoded);

    expect(parsed.u).toBe(smallMetadata);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("handles undefined messageId with user metadata", () => {
    const encoded = encodeSlackModalContext(
      "slack:C123:1234567890.123456",
      undefined,
      "user-data",
    );
    const parsed = JSON.parse(encoded);

    expect(parsed.t).toBe("slack:C123:1234567890.123456");
    expect(parsed.m).toBeUndefined();
    expect(parsed.u).toBe("user-data");
  });
});

describe("decodeSlackModalContext", () => {
  it("decodes valid context with all fields", () => {
    const encoded = JSON.stringify({
      _type: "chat:SlackModalContext",
      v: 1,
      t: "slack:C123:1234567890.123456",
      m: "1234567890.999999",
      u: "user-data",
    });

    const result = decodeSlackModalContext(encoded);

    expect(result).toEqual({
      threadId: "slack:C123:1234567890.123456",
      messageId: "1234567890.999999",
      privateMetadata: "user-data",
    });
  });

  it("decodes valid context with only threadId", () => {
    const encoded = JSON.stringify({
      _type: "chat:SlackModalContext",
      v: 1,
      t: "slack:C123:1234567890.123456",
    });

    const result = decodeSlackModalContext(encoded);

    expect(result).toEqual({
      threadId: "slack:C123:1234567890.123456",
      messageId: undefined,
      privateMetadata: undefined,
    });
  });

  it("returns null for undefined metadata", () => {
    const result = decodeSlackModalContext(undefined);
    expect(result).toBeNull();
  });

  it("returns null for empty string metadata", () => {
    const result = decodeSlackModalContext("");
    expect(result).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const result = decodeSlackModalContext("not-valid-json");
    expect(result).toBeNull();
  });

  it("returns null for JSON without type marker", () => {
    const result = decodeSlackModalContext(
      JSON.stringify({ t: "thread-id", m: "msg-id" }),
    );
    expect(result).toBeNull();
  });

  it("returns null for wrong type marker", () => {
    const result = decodeSlackModalContext(
      JSON.stringify({ _type: "other:type", v: 1, t: "thread-id" }),
    );
    expect(result).toBeNull();
  });

  it("returns null for wrong version", () => {
    const result = decodeSlackModalContext(
      JSON.stringify({ _type: "chat:SlackModalContext", v: 2, t: "thread-id" }),
    );
    expect(result).toBeNull();
  });

  it("returns null for missing threadId", () => {
    const result = decodeSlackModalContext(
      JSON.stringify({ _type: "chat:SlackModalContext", v: 1 }),
    );
    expect(result).toBeNull();
  });

  it("returns null for non-string threadId", () => {
    const result = decodeSlackModalContext(
      JSON.stringify({ _type: "chat:SlackModalContext", v: 1, t: 123 }),
    );
    expect(result).toBeNull();
  });

  it("returns null for raw user metadata (backwards compat)", () => {
    const result = decodeSlackModalContext("my-custom-session-id");
    expect(result).toBeNull();
  });

  it("round-trips with encodeSlackModalContext", () => {
    const threadId = "slack:C123:1234567890.123456";
    const messageId = "1234567890.999999";
    const userMetadata = '{"key": "value"}';

    const encoded = encodeSlackModalContext(threadId, messageId, userMetadata);
    const decoded = decodeSlackModalContext(encoded);

    expect(decoded).toEqual({
      threadId,
      messageId,
      privateMetadata: userMetadata,
    });
  });

  it("handles JSON as user metadata", () => {
    const threadId = "slack:C123:1234567890.123456";
    const userMetadata = JSON.stringify({ sessionId: "abc", step: 3 });

    const encoded = encodeSlackModalContext(threadId, undefined, userMetadata);
    const decoded = decodeSlackModalContext(encoded);

    expect(decoded?.privateMetadata).toBe(userMetadata);
    expect(JSON.parse(decoded?.privateMetadata ?? "")).toEqual({
      sessionId: "abc",
      step: 3,
    });
  });
});
