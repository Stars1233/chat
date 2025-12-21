/**
 * Teams test utilities for creating mock adapters, activities, and webhook requests.
 */

import { vi } from "vitest";
import type { TeamsAdapter } from "@chat-sdk/teams";

export const TEAMS_APP_ID = "test-app-id";
export const TEAMS_APP_PASSWORD = "test-app-password";
export const TEAMS_BOT_ID = "28:bot-id-123";
export const TEAMS_BOT_NAME = "TestBot";

/**
 * Options for creating a Teams activity
 */
export interface TeamsActivityOptions {
  type?: string;
  text: string;
  messageId: string;
  conversationId: string;
  serviceUrl?: string;
  fromId: string;
  fromName: string;
  isFromBot?: boolean;
  recipientId?: string;
  recipientName?: string;
  mentions?: Array<{ id: string; name: string; text: string }>;
  timestamp?: string;
  replyToId?: string;
}

/**
 * Create a realistic Teams Bot Framework Activity payload
 */
export function createTeamsActivity(options: TeamsActivityOptions) {
  const {
    type = "message",
    text,
    messageId,
    conversationId,
    serviceUrl = "https://smba.trafficmanager.net/teams/",
    fromId,
    fromName,
    isFromBot = false,
    recipientId = TEAMS_BOT_ID,
    recipientName = TEAMS_BOT_NAME,
    mentions = [],
    timestamp = new Date().toISOString(),
    replyToId,
  } = options;

  // Build entities from mentions
  const entities = mentions.map((m) => ({
    type: "mention",
    mentioned: {
      id: m.id,
      name: m.name,
    },
    text: m.text,
  }));

  return {
    type,
    id: messageId,
    timestamp,
    localTimestamp: timestamp,
    channelId: "msteams",
    serviceUrl,
    from: {
      id: fromId,
      name: fromName,
      aadObjectId: `aad-${fromId}`,
      role: isFromBot ? "bot" : "user",
    },
    conversation: {
      id: conversationId,
      conversationType: "personal",
      tenantId: "tenant-123",
    },
    recipient: {
      id: recipientId,
      name: recipientName,
    },
    text,
    textFormat: "plain",
    locale: "en-US",
    entities: entities.length > 0 ? entities : undefined,
    channelData: {
      tenant: { id: "tenant-123" },
    },
    replyToId,
  };
}

/**
 * Create a Teams webhook request with Bot Framework format
 */
export function createTeamsWebhookRequest(
  activity: ReturnType<typeof createTeamsActivity>,
): Request {
  const body = JSON.stringify(activity);

  return new Request("https://example.com/api/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body,
  });
}

/**
 * Create mock Bot Framework CloudAdapter
 */
export function createMockBotAdapter() {
  const sentActivities: unknown[] = [];
  const updatedActivities: unknown[] = [];
  const deletedActivities: string[] = [];

  // Create reusable mock context factory
  const createMockContext = (activity: unknown) => ({
    activity,
    sendActivity: vi.fn(async (act: unknown) => {
      sentActivities.push(act);
      return { id: `response-${Date.now()}` };
    }),
    updateActivity: vi.fn(async (act: unknown) => {
      updatedActivities.push(act);
    }),
    deleteActivity: vi.fn(async (id: string) => {
      deletedActivities.push(id);
    }),
  });

  return {
    sentActivities,
    updatedActivities,
    deletedActivities,
    // Mock the process method - called during webhook handling
    process: vi.fn(
      (
        req: { body: unknown },
        res: { status: (code: number) => { end: () => void; send: (data?: string) => void } },
        handler: (context: unknown) => Promise<void>,
      ) => {
        const activity = req.body;
        const mockContext = createMockContext(activity);

        handler(mockContext)
          .then(() => {
            res.status(200).end();
          })
          .catch((err) => {
            console.error("Handler error:", err);
            res.status(500).end();
          });
      },
    ),
    // Mock continueConversationAsync - called for posting messages
    continueConversationAsync: vi.fn(
      async (
        _appId: string,
        _ref: unknown,
        handler: (context: unknown) => Promise<void>,
      ) => {
        const mockContext = createMockContext({});
        await handler(mockContext);
      },
    ),
    clearMocks: () => {
      sentActivities.length = 0;
      updatedActivities.length = 0;
      deletedActivities.length = 0;
    },
  };
}

export type MockBotAdapter = ReturnType<typeof createMockBotAdapter>;

/**
 * Inject mock bot adapter into Teams adapter
 */
export function injectMockBotAdapter(
  adapter: TeamsAdapter,
  mockAdapter: MockBotAdapter,
): void {
  // biome-ignore lint/suspicious/noExplicitAny: accessing private field for testing
  (adapter as any).botAdapter = mockAdapter;
}

/**
 * Get expected Teams thread ID format
 */
export function getTeamsThreadId(conversationId: string, serviceUrl: string): string {
  const encodedConversationId = Buffer.from(conversationId).toString("base64url");
  const encodedServiceUrl = Buffer.from(serviceUrl).toString("base64url");
  return `teams:${encodedConversationId}:${encodedServiceUrl}`;
}

/**
 * Default Teams service URL for testing
 */
export const DEFAULT_TEAMS_SERVICE_URL = "https://smba.trafficmanager.net/teams/";
