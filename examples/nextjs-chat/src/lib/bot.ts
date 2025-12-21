import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-sdk/gchat";
import { createSlackAdapter, type SlackAdapter } from "@chat-sdk/slack";
import { createMemoryState } from "@chat-sdk/state-memory";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-sdk/teams";
import { Chat } from "chat-sdk";

// import { createRedisState } from "@chat-sdk/state-redis";

// For development, use memory state
// For production, use Redis:
// const state = createRedisState({ url: process.env.REDIS_URL! });
const state = createMemoryState();

// Build type-safe adapters based on available environment variables
function buildAdapters() {
  const adapters: {
    slack?: SlackAdapter;
    teams?: TeamsAdapter;
    gchat?: GoogleChatAdapter;
  } = {};

  // Slack adapter
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET) {
    adapters.slack = createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
    });
  }

  // Teams adapter
  if (process.env.TEAMS_APP_ID && process.env.TEAMS_APP_PASSWORD) {
    adapters.teams = createTeamsAdapter({
      appId: process.env.TEAMS_APP_ID,
      appPassword: process.env.TEAMS_APP_PASSWORD,
    });
  }

  // Google Chat adapter
  if (process.env.GOOGLE_CHAT_CREDENTIALS) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_CHAT_CREDENTIALS);
      adapters.gchat = createGoogleChatAdapter({ credentials });
    } catch (e) {
      console.warn("[bot] Failed to parse GOOGLE_CHAT_CREDENTIALS:", e);
    }
  }

  return adapters;
}

const adapters = buildAdapters();

// Create the bot instance
// Initialization is lazy - no need to call initialize() manually
export const bot = new Chat({
  userName: process.env.BOT_USERNAME || "mybot",
  adapters,
  state,
  // Use "debug" in development, "info" in production, or "silent" to disable
  logger: process.env.NODE_ENV === "development" ? "debug" : "info",
});

// Handle new @mentions of the bot (works across all platforms)
bot.onNewMention(async (thread, _message) => {
  // Subscribe to follow-up messages in this thread
  await thread.subscribe();

  // Show typing indicator
  await thread.startTyping();

  // Respond to the mention
  await thread.post(
    `Thanks for mentioning me! I'm now listening to this thread.\n\n` +
      `_Connected via ${thread.adapter.name}_`,
  );
});

// Handle messages in subscribed threads (works across all platforms)
bot.onSubscribed(async (thread, message) => {
  // Show typing indicator
  await thread.startTyping();

  // Echo back with platform info
  const response = await thread.post(
    `You said: "${message.text}"\n\n_via ${thread.adapter.name}_`,
  );

  // Add a reaction to our own message (if supported)
  try {
    await response.addReaction("robot_face");
  } catch {
    // Reactions might not be supported on all platforms
  }
});

// Handle messages matching a pattern
bot.onNewMessage(/help/i, async (thread, message) => {
  const platforms = Object.keys(adapters).join(", ") || "none configured";

  await thread.post(
    `Hi ${message.author.userName}! Here's how I can help:\n\n` +
      `• **Mention me** to start a conversation\n` +
      `• I'll respond to messages in threads where I'm mentioned\n` +
      `• Active platforms: ${platforms}`,
  );
});
