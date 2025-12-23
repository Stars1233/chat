/**
 * Shared test scenarios for all adapter integration tests.
 * This ensures consistent behavior testing across Slack, Teams, and Google Chat.
 */

import type { Adapter, Chat } from "chat-sdk";
import type { Mock } from "vitest";
import { expect, vi } from "vitest";

/**
 * Common interface for adapter-specific test context
 */
export interface AdapterTestContext<
  TAdapter extends Adapter<unknown, unknown>,
  TMockClient,
> {
  chat: Chat<Record<string, TAdapter>>;
  adapter: TAdapter;
  mockClient: TMockClient;
  tracker: WaitUntilTracker;
  sendWebhook: (request: Request) => Promise<Response>;
}

/**
 * WaitUntil tracker for capturing and awaiting async operations
 */
export interface WaitUntilTracker {
  waitUntil: (task: Promise<unknown>) => void;
  waitForAll: () => Promise<void>;
}

export function createWaitUntilTracker(): WaitUntilTracker {
  const tasks: Promise<unknown>[] = [];
  return {
    waitUntil: (task: Promise<unknown>) => {
      tasks.push(task);
    },
    waitForAll: async () => {
      await Promise.all(tasks);
      tasks.length = 0;
    },
  };
}

/**
 * Scenario: URL/Event verification
 * Tests that the adapter correctly handles platform-specific verification challenges.
 */
export interface VerificationScenario {
  name: string;
  createRequest: () => Request;
  expectedStatus: number;
  validateResponse?: (response: Response) => Promise<void>;
}

/**
 * Scenario: Basic mention handling
 * Tests that @-mentions trigger the onNewMention handler.
 */
export interface MentionScenario {
  name: string;
  createMentionRequest: (text: string, messageId: string, threadId: string) => Request;
  expectedThreadId: string;
  expectedTextContains: string;
  validatePostMessage: (mock: Mock) => void;
}

/**
 * Scenario: Subscribed thread handling
 * Tests that messages in subscribed threads trigger onSubscribedMessage handler.
 */
export interface SubscriptionScenario {
  name: string;
  createMentionRequest: (text: string, messageId: string, threadId: string) => Request;
  createFollowUpRequest: (text: string, messageId: string, threadId: string) => Request;
  threadId: string;
  validateSubscribedResponse: (mock: Mock, expectedText: string) => void;
}

/**
 * Scenario: Message pattern matching
 * Tests that messages matching patterns trigger handlers.
 */
export interface PatternMatchScenario {
  name: string;
  createMessageRequest: (text: string, messageId: string, threadId: string) => Request;
  pattern: RegExp;
  testText: string;
  validateResponse: (mock: Mock) => void;
}

/**
 * Scenario: Bot message filtering
 * Tests that the adapter correctly ignores the bot's own messages.
 */
export interface BotFilterScenario {
  name: string;
  createBotMessageRequest: (text: string, messageId: string, threadId: string) => Request;
}

/**
 * Scenario: Message editing
 * Tests that sent messages can be edited.
 */
export interface EditScenario {
  name: string;
  createMentionRequest: (text: string, messageId: string, threadId: string) => Request;
  validateEdit: (mock: Mock, expectedText: string) => void;
}

/**
 * Scenario: Multi-message conversation flow
 * Tests a realistic conversation with multiple messages.
 */
export interface ConversationFlowScenario {
  name: string;
  createMentionRequest: (text: string, messageId: string, threadId: string) => Request;
  createMessageRequest: (text: string, messageId: string, threadId: string) => Request;
  threadId: string;
  messages: Array<{
    type: "mention" | "message";
    text: string;
    messageId: string;
    expectedResponse?: string;
    expectEdit?: boolean;
    expectReaction?: boolean;
  }>;
}

/**
 * Scenario: Multiple concurrent threads
 * Tests that multiple threads are handled independently.
 */
export interface ConcurrentThreadsScenario {
  name: string;
  createMentionRequest: (
    text: string,
    messageId: string,
    threadId: string,
    userId: string,
  ) => Request;
  createMessageRequest: (
    text: string,
    messageId: string,
    threadId: string,
    userId: string,
  ) => Request;
  thread1Id: string;
  thread2Id: string;
}

/**
 * Scenario: Error handling - invalid signatures/auth
 */
export interface AuthErrorScenario {
  name: string;
  createInvalidRequest: () => Request;
  expectedStatus: number;
}

/**
 * Standard test runner for mention scenarios
 */
export async function runMentionTest<
  TAdapter extends Adapter<unknown, unknown>,
  TMockClient,
>(
  ctx: AdapterTestContext<TAdapter, TMockClient>,
  scenario: MentionScenario,
  handlers: {
    onMention: (handlerMock: Mock) => void;
  },
): Promise<void> {
  const handlerMock = vi.fn();

  handlers.onMention(handlerMock);

  const request = scenario.createMentionRequest(
    "test mention",
    "msg-001",
    scenario.expectedThreadId,
  );
  const response = await ctx.sendWebhook(request);
  expect(response.status).toBe(200);

  await ctx.tracker.waitForAll();

  expect(handlerMock).toHaveBeenCalled();
  const [threadId, text] = handlerMock.mock.calls[0];
  expect(threadId).toBe(scenario.expectedThreadId);
  expect(text).toContain(scenario.expectedTextContains);
}

/**
 * Standard conversation flow test implementation
 */
export interface ConversationMessage {
  type: "mention" | "message";
  text: string;
  messageId: string;
  expectedResponse?: string;
  expectEdit?: { originalText: string; editedText: string };
  expectReaction?: string;
}

export async function runConversationFlowTest<
  TAdapter extends Adapter<unknown, unknown>,
  TMockClient,
>(
  ctx: AdapterTestContext<TAdapter, TMockClient>,
  threadId: string,
  messages: ConversationMessage[],
  createMentionRequest: (text: string, messageId: string, threadId: string) => Request,
  createMessageRequest: (text: string, messageId: string, threadId: string) => Request,
  getMocks: () => {
    postMessage: Mock;
    updateMessage?: Mock;
    addReaction?: Mock;
  },
  clearMocks: () => void,
): Promise<string[]> {
  const conversationLog: string[] = [];

  for (const msg of messages) {
    const request =
      msg.type === "mention"
        ? createMentionRequest(msg.text, msg.messageId, threadId)
        : createMessageRequest(msg.text, msg.messageId, threadId);

    await ctx.sendWebhook(request);
    await ctx.tracker.waitForAll();

    conversationLog.push(msg.text);

    const mocks = getMocks();

    if (msg.expectedResponse) {
      expect(mocks.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: msg.expectedResponse,
        }),
      );
    }

    if (msg.expectEdit && mocks.updateMessage) {
      expect(mocks.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: msg.expectEdit.originalText,
        }),
      );
      expect(mocks.updateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: msg.expectEdit.editedText,
        }),
      );
    }

    if (msg.expectReaction && mocks.addReaction) {
      expect(mocks.addReaction).toHaveBeenCalled();
    }

    clearMocks();
  }

  return conversationLog;
}
