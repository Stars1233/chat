import { beforeEach, describe, expect, it, vi } from "vitest";
import { Chat } from "./chat";
import { parseMarkdown } from "./markdown";
import type {
  Adapter,
  FormattedContent,
  Lock,
  Message,
  StateAdapter,
} from "./types";

// Mock adapter
function createMockAdapter(name: string): Adapter {
  return {
    name,
    userName: `${name}-bot`,
    initialize: vi.fn().mockResolvedValue(undefined),
    handleWebhook: vi.fn().mockResolvedValue(new Response("ok")),
    postMessage: vi
      .fn()
      .mockResolvedValue({ id: "msg-1", threadId: "t1", raw: {} }),
    editMessage: vi
      .fn()
      .mockResolvedValue({ id: "msg-1", threadId: "t1", raw: {} }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    addReaction: vi.fn().mockResolvedValue(undefined),
    removeReaction: vi.fn().mockResolvedValue(undefined),
    startTyping: vi.fn().mockResolvedValue(undefined),
    fetchMessages: vi.fn().mockResolvedValue([]),
    fetchThread: vi
      .fn()
      .mockResolvedValue({ id: "t1", channelId: "c1", metadata: {} }),
    encodeThreadId: vi.fn(
      (data: { channel: string; thread: string }) =>
        `${name}:${data.channel}:${data.thread}`,
    ),
    decodeThreadId: vi.fn((id: string) => {
      const [, channel, thread] = id.split(":");
      return { channel, thread };
    }),
    parseMessage: vi.fn(),
    renderFormatted: vi.fn((_content: FormattedContent) => "formatted"),
  };
}

// Mock state adapter
function createMockState(): StateAdapter {
  const subscriptions = new Set<string>();
  const locks = new Map<string, Lock>();
  const cache = new Map<string, unknown>();

  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockImplementation(async (id: string) => {
      subscriptions.add(id);
    }),
    unsubscribe: vi.fn().mockImplementation(async (id: string) => {
      subscriptions.delete(id);
    }),
    isSubscribed: vi.fn().mockImplementation(async (id: string) => {
      return subscriptions.has(id);
    }),
    listSubscriptions: vi.fn().mockImplementation(async function* () {
      for (const id of subscriptions) yield id;
    }),
    acquireLock: vi
      .fn()
      .mockImplementation(async (threadId: string, ttlMs: number) => {
        if (locks.has(threadId)) return null;
        const lock: Lock = {
          threadId,
          token: "test-token",
          expiresAt: Date.now() + ttlMs,
        };
        locks.set(threadId, lock);
        return lock;
      }),
    releaseLock: vi.fn().mockImplementation(async (lock: Lock) => {
      locks.delete(lock.threadId);
    }),
    extendLock: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockImplementation(async (key: string) => {
      return cache.get(key) ?? null;
    }),
    set: vi.fn().mockImplementation(async (key: string, value: unknown) => {
      cache.set(key, value);
    }),
    delete: vi.fn().mockImplementation(async (key: string) => {
      cache.delete(key);
    }),
  };
}

// Helper to create a test message
function createTestMessage(
  text: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    id: "msg-1",
    threadId: "slack:C123:1234.5678",
    text,
    formatted: parseMarkdown(text),
    raw: {},
    author: {
      userId: "U123",
      userName: "user",
      fullName: "Test User",
      isBot: false,
      isMe: false,
    },
    metadata: { dateSent: new Date(), edited: false },
    attachments: [],
    ...overrides,
  };
}

describe("Chat", () => {
  let chat: Chat<{ slack: Adapter }>;
  let mockAdapter: Adapter;
  let mockState: StateAdapter;

  beforeEach(async () => {
    mockAdapter = createMockAdapter("slack");
    mockState = createMockState();

    chat = new Chat({
      userName: "testbot",
      adapters: { slack: mockAdapter },
      state: mockState,
    });

    // Trigger initialization by calling webhooks
    await chat.webhooks.slack(
      new Request("http://test.com", { method: "POST" }),
    );
  });

  it("should initialize adapters", async () => {
    expect(mockAdapter.initialize).toHaveBeenCalledWith(chat);
    expect(mockState.connect).toHaveBeenCalled();
  });

  it("should register webhook handlers", () => {
    expect(chat.webhooks.slack).toBeDefined();
    expect(typeof chat.webhooks.slack).toBe("function");
  });

  it("should call onNewMention handler when bot is mentioned", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    chat.onNewMention(handler);

    // Note: mockAdapter has userName "slack-bot", so we mention that
    const message = createTestMessage("Hey @slack-bot help me");

    await chat.handleIncomingMessage(
      mockAdapter,
      "slack:C123:1234.5678",
      message,
    );

    expect(handler).toHaveBeenCalled();
    expect(mockState.acquireLock).toHaveBeenCalled();
    expect(mockState.releaseLock).toHaveBeenCalled();
  });

  it("should call onSubscribedMessage handler for subscribed threads", async () => {
    const mentionHandler = vi.fn().mockResolvedValue(undefined);
    const subscribedHandler = vi.fn().mockResolvedValue(undefined);

    chat.onNewMention(mentionHandler);
    chat.onSubscribedMessage(subscribedHandler);

    // Subscribe to the thread
    await mockState.subscribe("slack:C123:1234.5678");

    const message = createTestMessage("Follow up message");

    await chat.handleIncomingMessage(
      mockAdapter,
      "slack:C123:1234.5678",
      message,
    );

    expect(subscribedHandler).toHaveBeenCalled();
    expect(mentionHandler).not.toHaveBeenCalled();
  });

  it("should skip messages from self", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    chat.onNewMention(handler);

    const message = createTestMessage("I am the bot", {
      author: {
        userId: "BOT",
        userName: "testbot",
        fullName: "Test Bot",
        isBot: true,
        isMe: true,
      },
    });

    await chat.handleIncomingMessage(
      mockAdapter,
      "slack:C123:1234.5678",
      message,
    );

    expect(handler).not.toHaveBeenCalled();
  });

  it("should match message patterns", async () => {
    const helpHandler = vi.fn().mockResolvedValue(undefined);
    chat.onNewMessage(/help/i, helpHandler);

    const message = createTestMessage("Can someone help me?");

    await chat.handleIncomingMessage(
      mockAdapter,
      "slack:C123:1234.5678",
      message,
    );

    expect(helpHandler).toHaveBeenCalled();
  });
});
