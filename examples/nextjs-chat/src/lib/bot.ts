import { createRedisState } from "@chat-sdk/state-redis";
import { Chat } from "chat-sdk";
import { buildAdapters } from "./adapters";

const state = createRedisState({ url: process.env.REDIS_URL || "" });
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
      `_Connected via ${thread.adapter.name}_`,
  );
});

// Helper to delay execution
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Handle messages in subscribed threads
bot.onSubscribedMessage(async (thread, _message) => {
  // Start with typing indicator
  await thread.startTyping();

  // After 1 second, post "Processing..."
  await delay(1000);
  const response = await thread.post("Processing...");

  // After 2 more seconds, edit to "Just a little bit..."
  await delay(2000);
  await response.edit("Just a little bit...");

  // After 1 more second, edit to final message
  await delay(1000);
  await response.edit("Thanks for your message");
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

// Handle emoji reactions - respond with a matching emoji or message
bot.onReaction(["thumbs_up", "heart", "fire", "rocket"], async (event) => {
  // Only respond to added reactions, not removed ones
  if (!event.added) return;

  // GChat bots cannot add reactions via service account auth (API limitation)
  // Respond with a message instead
  if (event.adapter.name === "gchat") {
    await event.adapter.postMessage(
      event.threadId,
      `Thanks for the ${event.rawEmoji}!`,
    );
    return;
  }

  // React to the same message with the same emoji
  // Adapters auto-convert normalized emoji to platform-specific format
  await event.adapter.addReaction(event.threadId, event.messageId, event.emoji);
});
