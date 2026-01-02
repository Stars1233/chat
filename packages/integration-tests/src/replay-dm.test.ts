/**
 * Replay tests for DM (Direct Message) functionality.
 *
 * These tests verify that the Chat SDK handles DM flows correctly:
 * 1. User mentions bot in channel, bot subscribes
 * 2. User requests DM in subscribed thread
 * 3. Bot opens DM and sends message
 * 4. User sends message in DM
 *
 * Fixtures are loaded from JSON files in fixtures/replay/dm/
 */

import { createHmac } from "node:crypto";
import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-sdk/gchat";
import { createSlackAdapter, type SlackAdapter } from "@chat-sdk/slack";
import { createMemoryState } from "@chat-sdk/state-memory";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-sdk/teams";
import { Chat, type Message, type Thread } from "chat-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import gchatFixtures from "../fixtures/replay/dm/gchat.json";
import slackFixtures from "../fixtures/replay/dm/slack.json";
import teamsFixtures from "../fixtures/replay/dm/teams.json";
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

describe("DM Replay Tests", () => {
  describe("Slack", () => {
    let chat: Chat<{ slack: SlackAdapter }>;
    let slackAdapter: SlackAdapter;
    let mockSlackClient: MockSlackClient;
    let tracker: ReturnType<typeof createWaitUntilTracker>;

    let capturedMentionMessage: Message | null = null;
    let capturedDmRequestMessage: Message | null = null;
    let capturedDmMessage: Message | null = null;
    let openDMCalled = false;
    let dmThreadId: string | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedMentionMessage = null;
      capturedDmRequestMessage = null;
      capturedDmMessage = null;
      openDMCalled = false;
      dmThreadId = null;

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
      // Mock conversations.open for DM creation
      mockSlackClient.conversations.open.mockResolvedValue({
        ok: true,
        channel: { id: slackFixtures.dmChannelId },
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
        await thread.subscribe();
        await thread.post("Welcome!");
      });

      chat.onSubscribedMessage(async (thread, message) => {
        if (message.text.toLowerCase().includes("dm me")) {
          capturedDmRequestMessage = message;
          try {
            const dmThread = await chat.openDM(message.author);
            openDMCalled = true;
            dmThreadId = dmThread.id;
            await dmThread.subscribe(); // Subscribe to DM thread to receive follow-ups
            await dmThread.post("Hello via DM!");
            await thread.post("I've sent you a DM!");
          } catch {
            await thread.post("Sorry, couldn't send DM");
          }
        } else if (thread.isDM) {
          capturedDmMessage = message;
          await thread.post(`Got your DM: ${message.text}`);
        }
      });

      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    it("should handle DM request flow", async () => {
      // Step 1: Initial mention to subscribe
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(slackFixtures.mention)),
        { waitUntil: tracker.waitUntil },
      );
      await tracker.waitForAll();

      expect(capturedMentionMessage).not.toBeNull();
      expect(capturedMentionMessage?.text).toContain("Hey");

      // Step 2: User requests DM in subscribed thread
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(slackFixtures.dmRequest)),
        { waitUntil: tracker.waitUntil },
      );
      await tracker.waitForAll();

      expect(capturedDmRequestMessage).not.toBeNull();
      expect(capturedDmRequestMessage?.text).toBe("DM me");
      expect(openDMCalled).toBe(true);
      expect(dmThreadId).toContain("slack:");
      expect(dmThreadId).toContain(slackFixtures.dmChannelId);

      // Verify DM was opened
      expect(mockSlackClient.conversations.open).toHaveBeenCalledWith({
        users: capturedDmRequestMessage?.author.userId,
      });

      // Verify DM message was sent
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: slackFixtures.dmChannelId,
          text: expect.stringContaining("Hello via DM!"),
        }),
      );
    });

    it("should detect DM channel type from webhook", async () => {
      // DM messages have channel_type: "im" which identifies them as DMs
      const dmEvent = slackFixtures.dmMessage;
      expect(dmEvent.event.channel_type).toBe("im");
    });

    it("should receive DM messages when subscribed to DM thread", async () => {
      // For Slack DMs, each message without thread_ts is its own thread
      // The bot needs to subscribe to receive follow-ups in the same thread

      // Create a DM message as the mention (user @mentions bot in DM)
      const dmMention = {
        ...slackFixtures.dmMessage,
        event: {
          ...slackFixtures.dmMessage.event,
          type: "app_mention" as const,
          text: `<@${slackFixtures.botUserId}> Hey!`,
        },
      };

      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(dmMention)),
        { waitUntil: tracker.waitUntil },
      );
      await tracker.waitForAll();

      // The mention in DM should be captured
      expect(capturedMentionMessage).not.toBeNull();
    });
  });

  describe("Google Chat", () => {
    let chat: Chat<{ gchat: GoogleChatAdapter }>;
    let gchatAdapter: GoogleChatAdapter;
    let mockChatApi: MockGoogleChatApi;
    let tracker: ReturnType<typeof createWaitUntilTracker>;

    let capturedMentionMessage: Message | null = null;
    let capturedDmRequestMessage: Message | null = null;
    let capturedDmMessage: Message | null = null;
    let openDMCalled = false;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedMentionMessage = null;
      capturedDmRequestMessage = null;
      capturedDmMessage = null;
      openDMCalled = false;

      gchatAdapter = createGoogleChatAdapter({
        credentials: GCHAT_TEST_CREDENTIALS,
        userName: gchatFixtures.botName,
      });
      gchatAdapter.botUserId = gchatFixtures.botUserId;

      mockChatApi = createMockGoogleChatApi();
      // Mock findDirectMessage to return the DM space
      mockChatApi.spaces.findDirectMessage.mockResolvedValue({
        data: { name: gchatFixtures.dmSpaceName },
      });
      injectMockGoogleChatApi(gchatAdapter, mockChatApi);

      chat = new Chat({
        userName: gchatFixtures.botName,
        adapters: { gchat: gchatAdapter },
        state: createMemoryState(),
        logger: "error",
      });

      chat.onNewMention(async (thread, message) => {
        capturedMentionMessage = message;
        await thread.subscribe();
        await thread.post("Welcome!");
      });

      chat.onSubscribedMessage(async (thread, message) => {
        if (message.text.toLowerCase().includes("dm me")) {
          capturedDmRequestMessage = message;
          try {
            const dmThread = await chat.openDM(message.author);
            openDMCalled = true;
            await dmThread.subscribe(); // Subscribe to DM thread to receive follow-ups
            await dmThread.post("Hello via DM!");
            await thread.post("I've sent you a DM!");
          } catch {
            await thread.post("Sorry, couldn't send DM");
          }
        } else if (thread.isDM) {
          capturedDmMessage = message;
          await thread.post(`Got your DM: ${message.text}`);
        }
      });

      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    it("should handle DM request flow", async () => {
      // Step 1: Initial mention to subscribe
      await chat.webhooks.gchat(createGchatRequest(gchatFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(capturedMentionMessage).not.toBeNull();
      expect(capturedMentionMessage?.text).toContain("hey");

      // Step 2: User requests DM via Pub/Sub
      await chat.webhooks.gchat(createGchatRequest(gchatFixtures.dmRequest), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(capturedDmRequestMessage).not.toBeNull();
      expect(capturedDmRequestMessage?.text).toBe("DM me");
      expect(openDMCalled).toBe(true);

      // Verify findDirectMessage was called
      expect(mockChatApi.spaces.findDirectMessage).toHaveBeenCalledWith({
        name: capturedDmRequestMessage?.author.userId,
      });
    });

    it("should detect DM space type from webhook", async () => {
      // DM messages have space.type: "DM" or spaceType: "DIRECT_MESSAGE"
      const dmPayload = gchatFixtures.dmMessage.chat.messagePayload;
      expect(dmPayload.space.type).toBe("DM");
      expect(dmPayload.space.spaceType).toBe("DIRECT_MESSAGE");
    });

    it("should correctly identify sender in DM space", async () => {
      // Verify the DM message has correct sender info
      const sender = gchatFixtures.dmMessage.chat.messagePayload.message.sender;
      expect(sender.name).toBe("users/117994873354375860089");
      expect(sender.displayName).toBe("Malte Ubl");
      expect(sender.type).toBe("HUMAN");
    });
  });

  describe("Teams", () => {
    let chat: Chat<{ teams: TeamsAdapter }>;
    let mockBotAdapter: MockBotAdapter;
    let tracker: ReturnType<typeof createWaitUntilTracker>;

    let capturedMentionMessage: Message | null = null;
    let capturedDmRequestMessage: Message | null = null;
    let openDMCalled = false;
    let dmThreadId: string | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedMentionMessage = null;
      capturedDmRequestMessage = null;
      openDMCalled = false;
      dmThreadId = null;

      const teamsAdapter = createTeamsAdapter({
        appId: teamsFixtures.botUserId.split(":")[1] || "test-app-id",
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
        await thread.subscribe();
        await thread.post("Welcome!");
      });

      chat.onSubscribedMessage(async (thread, message) => {
        if (message.text.toLowerCase().includes("dm me")) {
          capturedDmRequestMessage = message;
          try {
            const dmThread = await chat.openDM(message.author);
            openDMCalled = true;
            dmThreadId = dmThread.id;
            await dmThread.subscribe();
            await dmThread.post("Hello via DM!");
            await thread.post("I've sent you a DM!");
          } catch (e) {
            await thread.post(`Sorry, couldn't send DM: ${(e as Error).message}`);
          }
        }
      });

      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    it("should handle mention in channel", async () => {
      await chat.webhooks.teams(createTeamsRequest(teamsFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(capturedMentionMessage).not.toBeNull();
      expect(capturedMentionMessage?.text).toContain("Hey");
    });

    it("should handle DM request flow", async () => {
      // Step 1: Initial mention to subscribe (also caches serviceUrl and tenantId)
      await chat.webhooks.teams(createTeamsRequest(teamsFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(capturedMentionMessage).not.toBeNull();
      expect(capturedMentionMessage?.text).toContain("Hey");

      // Step 2: User requests DM in subscribed thread
      await chat.webhooks.teams(createTeamsRequest(teamsFixtures.dmRequest), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(capturedDmRequestMessage).not.toBeNull();
      expect(capturedDmRequestMessage?.text).toContain("dm me");
      expect(openDMCalled).toBe(true);
      expect(dmThreadId).toContain("teams:");

      // Verify createConversationAsync was called to create the DM
      expect(mockBotAdapter.createdConversations).toHaveLength(1);
      expect(mockBotAdapter.createdConversations[0]?.userId).toBe(
        capturedDmRequestMessage?.author.userId,
      );

      // Verify DM message was sent
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining("Hello via DM!"),
        }),
      );

      // Verify confirmation in original thread
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining("I've sent you a DM!"),
        }),
      );
    });

    it("should detect DM conversation type", async () => {
      // Teams DMs have conversation IDs that don't start with "19:"
      const mentionPayload = teamsFixtures.mention;
      expect(mentionPayload.conversation.conversationType).toBe("channel");
      expect(mentionPayload.conversation.id).toContain("19:");
    });
  });
});
