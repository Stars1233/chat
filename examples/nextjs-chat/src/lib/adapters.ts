import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-adapter/gchat";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-adapter/teams";
import { withRecording } from "./recorder";

export type Adapters = {
  slack?: SlackAdapter;
  teams?: TeamsAdapter;
  gchat?: GoogleChatAdapter;
};

// Methods to record for each adapter (outgoing API calls)
const SLACK_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "startTyping",
  "stream",
  "openDM",
  "fetchMessages",
];
const TEAMS_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "startTyping",
  "openDM",
  "fetchMessages",
];
const GCHAT_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "openDM",
  "fetchMessages",
];

/**
 * Build type-safe adapters based on available environment variables.
 * Adapters are only created if their required env vars are present.
 */
export function buildAdapters(): Adapters {
  const adapters: Adapters = {};

  // Slack adapter (optional)
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET) {
    adapters.slack = withRecording(
      createSlackAdapter({
        botToken: process.env.SLACK_BOT_TOKEN,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
      }),
      "slack",
      SLACK_METHODS,
    );
  }

  // Teams adapter (optional)
  if (process.env.TEAMS_APP_ID && process.env.TEAMS_APP_PASSWORD) {
    adapters.teams = withRecording(
      createTeamsAdapter({
        appId: process.env.TEAMS_APP_ID,
        appPassword: process.env.TEAMS_APP_PASSWORD,
        appType: "SingleTenant",
        appTenantId: process.env.TEAMS_APP_TENANT_ID as string,
        userName: "Chat SDK Demo",
      }),
      "teams",
      TEAMS_METHODS,
    );
  }

  // Google Chat adapter (optional)
  if (process.env.GOOGLE_CHAT_CREDENTIALS) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_CHAT_CREDENTIALS);
      adapters.gchat = withRecording(
        createGoogleChatAdapter({
          credentials,
          // Pub/Sub topic for receiving ALL messages (not just @mentions)
          pubsubTopic: process.env.GOOGLE_CHAT_PUBSUB_TOPIC,
          // User email to impersonate for Workspace Events API (domain-wide delegation)
          impersonateUser: process.env.GOOGLE_CHAT_IMPERSONATE_USER,
        }),
        "gchat",
        GCHAT_METHODS,
      );
    } catch {
      console.warn(
        "[chat] Invalid GOOGLE_CHAT_CREDENTIALS JSON, skipping gchat adapter",
      );
    }
  }

  return adapters;
}
