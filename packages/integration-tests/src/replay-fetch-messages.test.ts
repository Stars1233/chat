/**
 * Replay tests for fetchMessages functionality.
 *
 * These tests use actual recorded API responses to verify message fetching
 * works correctly across platforms. Messages are numbered 1-14 to verify
 * correct chronological ordering.
 */

import { createMemoryState } from "@chat-adapter/state-memory";
import { ThreadImpl } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPECTED_NUMBERED_TEXTS,
  GCHAT_BOT_USER_ID,
  GCHAT_HUMAN_USER_ID,
  GCHAT_RAW_MESSAGES,
  GCHAT_SPACE,
  GCHAT_THREAD,
  GCHAT_THREAD_ID,
  SLACK_BOT_USER_ID,
  SLACK_CHANNEL,
  SLACK_HUMAN_USER_ID,
  SLACK_RAW_MESSAGES,
  SLACK_THREAD_ID,
  SLACK_THREAD_TS,
  TEAMS_BOT_APP_ID,
  TEAMS_CHANNEL_ID,
  TEAMS_HUMAN_USER_ID,
  TEAMS_PARENT_MESSAGE_ID,
  TEAMS_RAW_MESSAGES,
  TEAMS_SERVICE_URL,
  TEAMS_TEAM_ID,
} from "./fixtures/replay/fetch-messages";
import {
  createGchatTestContext,
  createSlackTestContext,
  createTeamsTestContext,
  type GchatTestContext,
  type SlackTestContext,
  type TeamsTestContext,
} from "./replay-test-utils";
import {
  createMockGraphClient,
  injectMockGraphClient,
  type MockGraphClient,
} from "./teams-utils";

