import { createRedisState } from "@chat-sdk/state-redis";
import { Chat } from "chat-sdk";
import { buildAdapters } from "./adapters";

const state = createRedisState({ url: process.env.REDIS_URL! });
const adapters = buildAdapters();

// Create the bot instance
export const bot = new Chat({
  userName: process.env.BOT_USERNAME || "mybot",
  adapters,
  state,
  logger: "debug",
});

// Handle new @mentions of the bot
bot.onNewMention(async (thread, _message) => {
  await thread.subscribe();
  await thread.startTyping();
  await thread.post(
    `Thanks for mentioning me! I'm now listening to this thread.\n\n` +
      `_Connected via ${thread.adapter.name}_`
  );
});

// Handle messages in subscribed threads
bot.onSubscribed(async (thread, message) => {
  await thread.startTyping();
  const response = await thread.post(
    `You said: "${message.text}"\n\n_via ${thread.adapter.name}_`
  );
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
      `• Active platforms: ${platforms}`
  );
});
