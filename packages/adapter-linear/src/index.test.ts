import { describe, expect, it } from "vitest";
import { LinearAdapter } from "./index";

/**
 * Create a minimal LinearAdapter for testing thread ID methods.
 * We pass a dummy apiKey - it won't be used for encoding/decoding.
 */
function createTestAdapter(): LinearAdapter {
  return new LinearAdapter({
    apiKey: "test-api-key",
    webhookSecret: "test-secret",
    userName: "test-bot",
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  });
}

describe("encodeThreadId", () => {
  it("should encode a simple issue ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      issueId: "abc123-def456-789",
    });
    expect(result).toBe("linear:abc123-def456-789");
  });

  it("should encode a UUID issue ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
    });
    expect(result).toBe("linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9");
  });
});

describe("decodeThreadId", () => {
  it("should decode a valid thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId("linear:abc123-def456-789");
    expect(result).toEqual({ issueId: "abc123-def456-789" });
  });

  it("should decode a UUID thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId(
      "linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
    );
    expect(result).toEqual({
      issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
    });
  });

  it("should throw on invalid prefix", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("slack:C123:ts123")).toThrow(
      "Invalid Linear thread ID",
    );
  });

  it("should throw on empty issue ID", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("linear:")).toThrow(
      "Invalid Linear thread ID format",
    );
  });

  it("should throw on completely wrong format", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("nonsense")).toThrow(
      "Invalid Linear thread ID",
    );
  });
});

describe("encodeThreadId / decodeThreadId roundtrip", () => {
  it("should round-trip correctly", () => {
    const adapter = createTestAdapter();
    const original = { issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9" };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });
});

describe("renderFormatted", () => {
  it("should render markdown from AST", () => {
    const adapter = createTestAdapter();
    // Create a simple AST manually
    const ast = {
      type: "root" as const,
      children: [
        {
          type: "paragraph" as const,
          children: [{ type: "text" as const, value: "Hello world" }],
        },
      ],
    };
    const result = adapter.renderFormatted(ast);
    expect(result).toContain("Hello world");
  });
});

describe("parseMessage", () => {
  it("should parse a raw Linear message", () => {
    const adapter = createTestAdapter();
    const raw = {
      comment: {
        id: "comment-abc123",
        body: "Hello from Linear!",
        issueId: "issue-123",
        userId: "user-456",
        createdAt: "2025-01-29T12:00:00.000Z",
        updatedAt: "2025-01-29T12:00:00.000Z",
      },
    };
    const message = adapter.parseMessage(raw);
    expect(message.id).toBe("comment-abc123");
    expect(message.text).toBe("Hello from Linear!");
    expect(message.author.userId).toBe("user-456");
  });

  it("should detect edited messages", () => {
    const adapter = createTestAdapter();
    const raw = {
      comment: {
        id: "comment-abc123",
        body: "Edited message",
        issueId: "issue-123",
        userId: "user-456",
        createdAt: "2025-01-29T12:00:00.000Z",
        updatedAt: "2025-01-29T13:00:00.000Z",
      },
    };
    const message = adapter.parseMessage(raw);
    expect(message.metadata.edited).toBe(true);
  });
});