describe("fetchMessages Replay Tests", () => {
  describe("Google Chat", () => {
    let ctx: GchatTestContext;

    beforeEach(() => {
      vi.clearAllMocks();

      ctx = createGchatTestContext(
        { botName: "Chat SDK Demo", botUserId: GCHAT_BOT_USER_ID },
        {},
      );

      // Mock messages.list to return actual recorded messages
      // biome-ignore lint/suspicious/noExplicitAny: mock type override for testing
      (ctx.mockChatApi.spaces.messages.list as any).mockImplementation(
        async (params: {
          parent: string;
          pageSize?: number;
          pageToken?: string;
          orderBy?: string;
        }) => {
          const isDescending = params.orderBy === "createTime desc";
          // Return messages in the order requested by API
          const messages = isDescending
            ? [...GCHAT_RAW_MESSAGES].reverse()
            : [...GCHAT_RAW_MESSAGES];

          const limit = params.pageSize || 50;
          const sliced = messages.slice(0, limit);

          return {
            data: {
              messages: sliced,
              nextPageToken:
                messages.length > limit ? "next-page-token" : undefined,
            },
          };
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should call API with correct params for forward direction", async () => {
      await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
        limit: 25,
        direction: "forward",
      });

      // Forward direction: fetches all messages (pageSize: 1000 for efficiency)
      // No orderBy = defaults to createTime ASC (oldest first)
      expect(ctx.mockChatApi.spaces.messages.list).toHaveBeenCalledWith({
        parent: GCHAT_SPACE,
        pageSize: 1000,
        pageToken: undefined,
        filter: `thread.name = "${GCHAT_THREAD}"`,
      });
    });

    it("should call API with correct params for backward direction", async () => {
      await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
        limit: 50,
        direction: "backward",
      });

      // Backward direction: respects limit, uses descending order
      expect(ctx.mockChatApi.spaces.messages.list).toHaveBeenCalledWith({
        parent: GCHAT_SPACE,
        pageSize: 50,
        pageToken: undefined,
        filter: `thread.name = "${GCHAT_THREAD}"`,
        orderBy: "createTime desc",
      });
    });

    it("should return all messages in chronological order", async () => {
      const result = await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
        limit: 100,
        direction: "forward",
      });

      // Should have all 19 messages (4 bot + 15 human messages)
      expect(result.messages).toHaveLength(19);

      // Extract just the numbered messages (filter out bot messages)
      const numberedMessages = result.messages.filter(
        (m) =>
          !m.author.isBot && EXPECTED_NUMBERED_TEXTS.includes(m.text || ""),
      );

      // Should have exactly 14 numbered messages
      expect(numberedMessages).toHaveLength(14);

      // Verify they are in correct chronological order (1, 2, 3, ... 14)
      const texts = numberedMessages.map((m) => m.text);
      expect(texts).toEqual(EXPECTED_NUMBERED_TEXTS);
    });

    it("should return messages in chronological order with backward direction", async () => {
      const result = await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
        limit: 100,
        direction: "backward",
      });

      // Backward still returns in chronological order (oldest to newest within the page)
      expect(result.messages).toHaveLength(19);

      // Extract numbered messages and verify order
      const numberedMessages = result.messages.filter(
        (m) =>
          !m.author.isBot && EXPECTED_NUMBERED_TEXTS.includes(m.text || ""),
      );
      const texts = numberedMessages.map((m) => m.text);
      expect(texts).toEqual(EXPECTED_NUMBERED_TEXTS);
    });

    it("should correctly identify bot vs human messages", async () => {
      const result = await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
        limit: 100,
      });

      const botMessages = result.messages.filter((m) => m.author.isBot);
      const humanMessages = result.messages.filter((m) => !m.author.isBot);

      // 4 bot messages total (2 welcome cards + 2 "Thanks")
      expect(botMessages).toHaveLength(4);
      // 14 numbered human messages + 1 "Hey" = 15
      expect(humanMessages).toHaveLength(15);

      // All bot messages should have isMe: true
      for (const msg of botMessages) {
        expect(msg.author.isMe).toBe(true);
        expect(msg.author.userId).toBe(GCHAT_BOT_USER_ID);
      }

      // All human messages should have isMe: false
      for (const msg of humanMessages) {
        expect(msg.author.isMe).toBe(false);
        expect(msg.author.userId).toBe(GCHAT_HUMAN_USER_ID);
      }
    });

    it("should handle card-only messages with empty text", async () => {
      const result = await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
        limit: 100,
      });

      // Find messages that have cardsV2 but no text
      const cardOnlyMessages = result.messages.filter(
        (m) =>
          (m.raw as { cardsV2?: unknown[] }).cardsV2 &&
          (!m.text || m.text === ""),
      );

      // Should have 2 card-only messages (welcome card + fetch results card)
      expect(cardOnlyMessages).toHaveLength(2);

      // Both should be from the bot
      for (const msg of cardOnlyMessages) {
        expect(msg.author.isBot).toBe(true);
        expect(msg.author.isMe).toBe(true);
      }
    });

    it("should respect limit parameter", async () => {
      const result = await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
        limit: 5,
        direction: "forward",
      });

      expect(result.messages).toHaveLength(5);

      // First 5 messages should be: Hey, bot card 1, bot card 2, "1", "2"
      expect(result.messages[0].text).toBe("@Chat SDK Demo Hey");
      expect(result.messages[3].text).toBe("1");
      expect(result.messages[4].text).toBe("2");
    });
  });

  describe("Slack", () => {
    let ctx: SlackTestContext;

    beforeEach(() => {
      vi.clearAllMocks();

      ctx = createSlackTestContext(
        { botName: "Chat SDK Bot", botUserId: SLACK_BOT_USER_ID },
        {},
      );

      // Mock conversations.replies to return actual recorded messages
      ctx.mockClient.conversations.replies.mockImplementation(
        async (params: {
          channel: string;
          ts: string;
          limit?: number;
          oldest?: string;
          latest?: string;
        }) => {
          let messages = [...SLACK_RAW_MESSAGES];
          const limit = params.limit || 100;

          // Handle oldest/latest filtering for pagination
          if (params.oldest) {
            const oldest = params.oldest;
            messages = messages.filter(
              (m) => Number.parseFloat(m.ts) > Number.parseFloat(oldest),
            );
          }
          if (params.latest) {
            const latest = params.latest;
            messages = messages.filter(
              (m) => Number.parseFloat(m.ts) < Number.parseFloat(latest),
            );
          }

          const sliced = messages.slice(0, limit);
          const hasMore = messages.length > limit;

          return {
            ok: true,
            messages: sliced,
            has_more: hasMore,
            response_metadata: hasMore
              ? { next_cursor: "next-cursor" }
              : undefined,
          };
        },
      );

      // Mock users.info for display name lookup
      ctx.mockClient.users.info.mockImplementation(
        async (params: { user: string }) => {
          const users: Record<
            string,
            { name: string; real_name: string; is_bot?: boolean }
          > = {
            [SLACK_HUMAN_USER_ID]: { name: "malteubl", real_name: "Malte Ubl" },
            [SLACK_BOT_USER_ID]: {
              name: "chatsdkbot",
              real_name: "Chat SDK Bot",
              is_bot: true,
            },
          };
          const user = users[params.user];
          return {
            ok: true,
            user: user ? { id: params.user, ...user } : undefined,
          };
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should call API with correct params for forward direction", async () => {
      await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
        limit: 25,
        direction: "forward",
      });

      // Forward direction: uses requested limit, native cursor pagination
      expect(ctx.mockClient.conversations.replies).toHaveBeenCalledWith({
        channel: SLACK_CHANNEL,
        ts: SLACK_THREAD_TS,
        limit: 25,
        cursor: undefined,
      });
    });

    it("should call API with correct params for backward direction", async () => {
      await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
        limit: 50,
        direction: "backward",
      });

      // Backward direction: uses larger batch size min(1000, max(limit*2, 200))
      // For limit=50: min(1000, max(100, 200)) = 200
      expect(ctx.mockClient.conversations.replies).toHaveBeenCalledWith({
        channel: SLACK_CHANNEL,
        ts: SLACK_THREAD_TS,
        limit: 200,
        latest: undefined,
        inclusive: false,
      });
    });

    it("should return all messages in chronological order", async () => {
      const result = await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
        limit: 100,
        direction: "forward",
      });

      // Should have all 19 messages
      expect(result.messages).toHaveLength(19);

      // Extract just the numbered messages
      const numberedMessages = result.messages.filter((m) =>
        EXPECTED_NUMBERED_TEXTS.includes(m.text || ""),
      );

      // Should have exactly 14 numbered messages
      expect(numberedMessages).toHaveLength(14);

      // Verify they are in correct chronological order (1, 2, 3, ... 14)
      const texts = numberedMessages.map((m) => m.text);
      expect(texts).toEqual(EXPECTED_NUMBERED_TEXTS);
    });

    it("should return messages in chronological order with backward direction", async () => {
      const result = await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
        limit: 100,
        direction: "backward",
      });

      expect(result.messages).toHaveLength(19);

      // Extract numbered messages and verify order
      const numberedMessages = result.messages.filter((m) =>
        EXPECTED_NUMBERED_TEXTS.includes(m.text || ""),
      );
      const texts = numberedMessages.map((m) => m.text);
      expect(texts).toEqual(EXPECTED_NUMBERED_TEXTS);
    });

    it("should correctly identify bot vs human messages", async () => {
      const result = await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
        limit: 100,
      });

      const botMessages = result.messages.filter((m) => m.author.isBot);
      const humanMessages = result.messages.filter((m) => !m.author.isBot);

      // 4 bot messages (Welcome, Fetch Results, 2x Thanks)
      expect(botMessages).toHaveLength(4);
      // 15 human messages (Hey + 14 numbered)
      expect(humanMessages).toHaveLength(15);

      // All bot messages should have isMe: true
      for (const msg of botMessages) {
        expect(msg.author.isMe).toBe(true);
        expect(msg.author.userId).toBe(SLACK_BOT_USER_ID);
      }

      // All human messages should have isMe: false
      for (const msg of humanMessages) {
        expect(msg.author.isMe).toBe(false);
        expect(msg.author.userId).toBe(SLACK_HUMAN_USER_ID);
      }
    });

    it("should resolve user display names", async () => {
      const result = await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
        limit: 100,
      });

      // Human messages should have resolved display names
      const humanMessage = result.messages.find(
        (m) => m.author.userId === SLACK_HUMAN_USER_ID,
      );
      expect(humanMessage?.author.userName).toBe("Malte Ubl");
      expect(humanMessage?.author.fullName).toBe("Malte Ubl");

      // Bot messages should have bot name
      const botMessage = result.messages.find(
        (m) => m.author.userId === SLACK_BOT_USER_ID,
      );
      expect(botMessage?.author.userName).toBe("Chat SDK Bot");
    });

    it("should respect limit parameter", async () => {
      const result = await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
        limit: 5,
        direction: "forward",
      });

      expect(result.messages).toHaveLength(5);

      // First 5 messages: Hey, Welcome, Fetch Results, "1", "2"
      expect(result.messages[0].text).toContain("Hey");
      expect(result.messages[3].text).toBe("1");
      expect(result.messages[4].text).toBe("2");
    });
  });

  describe("Teams", () => {
    let ctx: TeamsTestContext;
    let mockGraphClient: MockGraphClient;

    // Build Teams thread ID in the expected format
    const conversationId = `${TEAMS_CHANNEL_ID};messageid=${TEAMS_PARENT_MESSAGE_ID}`;
    const encodedConversationId =
      Buffer.from(conversationId).toString("base64url");
    const encodedServiceUrl =
      Buffer.from(TEAMS_SERVICE_URL).toString("base64url");
    const TEAMS_THREAD_ID = `teams:${encodedConversationId}:${encodedServiceUrl}`;

    beforeEach(async () => {
      vi.clearAllMocks();

      ctx = createTeamsTestContext(
        { botName: "Chat SDK Demo", appId: TEAMS_BOT_APP_ID },
        {},
      );

      mockGraphClient = createMockGraphClient();
      injectMockGraphClient(ctx.adapter, mockGraphClient);

      // Connect the state adapter before using it
      await ctx.chat.getState().connect();

      // Set up channel context in state so fetchMessages can find team/channel info
      const channelContext = {
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
        tenantId: "ed6e6740-934d-4088-a05e-caa14d8d89ee",
      };
      await ctx.chat
        .getState()
        .set(
          `teams:channelContext:${TEAMS_CHANNEL_ID}`,
          JSON.stringify(channelContext),
        );

      // Mock Graph API to return actual recorded messages
      // Note: Graph API returns newest first (desc order), so we reverse the fixture
      mockGraphClient.setResponses([
        { value: [...(TEAMS_RAW_MESSAGES as unknown[])].reverse() },
      ]);
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should call Graph API with correct endpoint", async () => {
      await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
        limit: 25,
        direction: "backward",
      });

      // Verify an API call was made
      expect(mockGraphClient.apiCalls.length).toBeGreaterThan(0);
      // Uses chats endpoint (channel context requires webhook handling to populate)
      expect(mockGraphClient.apiCalls[0].url).toContain("/chats/");
      expect(mockGraphClient.apiCalls[0].url).toContain("/messages");
    });

    it("should return all messages in chronological order", async () => {
      const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
        limit: 100,
        direction: "backward",
      });

      // Should have all 20 messages from the fixture
      expect(result.messages).toHaveLength(20);

      // Extract just the numbered messages (filter out bot card messages)
      // Note: Recording has numbers 1-13 (no "Hey" or "14" as those are parent/missing)
      const expectedNumbers = [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "13",
      ];
      const numberedMessages = result.messages.filter(
        (m) => !m.author.isBot && expectedNumbers.includes(m.text || ""),
      );

      // Should have exactly 13 numbered messages (1-13)
      expect(numberedMessages).toHaveLength(13);

      // Verify they are in correct chronological order
      const texts = numberedMessages.map((m) => m.text);
      expect(texts).toEqual(expectedNumbers);
    });

    it("should return messages in chronological order with forward direction", async () => {
      const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
        limit: 100,
        direction: "forward",
      });

      expect(result.messages).toHaveLength(20);

      // Extract numbered messages and verify order
      const expectedNumbers = [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "13",
      ];
      const numberedMessages = result.messages.filter(
        (m) => !m.author.isBot && expectedNumbers.includes(m.text || ""),
      );
      const texts = numberedMessages.map((m) => m.text);
      expect(texts).toEqual(expectedNumbers);
    });

    it("should correctly identify bot vs human messages", async () => {
      const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
        limit: 100,
      });

      const botMessages = result.messages.filter((m) => m.author.isBot);
      const humanMessages = result.messages.filter((m) => !m.author.isBot);

      // 6 bot messages (2 welcome/fetch cards, 4 "Thanks")
      expect(botMessages).toHaveLength(6);
      // 14 human messages (numbered 1-13 + "Proper text")
      expect(humanMessages).toHaveLength(14);

      // All bot messages should have isMe: true
      for (const msg of botMessages) {
        expect(msg.author.isMe).toBe(true);
        expect(msg.author.userId).toBe(TEAMS_BOT_APP_ID);
      }

      // All human messages should have isMe: false
      for (const msg of humanMessages) {
        expect(msg.author.isMe).toBe(false);
        expect(msg.author.userId).toBe(TEAMS_HUMAN_USER_ID);
      }
    });

    it("should have author.userName for ALL messages (BUG CHECK)", async () => {
      const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
        limit: 100,
      });

      // Every message MUST have a non-empty author.userName
      for (const msg of result.messages) {
        expect(msg.author.userName).toBeTruthy();
        expect(msg.author.userName).not.toBe("");
        expect(msg.author.userName).not.toBe("unknown");
      }

      // Human messages should have "Malte Ubl" as userName
      const humanMessages = result.messages.filter((m) => !m.author.isBot);
      for (const msg of humanMessages) {
        expect(msg.author.userName).toBe("Malte Ubl");
      }

      // Bot messages should have "Chat SDK Demo" as userName
      const botMessages = result.messages.filter((m) => m.author.isBot);
      for (const msg of botMessages) {
        expect(msg.author.userName).toBe("Chat SDK Demo");
      }
    });

    it("should have non-empty text for human messages (BUG CHECK)", async () => {
      const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
        limit: 100,
      });

      // Human messages should have non-empty text (numbered 1-13)
      const humanMessages = result.messages.filter((m) => !m.author.isBot);
      for (const msg of humanMessages) {
        expect(msg.text).toBeTruthy();
        expect(msg.text).not.toBe("");
      }
    });

    it("should handle adaptive card messages", async () => {
      const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
        limit: 100,
      });

      // Find messages that have adaptive card attachments
      const cardMessages = result.messages.filter((m) => {
        const raw = m.raw as {
          attachments?: Array<{ contentType?: string }>;
        };
        return raw.attachments?.some(
          (a) => a.contentType === "application/vnd.microsoft.card.adaptive",
        );
      });

      // Should have 2 card messages in this recording (Welcome and Message Fetch Results)
      expect(cardMessages).toHaveLength(2);

      // All should be from the bot
      for (const msg of cardMessages) {
        expect(msg.author.isBot).toBe(true);
        expect(msg.author.isMe).toBe(true);
      }
    });

    it("should extract card titles for bot messages (BUG CHECK)", async () => {
      const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
        limit: 100,
      });

      // Find the Welcome card message (first bot message with card)
      const cardMessages = result.messages.filter((m) => {
        const raw = m.raw as {
          attachments?: Array<{ contentType?: string; content?: string }>;
        };
        return raw.attachments?.some(
          (a) =>
            a.contentType === "application/vnd.microsoft.card.adaptive" &&
            a.content?.includes("Welcome"),
        );
      });

      expect(cardMessages.length).toBeGreaterThan(0);

      // The bug: card messages should have text extracted from the card title
      // Before fix: text would be empty string ""
      // After fix: text should be "👋 Welcome!" or similar
      const welcomeCard = cardMessages[0];
      expect(welcomeCard.text).not.toBe("");
      expect(welcomeCard.text).toContain("Welcome");
    });

    it("should respect limit parameter with backward direction", async () => {
      // For backward direction, we're getting the last N messages
      const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
        limit: 5,
        direction: "backward",
      });

      // Backward gets last 5 from 19 messages
      expect(result.messages).toHaveLength(5);
    });
  });
});

