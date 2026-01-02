/**
 * Replay tests for actions (button clicks) and reactions.
 *
 * These tests replay actual webhook payloads recorded from production
 * to verify the Chat SDK handles button clicks and emoji reactions correctly.
 *
 * Fixtures are loaded from JSON files in fixtures/replay/actions-reactions/
 */

import { createHmac } from "node:crypto";
import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-adapter/gchat";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-adapter/teams";
import { type ActionEvent, Chat, type ReactionEvent } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import gchatFixtures from "../fixtures/replay/actions-reactions/gchat.json";
import slackFixtures from "../fixtures/replay/actions-reactions/slack.json";
import teamsFixtures from "../fixtures/replay/actions-reactions/teams.json";
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

function createSignedSlackRequest(
  body: string,
  contentType = "application/json",
): Request {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sigBasestring = `v0:${timestamp}:${body}`;
  const signature = `v0=${createHmac("sha256", SLACK_SIGNING_SECRET).update(sigBasestring).digest("hex")}`;
  return new Request("https://example.com/webhook/slack", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
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

describe("Replay Tests - Actions & Reactions", () => {
  describe("Slack", () => {
    let chat: Chat<{ slack: SlackAdapter }>;
    let slackAdapter: SlackAdapter;
    let mockSlackClient: MockSlackClient;
    let tracker: ReturnType<typeof createWaitUntilTracker>;

    // Captured events
    let capturedAction: ActionEvent | null = null;
    let capturedReaction: ReactionEvent | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedAction = null;
      capturedReaction = null;

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

      // Subscribe on mention so reactions/actions work
      chat.onNewMention(async (thread) => {
        await thread.subscribe();
      });

      chat.onAction(async (event) => {
        capturedAction = event;
        await event.thread.post(`Action received: ${event.actionId}`);
      });

      chat.onReaction(async (event) => {
        capturedReaction = event;
        await event.thread.post(`Thanks for the ${event.emoji}!`);
      });

      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    it("should handle block_actions button click", async () => {
      // First subscribe via mention
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(slackFixtures.mention)),
        { waitUntil: tracker.waitUntil },
      );
      await tracker.waitForAll();
      vi.clearAllMocks();

      // Send block_actions payload (URL-encoded form)
      const actionBody = `payload=${encodeURIComponent(JSON.stringify(slackFixtures.action))}`;
      await chat.webhooks.slack(
        createSignedSlackRequest(
          actionBody,
          "application/x-www-form-urlencoded",
        ),
        { waitUntil: tracker.waitUntil },
      );
      await tracker.waitForAll();

      // Verify action was captured
      expect(capturedAction).not.toBeNull();
      expect(capturedAction?.actionId).toBe("info");

      // Verify user properties
      expect(capturedAction?.user.userId).toBe("U03STHCA1JM");
      expect(capturedAction?.user.userName).toBe("malte");
      expect(capturedAction?.user.isBot).toBe(false);
      expect(capturedAction?.user.isMe).toBe(false);

      // Verify thread properties
      expect(capturedAction?.thread).toBeDefined();
      expect(capturedAction?.thread.id).toContain("slack:");
      expect(capturedAction?.thread.adapter.name).toBe("slack");
      expect(capturedAction?.thread.channelId).toBe("C0A511MBCUW");
      expect(capturedAction?.thread.isDM).toBe(false);

      // Verify threadId matches thread.id
      expect(capturedAction?.threadId).toBe(capturedAction?.thread.id);

      // Verify messageId is present
      expect(capturedAction?.messageId).toBeDefined();
      expect(capturedAction?.messageId.length).toBeGreaterThan(0);

      // Verify raw event data is preserved
      expect(capturedAction?.raw).toBeDefined();

      // Verify response was sent
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Action received: info"),
        }),
      );
    });

    it("should handle reaction_added event", async () => {
      // First subscribe via mention
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(slackFixtures.mention)),
        { waitUntil: tracker.waitUntil },
      );
      await tracker.waitForAll();
      vi.clearAllMocks();

      // Send reaction event
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(slackFixtures.reaction)),
        { waitUntil: tracker.waitUntil },
      );
      await tracker.waitForAll();

      // Verify reaction was captured
      expect(capturedReaction).not.toBeNull();

      // Verify emoji properties
      expect(capturedReaction?.emoji.name).toBe("thumbs_up");
      expect(capturedReaction?.emoji.toString()).toBe("{{emoji:thumbs_up}}");
      expect(capturedReaction?.rawEmoji).toBe("+1");
      expect(capturedReaction?.added).toBe(true);

      // Verify user properties
      expect(capturedReaction?.user.userId).toBe("U03STHCA1JM");
      expect(capturedReaction?.user.isBot).toBe(false);
      expect(capturedReaction?.user.isMe).toBe(false);

      // Verify thread properties
      expect(capturedReaction?.thread).toBeDefined();
      expect(capturedReaction?.thread.id).toContain("slack:");
      expect(capturedReaction?.thread.adapter.name).toBe("slack");
      expect(capturedReaction?.thread.channelId).toBe("C0A511MBCUW");
      expect(capturedReaction?.thread.isDM).toBe(false);

      // Verify threadId matches thread.id
      expect(capturedReaction?.threadId).toBe(capturedReaction?.thread.id);

      // Verify messageId is present
      expect(capturedReaction?.messageId).toBeDefined();
      expect(capturedReaction?.messageId).toBe("1767326126.896109");

      // Verify raw event data is preserved
      expect(capturedReaction?.raw).toBeDefined();

      // Verify response was sent
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Thanks for the"),
        }),
      );
    });
  });

  describe("Teams", () => {
    let chat: Chat<{ teams: TeamsAdapter }>;
    let mockBotAdapter: MockBotAdapter;
    let tracker: ReturnType<typeof createWaitUntilTracker>;

    // Captured events
    let capturedAction: ActionEvent | null = null;
    let capturedReaction: ReactionEvent | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedAction = null;
      capturedReaction = null;

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

      // Subscribe on mention so reactions/actions work
      chat.onNewMention(async (thread) => {
        await thread.subscribe();
      });

      chat.onAction(async (event) => {
        capturedAction = event;
        await event.thread.post(`Action received: ${event.actionId}`);
      });

      chat.onReaction(async (event) => {
        capturedReaction = event;
        await event.thread.post(`Thanks for the ${event.emoji}!`);
      });

      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    it("should handle adaptive card action submit", async () => {
      // First subscribe via mention
      await chat.webhooks.teams(createTeamsRequest(teamsFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
      mockBotAdapter.clearMocks();

      // Send action payload (Teams sends actions as messages with value)
      await chat.webhooks.teams(createTeamsRequest(teamsFixtures.action), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Verify action was captured
      expect(capturedAction).not.toBeNull();
      expect(capturedAction?.actionId).toBe("info");

      // Verify user properties
      expect(capturedAction?.user.userName).toBe("Malte Ubl");
      expect(capturedAction?.user.userId).toContain("29:");
      expect(capturedAction?.user.isBot).toBe(false);
      expect(capturedAction?.user.isMe).toBe(false);

      // Verify thread properties
      expect(capturedAction?.thread).toBeDefined();
      expect(capturedAction?.thread.id).toContain("teams:");
      expect(capturedAction?.thread.adapter.name).toBe("teams");
      expect(capturedAction?.thread.isDM).toBe(false);

      // Verify threadId matches thread.id
      expect(capturedAction?.threadId).toBe(capturedAction?.thread.id);

      // Verify messageId is present
      expect(capturedAction?.messageId).toBeDefined();

      // Verify raw event data is preserved
      expect(capturedAction?.raw).toBeDefined();

      // Verify response was sent
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining("Action received: info"),
        }),
      );
    });

    it("should handle messageReaction event", async () => {
      // First subscribe via mention
      await chat.webhooks.teams(createTeamsRequest(teamsFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
      mockBotAdapter.clearMocks();

      // Send reaction event
      await chat.webhooks.teams(createTeamsRequest(teamsFixtures.reaction), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Verify reaction was captured
      expect(capturedReaction).not.toBeNull();

      // Verify emoji properties
      expect(capturedReaction?.emoji.name).toBe("thumbs_up");
      expect(capturedReaction?.emoji.toString()).toBe("{{emoji:thumbs_up}}");
      expect(capturedReaction?.rawEmoji).toBe("like");
      expect(capturedReaction?.added).toBe(true);

      // Verify user properties
      expect(capturedReaction?.user.userId).toContain("29:");
      expect(capturedReaction?.user.isBot).toBe(false);
      expect(capturedReaction?.user.isMe).toBe(false);

      // Verify thread properties
      expect(capturedReaction?.thread).toBeDefined();
      expect(capturedReaction?.thread.id).toContain("teams:");
      expect(capturedReaction?.thread.adapter.name).toBe("teams");
      expect(capturedReaction?.thread.isDM).toBe(false);

      // Verify threadId matches thread.id
      expect(capturedReaction?.threadId).toBe(capturedReaction?.thread.id);

      // Verify raw event data is preserved
      expect(capturedReaction?.raw).toBeDefined();

      // Verify response was sent
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining("Thanks for the"),
        }),
      );
    });
  });

  describe("Google Chat", () => {
    let chat: Chat<{ gchat: GoogleChatAdapter }>;
    let gchatAdapter: GoogleChatAdapter;
    let mockChatApi: MockGoogleChatApi;
    let tracker: ReturnType<typeof createWaitUntilTracker>;

    // Captured events
    let capturedReaction: ReactionEvent | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedReaction = null;

      gchatAdapter = createGoogleChatAdapter({
        credentials: GCHAT_TEST_CREDENTIALS,
        userName: gchatFixtures.botName,
      });
      gchatAdapter.botUserId = gchatFixtures.botUserId;

      mockChatApi = createMockGoogleChatApi();
      injectMockGoogleChatApi(gchatAdapter, mockChatApi);

      chat = new Chat({
        userName: gchatFixtures.botName,
        adapters: { gchat: gchatAdapter },
        state: createMemoryState(),
        logger: "error",
      });

      // Subscribe on mention so reactions work
      chat.onNewMention(async (thread) => {
        await thread.subscribe();
      });

      chat.onReaction(async (event) => {
        capturedReaction = event;
        await event.thread.post(`Thanks for the ${event.emoji}!`);
      });

      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    it("should handle reaction via Pub/Sub", async () => {
      // First subscribe via mention
      await chat.webhooks.gchat(createGchatRequest(gchatFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
      mockChatApi.clearMocks();

      // Send reaction via Pub/Sub
      await chat.webhooks.gchat(createGchatRequest(gchatFixtures.reaction), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Verify reaction was captured
      expect(capturedReaction).not.toBeNull();

      // Verify emoji properties
      expect(capturedReaction?.emoji.name).toBe("thumbs_up");
      expect(capturedReaction?.emoji.toString()).toBe("{{emoji:thumbs_up}}");
      expect(capturedReaction?.rawEmoji).toBe("👍");
      expect(capturedReaction?.added).toBe(true);

      // Verify user properties
      expect(capturedReaction?.user.userId).toBe("users/117994873354375860089");
      expect(capturedReaction?.user.isBot).toBe(false);
      expect(capturedReaction?.user.isMe).toBe(false);

      // Verify thread properties
      expect(capturedReaction?.thread).toBeDefined();
      expect(capturedReaction?.thread.id).toContain("gchat:");
      expect(capturedReaction?.thread.adapter.name).toBe("gchat");

      // Verify threadId matches thread.id
      expect(capturedReaction?.threadId).toBe(capturedReaction?.thread.id);

      // Verify messageId is present
      expect(capturedReaction?.messageId).toBeDefined();
      expect(capturedReaction?.messageId).toContain("messages/");

      // Verify raw event data is preserved
      expect(capturedReaction?.raw).toBeDefined();

      // Verify response was sent
      expect(mockChatApi.sentMessages).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining("Thanks for the"),
        }),
      );
    });
  });
});
