/**
 * Tests for the Slack adapter - webhook handling, message operations, and format conversion.
 */

import { createHmac } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vitest";
import { createSlackAdapter, SlackAdapter } from "./index";

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
    });
    expect(adapter).toBeInstanceOf(SlackAdapter);
    expect(adapter.name).toBe("slack");
  });

  it("sets default userName to 'bot'", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-secret",
    });
    expect(adapter.userName).toBe("bot");
  });

  it("uses provided userName", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-secret",
      userName: "custombot",
    });
    expect(adapter.userName).toBe("custombot");
  });

  it("stores botUserId when provided", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-secret",
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
});

// ============================================================================
// JSON Parsing Tests
// ============================================================================

describe("handleWebhook - JSON parsing", () => {
  const secret = "test-signing-secret";
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: secret,
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
