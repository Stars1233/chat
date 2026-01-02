/**
 * Replay tests using recorded production webhooks.
 *
 * These tests replay actual webhook payloads recorded from production
 * to verify the Chat SDK handles real-world interactions correctly.
 *
 * Fixtures are loaded from JSON files in fixtures/replay/
 * See fixtures/replay/README.md for instructions on updating fixtures.
 */

import { createHmac } from "node:crypto";
import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-adapter/gchat";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-adapter/teams";
import { Chat, type Message, type Thread } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import gchatFixtures from "../fixtures/replay/gchat.json";
import slackFixtures from "../fixtures/replay/slack.json";
import teamsFixtures from "../fixtures/replay/teams.json";
import {
  createMockGoogleChatApi,
  GCHAT_TEST_CREDENTIALS,
  injectMockGoogleChatApi,
  type MockGoogleChatApi,
} from "./gchat-utils";
import {
  createMockSlackClient,
  injectMockSlackClient,
  type MockSlackClient,
  SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET,
} from "./slack-utils";
import {
  createMockBotAdapter,
  injectMockBotAdapter,
  type MockBotAdapter,
  TEAMS_APP_PASSWORD,
} from "./teams-utils";
import { createWaitUntilTracker } from "./test-scenarios";

function createSignedSlackRequest(body: string): Request {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sigBasestring = `v0:${timestamp}:${body}`;
  const signature = `v0=${createHmac("sha256", SLACK_SIGNING_SECRET).update(sigBasestring).digest("hex")}`;
  return new Request("https://example.com/webhook/slack", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
}

function createGchatRequest(body: unknown): Request {
  return new Request("https://example.com/webhook/gchat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createTeamsRequest(body: unknown): Request {
  return new Request("https://example.com/api/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

describe("Replay Tests", () => {
  describe("Google Chat", () => {
    let chat: Chat<{ gchat: GoogleChatAdapter }>;
    let gchatAdapter: GoogleChatAdapter;
    let mockChatApi: MockGoogleChatApi;
    let tracker: ReturnType<typeof createWaitUntilTracker>;

    // Captured data for assertions
    let capturedMentionMessage: Message | null = null;
    let capturedMentionThread: Thread | null = null;
    let capturedFollowUpMessage: Message | null = null;
    let capturedFollowUpThread: Thread | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedMentionMessage = null;
      capturedMentionThread = null;
      capturedFollowUpMessage = null;
      capturedFollowUpThread = null;

      gchatAdapter = createGoogleChatAdapter({
        credentials: GCHAT_TEST_CREDENTIALS,
        userName: gchatFixtures.botName,
      });
      // Set the bot user ID so isMe detection works
      gchatAdapter.botUserId = gchatFixtures.botUserId;

      mockChatApi = createMockGoogleChatApi();
      injectMockGoogleChatApi(gchatAdapter, mockChatApi);
      chat = new Chat({
        userName: gchatFixtures.botName,
        adapters: { gchat: gchatAdapter },
        state: createMemoryState(),
        logger: "error",
      });

      chat.onNewMention(async (thread, message) => {
        capturedMentionMessage = message;
        capturedMentionThread = thread;
        await thread.subscribe();
        await thread.post("Thanks for mentioning me!");
      });

      chat.onSubscribedMessage(async (thread, message) => {
        capturedFollowUpMessage = message;
        capturedFollowUpThread = thread;
        const msg = await thread.post("Processing...");
        await msg.edit("Just a little bit...");
        await msg.edit("Thanks for your message");
      });

      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    it("should replay @mention with correct message properties", async () => {
      await chat.webhooks.gchat(createGchatRequest(gchatFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Verify message was captured
      expect(capturedMentionMessage).not.toBeNull();
      expect(capturedMentionThread).not.toBeNull();

      // Verify message text (bot mention normalized to @{userName})
      expect(capturedMentionMessage?.text).toContain("hello");

      // Verify author properties
      expect(capturedMentionMessage?.author).toMatchObject({
        userId: "users/117994873354375860089",
        userName: "Malte Ubl",
        fullName: "Malte Ubl",
        isBot: false,
        isMe: false,
      });

      // Verify thread properties
      expect(capturedMentionThread?.id).toContain("gchat:");
      expect(capturedMentionThread?.adapter.name).toBe("gchat");

      // Verify recent messages includes the mention
      expect(capturedMentionThread?.recentMessages).toHaveLength(1);
      expect(capturedMentionThread?.recentMessages[0]).toBe(
        capturedMentionMessage,
      );

      // Verify bot response was sent
      expect(mockChatApi.sentMessages).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining("Thanks for mentioning me!"),
        }),
      );
    });

    it("should replay follow-up with correct message properties", async () => {
      // First send mention to subscribe
      await chat.webhooks.gchat(createGchatRequest(gchatFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
      mockChatApi.clearMocks();

      // Send follow-up via Pub/Sub
      await chat.webhooks.gchat(createGchatRequest(gchatFixtures.followUp), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Verify follow-up message was captured
      expect(capturedFollowUpMessage).not.toBeNull();
      expect(capturedFollowUpThread).not.toBeNull();

      // Verify message text
      expect(capturedFollowUpMessage?.text).toBe("Hey");

      // Verify author is human, not the bot
      expect(capturedFollowUpMessage?.author).toMatchObject({
        isBot: false,
        isMe: false,
      });

      // Verify thread has recent messages
      expect(capturedFollowUpThread?.recentMessages.length).toBeGreaterThan(0);

      // Verify responses
      expect(mockChatApi.sentMessages).toContainEqual(
        expect.objectContaining({ text: "Processing..." }),
      );
      expect(mockChatApi.updatedMessages).toContainEqual(
        expect.objectContaining({ text: "Thanks for your message" }),
      );
    });

    it("should correctly identify bot messages as isMe", async () => {
      // First subscribe via mention
      await chat.webhooks.gchat(createGchatRequest(gchatFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Track if handler was called
      let botMessageHandlerCalled = false;
      chat.onSubscribedMessage(async () => {
        botMessageHandlerCalled = true;
      });

      // Create a Pub/Sub message from the bot itself
      const botFollowUp = {
        message: {
          attributes: { "ce-type": "google.workspace.chat.message.v1.created" },
          // Base64 encoded message with sender matching the bot's user ID
          data: Buffer.from(
            JSON.stringify({
              message: {
                name: "spaces/AAQAJ9CXYcg/messages/bot-msg-001",
                sender: {
                  name: gchatFixtures.botUserId, // Bot's own user ID
                  type: "BOT",
                },
                text: "Bot's own message",
                thread: { name: "spaces/AAQAJ9CXYcg/threads/kVOtO797ZPI" },
                space: { name: "spaces/AAQAJ9CXYcg" },
                threadReply: true,
              },
            }),
          ).toString("base64"),
        },
        subscription:
          "projects/chat-sdk-demo-482018/subscriptions/chat-messages-push",
      };

      // Send bot's own message - should be skipped
      await chat.webhooks.gchat(createGchatRequest(botFollowUp), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Handler should NOT be called for bot's own messages
      expect(botMessageHandlerCalled).toBe(false);
    });
  });

  describe("Slack", () => {
    let chat: Chat<{ slack: SlackAdapter }>;
    let slackAdapter: SlackAdapter;
    let mockSlackClient: MockSlackClient;
    let tracker: ReturnType<typeof createWaitUntilTracker>;

    // Captured data for assertions
    let capturedMentionMessage: Message | null = null;
    let capturedMentionThread: Thread | null = null;
    let capturedFollowUpMessage: Message | null = null;
    let capturedFollowUpThread: Thread | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedMentionMessage = null;
      capturedMentionThread = null;
      capturedFollowUpMessage = null;
      capturedFollowUpThread = null;

      slackAdapter = createSlackAdapter({
        botToken: SLACK_BOT_TOKEN,
        signingSecret: SLACK_SIGNING_SECRET,
      });
      mockSlackClient = createMockSlackClient();
      mockSlackClient.auth.test.mockResolvedValue({
        ok: true,
        user_id: slackFixtures.botUserId,
        user: slackFixtures.botName,
      });
      injectMockSlackClient(slackAdapter, mockSlackClient);

      chat = new Chat({
        userName: slackFixtures.botName,
        adapters: { slack: slackAdapter },
        state: createMemoryState(),
        logger: "error",
      });

      chat.onNewMention(async (thread, message) => {
        capturedMentionMessage = message;
        capturedMentionThread = thread;
        await thread.subscribe();
        await thread.post("Thanks for mentioning me!");
      });

      chat.onSubscribedMessage(async (thread, message) => {
        capturedFollowUpMessage = message;
        capturedFollowUpThread = thread;
        const msg = await thread.post("Processing...");
        await msg.edit("Just a little bit...");
        await msg.edit("Thanks for your message");
      });

      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    it("should replay @mention with correct message properties", async () => {
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(slackFixtures.mention)),
        { waitUntil: tracker.waitUntil },
      );
      await tracker.waitForAll();

      // Verify message was captured
      expect(capturedMentionMessage).not.toBeNull();
      expect(capturedMentionThread).not.toBeNull();

      // Verify message text contains mention and content
      // Slack format: <@U0A56JUFP9A> Hey
      expect(capturedMentionMessage?.text).toContain("Hey");

      // Verify author properties
      expect(capturedMentionMessage?.author).toMatchObject({
        userId: "U03STHCA1JM", // Human user ID
        isBot: false,
        isMe: false,
      });

      // Verify thread properties
      expect(capturedMentionThread?.id).toContain("slack:");
      expect(capturedMentionThread?.id).toContain("C0A511MBCUW"); // Channel ID
      expect(capturedMentionThread?.adapter.name).toBe("slack");

      // Verify recent messages includes the mention
      expect(capturedMentionThread?.recentMessages).toHaveLength(1);
      expect(capturedMentionThread?.recentMessages[0]).toBe(
        capturedMentionMessage,
      );

      // Verify bot response was sent
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Thanks for mentioning me!"),
        }),
      );
    });

    it("should replay follow-up with correct message properties", async () => {
      // First send mention to subscribe
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(slackFixtures.mention)),
        { waitUntil: tracker.waitUntil },
      );
      await tracker.waitForAll();
      vi.clearAllMocks();

      // Send follow-up in thread
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(slackFixtures.followUp)),
        { waitUntil: tracker.waitUntil },
      );
      await tracker.waitForAll();

      // Verify follow-up message was captured
      expect(capturedFollowUpMessage).not.toBeNull();
      expect(capturedFollowUpThread).not.toBeNull();

      // Verify message text
      expect(capturedFollowUpMessage?.text).toBe("Hi");

      // Verify author is human, not the bot
      expect(capturedFollowUpMessage?.author).toMatchObject({
        userId: "U03STHCA1JM",
        isBot: false,
        isMe: false,
      });

      // Verify thread ID matches (same thread as mention)
      expect(capturedFollowUpThread?.id).toContain("slack:");
      expect(capturedFollowUpThread?.id).toContain("1767224888.280449"); // thread_ts

      // Verify thread has recent messages
      expect(capturedFollowUpThread?.recentMessages.length).toBeGreaterThan(0);

      // Verify responses
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Processing..." }),
      );
      expect(mockSlackClient.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Thanks for your message" }),
      );
    });

    it("should correctly identify bot messages as isMe", async () => {
      // Create a message from the bot itself
      const botMessage = {
        ...slackFixtures.followUp,
        event: {
          ...slackFixtures.followUp.event,
          user: slackFixtures.botUserId, // Bot's own user ID
          text: "Bot's own message",
        },
      };

      // First subscribe via mention
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(slackFixtures.mention)),
        { waitUntil: tracker.waitUntil },
      );
      await tracker.waitForAll();

      // Track if handler was called
      let botMessageHandlerCalled = false;
      chat.onSubscribedMessage(async () => {
        botMessageHandlerCalled = true;
      });

      // Send bot's own message - should be skipped
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(botMessage)),
        { waitUntil: tracker.waitUntil },
      );
      await tracker.waitForAll();

      // Handler should NOT be called for bot's own messages
      expect(botMessageHandlerCalled).toBe(false);
    });
  });

  describe("Teams", () => {
    let chat: Chat<{ teams: TeamsAdapter }>;
    let mockBotAdapter: MockBotAdapter;
    let tracker: ReturnType<typeof createWaitUntilTracker>;

    // Captured data for assertions
    let capturedMentionMessage: Message | null = null;
    let capturedMentionThread: Thread | null = null;
    let capturedFollowUpMessage: Message | null = null;
    let capturedFollowUpThread: Thread | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedMentionMessage = null;
      capturedMentionThread = null;
      capturedFollowUpMessage = null;
      capturedFollowUpThread = null;

      const teamsAdapter = createTeamsAdapter({
        appId: teamsFixtures.appId,
        appPassword: TEAMS_APP_PASSWORD,
        userName: teamsFixtures.botName,
      });
      mockBotAdapter = createMockBotAdapter();
      injectMockBotAdapter(teamsAdapter, mockBotAdapter);

      chat = new Chat({
        userName: teamsFixtures.botName,
        adapters: { teams: teamsAdapter },
        state: createMemoryState(),
        logger: "error",
      });

      chat.onNewMention(async (thread, message) => {
        capturedMentionMessage = message;
        capturedMentionThread = thread;
        await thread.subscribe();
        await thread.post("Thanks for mentioning me!");
      });

      chat.onSubscribedMessage(async (thread, message) => {
        capturedFollowUpMessage = message;
        capturedFollowUpThread = thread;
        const msg = await thread.post("Processing...");
        await msg.edit("Just a little bit...");
        await msg.edit("Thanks for your message");
      });

      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    it("should replay @mention with correct message properties", async () => {
      await chat.webhooks.teams(createTeamsRequest(teamsFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Verify message was captured
      expect(capturedMentionMessage).not.toBeNull();
      expect(capturedMentionThread).not.toBeNull();

      // Verify message text (Teams format converts <at>name</at> to @name)
      expect(capturedMentionMessage?.text).toContain("Hey");

      // Verify author properties
      expect(capturedMentionMessage?.author).toMatchObject({
        userId: expect.stringContaining("29:"), // Teams user ID format
        userName: "Malte Ubl",
        fullName: "Malte Ubl",
        isMe: false,
      });

      // Verify thread properties
      expect(capturedMentionThread?.id).toContain("teams:");
      expect(capturedMentionThread?.adapter.name).toBe("teams");

      // Verify recent messages includes the mention
      expect(capturedMentionThread?.recentMessages).toHaveLength(1);
      expect(capturedMentionThread?.recentMessages[0]).toBe(
        capturedMentionMessage,
      );

      // Verify bot response was sent
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining("Thanks for mentioning me!"),
        }),
      );
    });

    it("should replay follow-up with correct message properties", async () => {
      // First send mention to subscribe
      await chat.webhooks.teams(createTeamsRequest(teamsFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
      mockBotAdapter.clearMocks();

      // Send follow-up
      await chat.webhooks.teams(createTeamsRequest(teamsFixtures.followUp), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Verify follow-up message was captured
      expect(capturedFollowUpMessage).not.toBeNull();
      expect(capturedFollowUpThread).not.toBeNull();

      // Verify message text
      expect(capturedFollowUpMessage?.text).toBe("Hi");

      // Verify author is human, not the bot
      expect(capturedFollowUpMessage?.author).toMatchObject({
        userName: "Malte Ubl",
        isMe: false,
      });

      // Verify thread has recent messages
      expect(capturedFollowUpThread?.recentMessages.length).toBeGreaterThan(0);

      // Verify responses
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({ text: "Processing..." }),
      );
      expect(mockBotAdapter.updatedActivities).toContainEqual(
        expect.objectContaining({ text: "Thanks for your message" }),
      );
    });

    it("should correctly identify bot messages as isMe", async () => {
      // Create a message from the bot itself
      const botMessage = {
        ...teamsFixtures.followUp,
        from: {
          // Use the bot ID format that matches the appId
          id: `28:${teamsFixtures.appId}`,
          name: teamsFixtures.botName,
        },
        text: "Bot's own message",
      };

      // First subscribe via mention
      await chat.webhooks.teams(createTeamsRequest(teamsFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Track if handler was called
      let botMessageHandlerCalled = false;
      chat.onSubscribedMessage(async () => {
        botMessageHandlerCalled = true;
      });

      // Send bot's own message - should be skipped
      await chat.webhooks.teams(createTeamsRequest(botMessage), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Handler should NOT be called for bot's own messages
      expect(botMessageHandlerCalled).toBe(false);
    });
  });
});
