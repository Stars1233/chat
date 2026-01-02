/** @jsxImportSource chat */
// @ts-nocheck - TypeScript doesn't understand custom JSX runtimes with per-file pragmas
import { createRedisState } from "@chat-adapter/state-redis";
import {
  Actions,
  Button,
  Card,
  Chat,
  Divider,
  emoji,
  Field,
  Fields,
  Section,
  CardText as Text,
} from "chat";
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

  // Send a rich card with action buttons using JSX syntax
  await thread.post(
    <Card
      title={`${emoji.wave} Welcome!`}
      subtitle={`Connected via ${thread.adapter.name}`}
    >
      <Text>I'm now listening to this thread. Try these actions:</Text>
      <Divider />
      <Fields>
        <Field label="DM Support" value={thread.isDM ? "Yes" : "No"} />
        <Field label="Platform" value={thread.adapter.name} />
      </Fields>
      <Divider />
      <Actions>
        <Button id="hello" style="primary">
          Say Hello
        </Button>
        <Button id="info">Show Info</Button>
        <Button id="goodbye" style="danger">
          Goodbye
        </Button>
      </Actions>
    </Card>,
  );
});

// Handle card button actions
bot.onAction("hello", async (event) => {
  await event.thread.post(`${emoji.wave} Hello, ${event.user.fullName}!`);
});

bot.onAction("info", async (event) => {
  await event.thread.post(
    <Card title="Bot Information">
      <Fields>
        <Field label="User" value={event.user.fullName} />
        <Field label="User ID" value={event.user.userId} />
        <Field label="Platform" value={event.adapter.name} />
        <Field label="Thread ID" value={event.threadId} />
      </Fields>
    </Card>,
  );
});

bot.onAction("goodbye", async (event) => {
  await event.thread.post(
    `${emoji.wave} Goodbye, ${event.user.fullName}! See you later.`,
  );
});

// Helper to delay execution
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Handle messages matching a pattern
bot.onNewMessage(/help/i, async (thread, message) => {
  const platforms = Object.keys(adapters).join(", ") || "none configured";
  await thread.post(
    <Card title={`${emoji.question} Help`}>
      <Text>{`Hi ${message.author.userName}! Here's how I can help:`}</Text>
      <Divider />
      <Section>
        <Text>{`${emoji.star} **Mention me** to start a conversation`}</Text>
        <Text>{`${emoji.eyes} I'll respond to messages in threads where I'm mentioned`}</Text>
        <Text>{`${emoji.fire} React to my messages and I'll react back!`}</Text>
        <Text>{`${emoji.rocket} Active platforms: ${platforms}`}</Text>
      </Section>
    </Card>,
  );
});

// Handle messages in subscribed threads
bot.onSubscribedMessage(async (thread, message) => {
  // Check if user wants a DM
  if (/^dm\s*me$/i.test(message.text.trim())) {
    try {
      const dmThread = await bot.openDM(message.author);
      await dmThread.post(
        <Card title={`${emoji.speech_bubble} Private Message`}>
          <Text>{`Hi ${message.author.fullName}! You requested a DM from the thread.`}</Text>
          <Divider />
          <Text>This is a private conversation between us.</Text>
        </Card>,
      );
      await thread.post(`${emoji.check} I've sent you a DM!`);
    } catch (err) {
      await thread.post(
        `${emoji.warning} Sorry, I couldn't send you a DM. Error: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
    return;
  }

  // Check if message has attachments
  if (message.attachments && message.attachments.length > 0) {
    const attachmentInfo = message.attachments
      .map(
        (a) =>
          `- ${a.name || "unnamed"} (${a.type}, ${a.mimeType || "unknown"})`,
      )
      .join("\n");

    await thread.post(
      <Card title={`${emoji.eyes} Attachments Received`}>
        <Text>{`You sent ${message.attachments.length} file(s):`}</Text>
        <Text>{attachmentInfo}</Text>
      </Card>,
    );
    return;
  }

  // Default response for other messages
  await thread.startTyping();
  await delay(1000);
  const response = await thread.post(`${emoji.thinking} Processing...`);
  await delay(2000);
  await response.edit(`${emoji.eyes} Just a little bit...`);
  await delay(1000);
  await response.edit(`${emoji.check} Thanks for your message!`);
});

// Handle emoji reactions - respond with a matching emoji or message
bot.onReaction(["thumbs_up", "heart", "fire", "rocket"], async (event) => {
  // Only respond to added reactions, not removed ones
  if (!event.added) return;

  // GChat and Teams bots cannot add reactions via their APIs
  // Respond with a message instead
  if (event.adapter.name === "gchat" || event.adapter.name === "teams") {
    await event.adapter.postMessage(
      event.threadId,
      `Thanks for the ${event.rawEmoji}!`,
    );
    return;
  }

  // React to the same message with the same emoji
  // Adapters auto-convert normalized emoji to platform-specific format
  await event.adapter.addReaction(
    event.threadId,
    event.messageId,
    emoji.raised_hands,
  );
});
