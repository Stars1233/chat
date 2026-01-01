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
} from "@chat-sdk/gchat";
import { createSlackAdapter, type SlackAdapter } from "@chat-sdk/slack";
import { createMemoryState } from "@chat-sdk/state-memory";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-sdk/teams";
import { Chat } from "chat-sdk";
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
    let mockChatApi: MockGoogleChatApi;
    let tracker: ReturnType<typeof createWaitUntilTracker>;

    beforeEach(() => {
      vi.clearAllMocks();
      const gchatAdapter = createGoogleChatAdapter({
        credentials: GCHAT_TEST_CREDENTIALS,
        userName: gchatFixtures.botName,
      });
      mockChatApi = createMockGoogleChatApi();
      injectMockGoogleChatApi(gchatAdapter, mockChatApi);
      chat = new Chat({
        userName: gchatFixtures.botName,
        adapters: { gchat: gchatAdapter },
        state: createMemoryState(),
        logger: "error",
      });
      chat.onNewMention(async (thread) => {
        await thread.subscribe();
        await thread.post("Thanks for mentioning me!");
      });
      chat.onSubscribedMessage(async (thread) => {
        const msg = await thread.post("Processing...");
        await msg.edit("Just a little bit...");
        await msg.edit("Thanks for your message");
      });
      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    it("should replay @mention and follow-up", async () => {
      // Step 1: @mention
      await chat.webhooks.gchat(createGchatRequest(gchatFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
      expect(mockChatApi.sentMessages).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining("Thanks for mentioning me!"),
        }),
      );
      mockChatApi.clearMocks();

      // Step 2: Follow-up via Pub/Sub
      await chat.webhooks.gchat(createGchatRequest(gchatFixtures.followUp), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
      expect(mockChatApi.sentMessages).toContainEqual(
        expect.objectContaining({ text: "Processing..." }),
      );
      expect(mockChatApi.updatedMessages).toContainEqual(
        expect.objectContaining({ text: "Thanks for your message" }),
      );
    });
  });

  describe("Slack", () => {
    let chat: Chat<{ slack: SlackAdapter }>;
    let mockSlackClient: MockSlackClient;
    let tracker: ReturnType<typeof createWaitUntilTracker>;

    beforeEach(() => {
      vi.clearAllMocks();
      const slackAdapter = createSlackAdapter({
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
      chat.onNewMention(async (thread) => {
        await thread.subscribe();
        await thread.post("Thanks for mentioning me!");
      });
      chat.onSubscribedMessage(async (thread) => {
        const msg = await thread.post("Processing...");
        await msg.edit("Just a little bit...");
        await msg.edit("Thanks for your message");
      });
      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    it("should replay @mention and follow-up", async () => {
      // Step 1: @mention
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(slackFixtures.mention)),
        {
          waitUntil: tracker.waitUntil,
        },
      );
      await tracker.waitForAll();
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Thanks for mentioning me!"),
        }),
      );
      vi.clearAllMocks();

      // Step 2: Follow-up
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(slackFixtures.followUp)),
        {
          waitUntil: tracker.waitUntil,
        },
      );
      await tracker.waitForAll();
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Processing..." }),
      );
      expect(mockSlackClient.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Thanks for your message" }),
      );
    });
  });

  describe("Teams", () => {
    let chat: Chat<{ teams: TeamsAdapter }>;
    let mockBotAdapter: MockBotAdapter;
    let tracker: ReturnType<typeof createWaitUntilTracker>;

    beforeEach(() => {
      vi.clearAllMocks();
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
      chat.onNewMention(async (thread) => {
        await thread.subscribe();
        await thread.post("Thanks for mentioning me!");
      });
      chat.onSubscribedMessage(async (thread) => {
        const msg = await thread.post("Processing...");
        await msg.edit("Just a little bit...");
        await msg.edit("Thanks for your message");
      });
      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    it("should replay @mention and follow-up", async () => {
      // Step 1: @mention
      await chat.webhooks.teams(createTeamsRequest(teamsFixtures.mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining("Thanks for mentioning me!"),
        }),
      );
      mockBotAdapter.clearMocks();

      // Step 2: Follow-up
      await chat.webhooks.teams(createTeamsRequest(teamsFixtures.followUp), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({ text: "Processing..." }),
      );
      expect(mockBotAdapter.updatedActivities).toContainEqual(
        expect.objectContaining({ text: "Thanks for your message" }),
      );
    });
  });
});