describe("allMessages Replay Tests", () => {
  describe("Google Chat", () => {
    let ctx: GchatTestContext;

    beforeEach(() => {
      vi.clearAllMocks();

      ctx = createGchatTestContext(
        { botName: "Chat SDK Demo", botUserId: GCHAT_BOT_USER_ID },
        {},
      );

      // Mock messages.list to return actual recorded messages
      // biome-ignore lint/suspicious/noExplicitAny: mock type override for testing
      (ctx.mockChatApi.spaces.messages.list as any).mockImplementation(
        async (params: {
          parent: string;
          pageSize?: number;
          pageToken?: string;
          orderBy?: string;
        }) => {
          const isDescending = params.orderBy === "createTime desc";
          const messages = isDescending
            ? [...GCHAT_RAW_MESSAGES].reverse()
            : [...GCHAT_RAW_MESSAGES];

          const limit = params.pageSize || 50;
          const sliced = messages.slice(0, limit);

          return {
            data: {
              messages: sliced,
              nextPageToken:
                messages.length > limit ? "next-page-token" : undefined,
            },
          };
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should iterate all messages in chronological order via thread.allMessages", async () => {
      // Create a Thread using ThreadImpl with the mocked adapter
      const stateAdapter = createMemoryState();
      const thread = new ThreadImpl({
        id: GCHAT_THREAD_ID,
        adapter: ctx.adapter,
        channelId: GCHAT_SPACE,
        stateAdapter,
      });

      // Collect all messages from the async iterator
      const messages = [];
      for await (const msg of thread.allMessages) {
        messages.push(msg);
      }

      // Should have all 19 messages
      expect(messages).toHaveLength(19);

      // Extract numbered messages and verify chronological order
      const numberedMessages = messages.filter((m) =>
        EXPECTED_NUMBERED_TEXTS.includes(m.text || ""),
      );
      expect(numberedMessages).toHaveLength(14);

      const texts = numberedMessages.map((m) => m.text);
      expect(texts).toEqual(EXPECTED_NUMBERED_TEXTS);
    });

    it("should call fetchMessages with forward direction and limit 100", async () => {
      const stateAdapter = createMemoryState();
      const thread = new ThreadImpl({
        id: GCHAT_THREAD_ID,
        adapter: ctx.adapter,
        channelId: GCHAT_SPACE,
        stateAdapter,
      });

      // Consume the iterator
      for await (const _ of thread.allMessages) {
        // Just iterate
      }

      // allMessages uses forward direction with limit 100 internally
      // GChat forward fetches with pageSize 1000 (max efficiency)
      expect(ctx.mockChatApi.spaces.messages.list).toHaveBeenCalledWith({
        parent: GCHAT_SPACE,
        pageSize: 1000,
        pageToken: undefined,
        filter: `thread.name = "${GCHAT_THREAD}"`,
      });
    });
  });

  describe("Slack", () => {
    let ctx: SlackTestContext;

    beforeEach(() => {
      vi.clearAllMocks();

      ctx = createSlackTestContext(
        { botName: "Chat SDK Bot", botUserId: SLACK_BOT_USER_ID },
        {},
      );

      // Mock conversations.replies to return actual recorded messages
      ctx.mockClient.conversations.replies.mockImplementation(
        async (params: {
          channel: string;
          ts: string;
          limit?: number;
          oldest?: string;
          latest?: string;
        }) => {
          let messages = [...SLACK_RAW_MESSAGES];
          const limit = params.limit || 100;

          if (params.oldest) {
            const oldest = params.oldest;
            messages = messages.filter(
              (m) => Number.parseFloat(m.ts) > Number.parseFloat(oldest),
            );
          }
          if (params.latest) {
            const latest = params.latest;
            messages = messages.filter(
              (m) => Number.parseFloat(m.ts) < Number.parseFloat(latest),
            );
          }

          const sliced = messages.slice(0, limit);
          const hasMore = messages.length > limit;

          return {
            ok: true,
            messages: sliced,
            has_more: hasMore,
            response_metadata: hasMore
              ? { next_cursor: "next-cursor" }
              : undefined,
          };
        },
      );

      // Mock users.info
      ctx.mockClient.users.info.mockImplementation(
        async (params: { user: string }) => {
          const users: Record<
            string,
            { name: string; real_name: string; is_bot?: boolean }
          > = {
            [SLACK_HUMAN_USER_ID]: { name: "malteubl", real_name: "Malte Ubl" },
            [SLACK_BOT_USER_ID]: {
              name: "chatsdkbot",
              real_name: "Chat SDK Bot",
              is_bot: true,
            },
          };
          const user = users[params.user];
          return {
            ok: true,
            user: user ? { id: params.user, ...user } : undefined,
          };
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should iterate all messages in chronological order via thread.allMessages", async () => {
      const stateAdapter = createMemoryState();
      const thread = new ThreadImpl({
        id: SLACK_THREAD_ID,
        adapter: ctx.adapter,
        channelId: SLACK_CHANNEL,
        stateAdapter,
      });

      // Collect all messages from the async iterator
      const messages = [];
      for await (const msg of thread.allMessages) {
        messages.push(msg);
      }

      // Should have all 19 messages
      expect(messages).toHaveLength(19);

      // Extract numbered messages and verify chronological order
      const numberedMessages = messages.filter((m) =>
        EXPECTED_NUMBERED_TEXTS.includes(m.text || ""),
      );
      expect(numberedMessages).toHaveLength(14);

      const texts = numberedMessages.map((m) => m.text);
      expect(texts).toEqual(EXPECTED_NUMBERED_TEXTS);
    });

    it("should call fetchMessages with forward direction and limit 100", async () => {
      const stateAdapter = createMemoryState();
      const thread = new ThreadImpl({
        id: SLACK_THREAD_ID,
        adapter: ctx.adapter,
        channelId: SLACK_CHANNEL,
        stateAdapter,
      });

      // Consume the iterator
      for await (const _ of thread.allMessages) {
        // Just iterate
      }

      // allMessages uses forward direction with limit 100
      expect(ctx.mockClient.conversations.replies).toHaveBeenCalledWith({
        channel: SLACK_CHANNEL,
        ts: SLACK_THREAD_TS,
        limit: 100,
        cursor: undefined,
      });
    });
  });

  describe("Teams", () => {
    let ctx: TeamsTestContext;
    let mockGraphClient: MockGraphClient;

    // Build Teams thread ID in the expected format
    const conversationId = `${TEAMS_CHANNEL_ID};messageid=${TEAMS_PARENT_MESSAGE_ID}`;
    const encodedConversationId =
      Buffer.from(conversationId).toString("base64url");
    const encodedServiceUrl =
      Buffer.from(TEAMS_SERVICE_URL).toString("base64url");
    const TEAMS_THREAD_ID = `teams:${encodedConversationId}:${encodedServiceUrl}`;

    beforeEach(async () => {
      vi.clearAllMocks();

      ctx = createTeamsTestContext(
        { botName: "Chat SDK Demo", appId: TEAMS_BOT_APP_ID },
        {},
      );

      mockGraphClient = createMockGraphClient();
      injectMockGraphClient(ctx.adapter, mockGraphClient);

      // Connect the state adapter before using it
      await ctx.chat.getState().connect();

      // Set up channel context in state
      const channelContext = {
        teamId: TEAMS_TEAM_ID,
        channelId: TEAMS_CHANNEL_ID,
        tenantId: "ed6e6740-934d-4088-a05e-caa14d8d89ee",
      };
      await ctx.chat
        .getState()
        .set(
          `teams:channelContext:${TEAMS_CHANNEL_ID}`,
          JSON.stringify(channelContext),
        );

      // Mock Graph API to return actual recorded messages
      // Note: Graph API returns newest first (desc order), so we reverse the fixture
      mockGraphClient.setResponses([
        { value: [...(TEAMS_RAW_MESSAGES as unknown[])].reverse() },
      ]);
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should iterate all messages in chronological order via thread.allMessages", async () => {
      const stateAdapter = createMemoryState();
      const thread = new ThreadImpl({
        id: TEAMS_THREAD_ID,
        adapter: ctx.adapter,
        channelId: TEAMS_CHANNEL_ID,
        stateAdapter,
      });

      // Collect all messages from the async iterator
      const messages = [];
      for await (const msg of thread.allMessages) {
        messages.push(msg);
      }

      // Should have all 20 messages
      expect(messages).toHaveLength(20);

      // Extract numbered messages and verify chronological order (1-13 in this recording)
      const expectedNumbers = [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "13",
      ];
      const numberedMessages = messages.filter((m) =>
        expectedNumbers.includes(m.text || ""),
      );
      expect(numberedMessages).toHaveLength(13);

      const texts = numberedMessages.map((m) => m.text);
      expect(texts).toEqual(expectedNumbers);
    });
  });
});
