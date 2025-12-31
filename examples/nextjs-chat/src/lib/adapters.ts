import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-sdk/gchat";
import { createSlackAdapter, type SlackAdapter } from "@chat-sdk/slack";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-sdk/teams";

export type Adapters = {
  slack?: SlackAdapter;
  teams?: TeamsAdapter;
  gchat?: GoogleChatAdapter;
};

/**
 * Build type-safe adapters based on available environment variables.
 */
export function buildAdapters(): Adapters {
  const adapters: Adapters = {};

  // Slack adapter
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_SIGNING_SECRET) {
    throw new Error("SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are required");
  }
  adapters.slack = createSlackAdapter({
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  });

  // Teams adapter
  if (!process.env.TEAMS_APP_ID || !process.env.TEAMS_APP_PASSWORD) {
    throw new Error("TEAMS_APP_ID and TEAMS_APP_PASSWORD are required");
  }
  adapters.teams = createTeamsAdapter({
    appId: process.env.TEAMS_APP_ID,
    appPassword: process.env.TEAMS_APP_PASSWORD,
    appType: "SingleTenant",
    appTenantId: process.env.TEAMS_APP_TENANT_ID as string,
    userName: "Chat SDK Demo",
  });

  // Google Chat adapter
  if (!process.env.GOOGLE_CHAT_CREDENTIALS) {
    throw new Error("GOOGLE_CHAT_CREDENTIALS is required");
  }
  const credentials = JSON.parse(process.env.GOOGLE_CHAT_CREDENTIALS);
  adapters.gchat = createGoogleChatAdapter({
    credentials,
    // Pub/Sub topic for receiving ALL messages (not just @mentions)
    pubsubTopic: process.env.GOOGLE_CHAT_PUBSUB_TOPIC,
    // User email to impersonate for Workspace Events API (domain-wide delegation)
    impersonateUser: process.env.GOOGLE_CHAT_IMPERSONATE_USER,
  });

  return adapters;
}
