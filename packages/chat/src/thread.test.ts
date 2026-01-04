import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseMarkdown } from "./markdown";
import { ThreadImpl } from "./thread";
import type {
  Adapter,
  FormattedContent,
  Lock,
  Message,
  StateAdapter,
} from "./types";

// Helper to create test messages
function createTestMessage(id: string, text: string): Message {
  return {
    id,
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
  };
}

// Mock adapter
function createMockAdapter(name = "slack"): Adapter {
  return {
    name,
    userName: `${name}-bot`,
    initialize: vi.fn().mockResolvedValue(undefined),
    handleWebhook: vi.fn().mockResolvedValue(new Response("ok")),
    postMessage: vi
      .fn()
      .mockResolvedValue({ id: "msg-1", threadId: undefined, raw: {} }),
    editMessage: vi
      .fn()
      .mockResolvedValue({ id: "msg-1", threadId: undefined, raw: {} }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    addReaction: vi.fn().mockResolvedValue(undefined),
    removeReaction: vi.fn().mockResolvedValue(undefined),
    startTyping: vi.fn().mockResolvedValue(undefined),
    fetchMessages: vi
      .fn()
      .mockResolvedValue({ messages: [], nextCursor: undefined }),
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
    openDM: vi
      .fn()
      .mockImplementation((userId: string) =>
        Promise.resolve(`${name}:D${userId}:`),
      ),
    isDM: vi
      .fn()
      .mockImplementation((threadId: string) => threadId.includes(":D")),
  };
}

// Mock state adapter with working cache
function createMockState(): StateAdapter & { cache: Map<string, unknown> } {
  const subscriptions = new Set<string>();
  const locks = new Map<string, Lock>();
  const cache = new Map<string, unknown>();

  return {
    cache,
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

describe("ThreadImpl", () => {
  describe("Per-thread state", () => {
    let thread: ThreadImpl<{ aiMode?: boolean; counter?: number }>;
    let mockAdapter: Adapter;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      mockAdapter = createMockAdapter();
      mockState = createMockState();

      thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });
    });

    it("should return null when no state has been set", async () => {
      const state = await thread.state;
      expect(state).toBeNull();
    });

    it("should return stored state", async () => {
      // Pre-populate state in cache
      mockState.cache.set("thread-state:slack:C123:1234.5678", {
        aiMode: true,
      });

      const state = await thread.state;
      expect(state).toEqual({ aiMode: true });
    });

    it("should set state and retrieve it", async () => {
      await thread.setState({ aiMode: true });

      const state = await thread.state;
      expect(state).toEqual({ aiMode: true });
    });

    it("should merge state by default", async () => {
      // Set initial state
      await thread.setState({ aiMode: true });

      // Set additional state - should merge
      await thread.setState({ counter: 5 });

      const state = await thread.state;
      expect(state).toEqual({ aiMode: true, counter: 5 });
    });

    it("should overwrite existing keys when merging", async () => {
      await thread.setState({ aiMode: true, counter: 1 });
      await thread.setState({ counter: 10 });

      const state = await thread.state;
      expect(state).toEqual({ aiMode: true, counter: 10 });
    });

    it("should replace entire state when replace option is true", async () => {
      await thread.setState({ aiMode: true, counter: 5 });
      await thread.setState({ counter: 10 }, { replace: true });

      const state = await thread.state;
      expect(state).toEqual({ counter: 10 });
      expect((state as { aiMode?: boolean }).aiMode).toBeUndefined();
    });

    it("should use correct key prefix for state storage", async () => {
      await thread.setState({ aiMode: true });

      expect(mockState.set).toHaveBeenCalledWith(
        "thread-state:slack:C123:1234.5678",
        { aiMode: true },
        expect.any(Number), // TTL
      );
    });

    it("should call get with correct key", async () => {
      await thread.state;

      expect(mockState.get).toHaveBeenCalledWith(
        "thread-state:slack:C123:1234.5678",
      );
    });
  });

  describe("Streaming", () => {
    let thread: ThreadImpl;
    let mockAdapter: Adapter;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      mockAdapter = createMockAdapter();
      mockState = createMockState();

      thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });
    });

    // Helper to create an async iterable from an array of chunks
    async function* createTextStream(
      chunks: string[],
      delayMs = 0,
    ): AsyncIterable<string> {
      for (const chunk of chunks) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        yield chunk;
      }
    }

    it("should use adapter native streaming when available", async () => {
      const mockStream = vi.fn().mockResolvedValue({
        id: "msg-stream",
        threadId: "t1",
        raw: "Hello World",
      });
      mockAdapter.stream = mockStream;

      const textStream = createTextStream(["Hello", " ", "World"]);
      await thread.post(textStream);

      expect(mockStream).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.any(Object), // The async iterable
        expect.any(Object), // Stream options
      );
      // Should NOT call postMessage for fallback
      expect(mockAdapter.postMessage).not.toHaveBeenCalled();
    });

    it("should fall back to post+edit when adapter has no native streaming", async () => {
      // Ensure no stream method
      delete mockAdapter.stream;

      const textStream = createTextStream(["Hello", " ", "World"]);
      await thread.post(textStream);

      // Should post initial placeholder
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "...",
      );
      // Should edit with final content
      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        "Hello World",
      );
    });

    it("should accumulate text chunks during streaming", async () => {
      delete mockAdapter.stream;

      const textStream = createTextStream([
        "This ",
        "is ",
        "a ",
        "test ",
        "message.",
      ]);
      const result = await thread.post(textStream);

      // Final edit should have all accumulated text
      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        "This is a test message.",
      );
      expect(result.text).toBe("This is a test message.");
    });

    it("should throttle edits to avoid rate limits", async () => {
      vi.useFakeTimers();
      delete mockAdapter.stream;

      // Create a stream that yields chunks over time
      const chunks = ["A", "B", "C", "D", "E"];
      let chunkIndex = 0;
      const textStream: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (chunkIndex < chunks.length) {
                const value = chunks[chunkIndex++];
                return { value, done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      };

      const postPromise = thread.post(textStream);

      // Initially should just post
      await vi.advanceTimersByTimeAsync(0);
      expect(mockAdapter.postMessage).toHaveBeenCalledTimes(1);

      // Advance time and let stream complete
      await vi.advanceTimersByTimeAsync(2000);
      await postPromise;

      // Should have final edit
      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        "ABCDE",
      );

      vi.useRealTimers();
    });

    it("should return SentMessage with edit and delete capabilities", async () => {
      delete mockAdapter.stream;

      const textStream = createTextStream(["Hello"]);
      const result = await thread.post(textStream);

      expect(result.id).toBe("msg-1");
      expect(typeof result.edit).toBe("function");
      expect(typeof result.delete).toBe("function");
      expect(typeof result.addReaction).toBe("function");
      expect(typeof result.removeReaction).toBe("function");
    });

    it("should handle empty stream", async () => {
      delete mockAdapter.stream;

      const textStream = createTextStream([]);
      await thread.post(textStream);

      // Should post initial placeholder
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "...",
      );
      // Should edit with empty string (final content)
      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        "",
      );
    });

    it("should pass stream options from current message context", async () => {
      const mockStream = vi.fn().mockResolvedValue({
        id: "msg-stream",
        threadId: "t1",
        raw: "Hello",
      });
      mockAdapter.stream = mockStream;

      // Create thread with current message context
      const threadWithContext = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        currentMessage: {
          id: "original-msg",
          threadId: "slack:C123:1234.5678",
          text: "test",
          formatted: { type: "root", children: [] },
          raw: { team_id: "T123" },
          author: {
            userId: "U456",
            userName: "user",
            fullName: "Test User",
            isBot: false,
            isMe: false,
          },
          metadata: { dateSent: new Date(), edited: false },
          attachments: [],
        },
      });

      const textStream = createTextStream(["Hello"]);
      await threadWithContext.post(textStream);

      expect(mockStream).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.any(Object),
        expect.objectContaining({
          recipientUserId: "U456",
          recipientTeamId: "T123",
        }),
      );
    });
  });

  describe("allMessages iterator", () => {
    let thread: ThreadImpl;
    let mockAdapter: Adapter;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      mockAdapter = createMockAdapter();
      mockState = createMockState();

      thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });
    });

    it("should iterate through all messages in chronological order", async () => {
      const messages = [
        createTestMessage("msg-1", "First message"),
        createTestMessage("msg-2", "Second message"),
        createTestMessage("msg-3", "Third message"),
      ];

      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages,
          nextCursor: undefined,
        },
      );

      const collected: Message[] = [];
      for await (const msg of thread.allMessages) {
        collected.push(msg);
      }

      expect(collected).toHaveLength(3);
      expect(collected[0].text).toBe("First message");
      expect(collected[1].text).toBe("Second message");
      expect(collected[2].text).toBe("Third message");
    });

    it("should use forward direction for pagination", async () => {
      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: [],
          nextCursor: undefined,
        },
      );

      // Consume the iterator
      for await (const _msg of thread.allMessages) {
        // No messages
      }

      expect(mockAdapter.fetchMessages).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.objectContaining({
          direction: "forward",
          limit: 100,
        }),
      );
    });

    it("should handle pagination across multiple pages", async () => {
      const page1 = [
        createTestMessage("msg-1", "Page 1 - Message 1"),
        createTestMessage("msg-2", "Page 1 - Message 2"),
      ];
      const page2 = [
        createTestMessage("msg-3", "Page 2 - Message 1"),
        createTestMessage("msg-4", "Page 2 - Message 2"),
      ];
      const page3 = [createTestMessage("msg-5", "Page 3 - Message 1")];

      let callCount = 0;
      (
        mockAdapter.fetchMessages as ReturnType<typeof vi.fn>
      ).mockImplementation(async (_threadId, options) => {
        callCount++;
        if (callCount === 1) {
          expect(options?.cursor).toBeUndefined();
          return { messages: page1, nextCursor: "cursor-1" };
        }
        if (callCount === 2) {
          expect(options?.cursor).toBe("cursor-1");
          return { messages: page2, nextCursor: "cursor-2" };
        }
        expect(options?.cursor).toBe("cursor-2");
        return { messages: page3, nextCursor: undefined };
      });

      const collected: Message[] = [];
      for await (const msg of thread.allMessages) {
        collected.push(msg);
      }

      expect(collected).toHaveLength(5);
      expect(collected.map((m) => m.text)).toEqual([
        "Page 1 - Message 1",
        "Page 1 - Message 2",
        "Page 2 - Message 1",
        "Page 2 - Message 2",
        "Page 3 - Message 1",
      ]);
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(3);
    });

    it("should handle empty thread", async () => {
      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: [],
          nextCursor: undefined,
        },
      );

      const collected: Message[] = [];
      for await (const msg of thread.allMessages) {
        collected.push(msg);
      }

      expect(collected).toHaveLength(0);
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(1);
    });

    it("should stop when nextCursor is undefined", async () => {
      const messages = [createTestMessage("msg-1", "Single message")];

      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages,
          nextCursor: undefined,
        },
      );

      const collected: Message[] = [];
      for await (const msg of thread.allMessages) {
        collected.push(msg);
      }

      expect(collected).toHaveLength(1);
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(1);
    });

    it("should stop when empty page is returned with cursor", async () => {
      // Edge case: adapter returns a cursor but no messages (shouldn't happen, but be defensive)
      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: [],
          nextCursor: "some-cursor", // Cursor present but no messages
        },
      );

      const collected: Message[] = [];
      for await (const msg of thread.allMessages) {
        collected.push(msg);
      }

      expect(collected).toHaveLength(0);
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(1);
    });

    it("should allow breaking out of iteration early", async () => {
      const page1 = [
        createTestMessage("msg-1", "Message 1"),
        createTestMessage("msg-2", "Message 2"),
      ];

      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: page1,
          nextCursor: "more-available",
        },
      );

      const collected: Message[] = [];
      for await (const msg of thread.allMessages) {
        collected.push(msg);
        if (msg.id === "msg-1") {
          break; // Break after first message
        }
      }

      expect(collected).toHaveLength(1);
      expect(collected[0].id).toBe("msg-1");
      // Should only fetch once since we broke early within first page
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(1);
    });

    it("should be reusable (can iterate multiple times)", async () => {
      const messages = [createTestMessage("msg-1", "Test message")];

      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages,
          nextCursor: undefined,
        },
      );

      // First iteration
      const first: Message[] = [];
      for await (const msg of thread.allMessages) {
        first.push(msg);
      }

      // Second iteration
      const second: Message[] = [];
      for await (const msg of thread.allMessages) {
        second.push(msg);
      }

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(2);
    });
  });

  describe("refresh", () => {
    let thread: ThreadImpl;
    let mockAdapter: Adapter;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      mockAdapter = createMockAdapter();
      mockState = createMockState();

      thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });
    });

    it("should update recentMessages from API", async () => {
      const messages = [
        createTestMessage("msg-1", "Recent 1"),
        createTestMessage("msg-2", "Recent 2"),
      ];

      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages,
          nextCursor: undefined,
        },
      );

      expect(thread.recentMessages).toHaveLength(0);

      await thread.refresh();

      expect(thread.recentMessages).toHaveLength(2);
      expect(thread.recentMessages[0].text).toBe("Recent 1");
      expect(thread.recentMessages[1].text).toBe("Recent 2");
    });

    it("should fetch with limit of 50", async () => {
      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: [],
          nextCursor: undefined,
        },
      );

      await thread.refresh();

      expect(mockAdapter.fetchMessages).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        { limit: 50 },
      );
    });

    it("should use default (backward) direction", async () => {
      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: [],
          nextCursor: undefined,
        },
      );

      await thread.refresh();

      // refresh() doesn't specify direction, so adapter uses its default (backward)
      expect(mockAdapter.fetchMessages).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        { limit: 50 },
      );
    });
  });

  describe("fetchMessages direction behavior", () => {
    let thread: ThreadImpl;
    let mockAdapter: Adapter;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      mockAdapter = createMockAdapter();
      mockState = createMockState();

      thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });
    });

    it("should pass direction option to adapter", async () => {
      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: [],
          nextCursor: undefined,
        },
      );

      // Test that allMessages passes forward direction
      for await (const _msg of thread.allMessages) {
        // No messages
      }

      const call = (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(call[1]).toEqual(
        expect.objectContaining({
          direction: "forward",
        }),
      );
    });
  });

  describe("concurrent iteration safety", () => {
    let thread: ThreadImpl;
    let mockAdapter: Adapter;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      mockAdapter = createMockAdapter();
      mockState = createMockState();

      thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });
    });

    it("should handle concurrent iterations independently", async () => {
      let callCount = 0;
      (
        mockAdapter.fetchMessages as ReturnType<typeof vi.fn>
      ).mockImplementation(async () => {
        callCount++;
        // Return different data for each call to prove independence
        return {
          messages: [
            createTestMessage(`msg-${callCount}`, `Call ${callCount}`),
          ],
          nextCursor: undefined,
        };
      });

      // Start two concurrent iterations
      const results = await Promise.all([
        (async () => {
          const msgs: Message[] = [];
          for await (const msg of thread.allMessages) {
            msgs.push(msg);
          }
          return msgs;
        })(),
        (async () => {
          const msgs: Message[] = [];
          for await (const msg of thread.allMessages) {
            msgs.push(msg);
          }
          return msgs;
        })(),
      ]);

      // Each iteration should have its own messages
      expect(results[0]).toHaveLength(1);
      expect(results[1]).toHaveLength(1);
      // They should have fetched independently
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(2);
    });

    it("should not share cursor state between iterations", async () => {
      const cursors: (string | undefined)[] = [];
      (
        mockAdapter.fetchMessages as ReturnType<typeof vi.fn>
      ).mockImplementation(async (_threadId, options) => {
        cursors.push(options?.cursor);
        return {
          messages: [createTestMessage("msg-1", "Test")],
          nextCursor: undefined,
        };
      });

      // Two sequential iterations
      for await (const _msg of thread.allMessages) {
        // Consume
      }
      for await (const _msg of thread.allMessages) {
        // Consume
      }

      // Both iterations should start with undefined cursor
      expect(cursors).toEqual([undefined, undefined]);
    });
  });
});
