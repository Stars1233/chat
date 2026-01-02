import type { Root } from "mdast";
import {
  paragraph,
  parseMarkdown,
  root,
  text as textNode,
  toPlainText,
} from "./markdown";
import type {
  Adapter,
  Attachment,
  Message,
  PostableMessage,
  SentMessage,
  StateAdapter,
  Thread,
} from "./types";

interface ThreadImplConfig {
  id: string;
  adapter: Adapter;
  channelId: string;
  state: StateAdapter;
  initialMessage?: Message;
  /** If true, thread is known to be subscribed (for short-circuit optimization) */
  isSubscribedContext?: boolean;
  /** Whether this is a direct message conversation */
  isDM?: boolean;
}

export class ThreadImpl implements Thread {
  readonly id: string;
  readonly adapter: Adapter;
  readonly channelId: string;
  readonly isDM: boolean;

  private state: StateAdapter;
  private _recentMessages: Message[] = [];
  private _isSubscribedContext: boolean;

  constructor(config: ThreadImplConfig) {
    this.id = config.id;
    this.adapter = config.adapter;
    this.channelId = config.channelId;
    this.isDM = config.isDM ?? false;
    this.state = config.state;
    this._isSubscribedContext = config.isSubscribedContext ?? false;

    if (config.initialMessage) {
      this._recentMessages = [config.initialMessage];
    }
  }

  get recentMessages(): Message[] {
    return this._recentMessages;
  }

  set recentMessages(messages: Message[]) {
    this._recentMessages = messages;
  }

  get allMessages(): AsyncIterable<Message> {
    const adapter = this.adapter;
    const threadId = this.id;

    return {
      async *[Symbol.asyncIterator]() {
        let before: string | undefined;
        let hasMore = true;

        while (hasMore) {
          const messages = await adapter.fetchMessages(threadId, {
            limit: 100,
            before,
          });

          if (messages.length === 0) {
            hasMore = false;
            break;
          }

          for (const message of messages) {
            yield message;
          }

          before = messages[messages.length - 1]?.id;

          // If we got fewer than requested, we've reached the end
          if (messages.length < 100) {
            hasMore = false;
          }
        }
      },
    };
  }

  async isSubscribed(): Promise<boolean> {
    // Short-circuit if we know we're in a subscribed context
    if (this._isSubscribedContext) {
      return true;
    }
    return this.state.isSubscribed(this.id);
  }

  async subscribe(): Promise<void> {
    await this.state.subscribe(this.id);
    // Allow adapters to set up platform-specific subscriptions
    if (this.adapter.onThreadSubscribe) {
      await this.adapter.onThreadSubscribe(this.id);
    }
  }

  async unsubscribe(): Promise<void> {
    await this.state.unsubscribe(this.id);
  }

  async post(message: string | PostableMessage): Promise<SentMessage> {
    const rawMessage = await this.adapter.postMessage(this.id, message);

    // Create a SentMessage with edit/delete capabilities
    return this.createSentMessage(rawMessage.id, message);
  }

  async startTyping(): Promise<void> {
    await this.adapter.startTyping(this.id);
  }

  async refresh(): Promise<void> {
    const messages = await this.adapter.fetchMessages(this.id, { limit: 50 });
    this._recentMessages = messages;
  }

  mentionUser(userId: string): string {
    return `<@${userId}>`;
  }

  private createSentMessage(
    messageId: string,
    postable: PostableMessage,
  ): SentMessage {
    const adapter = this.adapter;
    const threadId = this.id;
    const self = this;

    // Extract text and AST from the PostableMessage
    const { plainText, formatted, attachments } =
      extractMessageContent(postable);

    const sentMessage: SentMessage = {
      id: messageId,
      threadId,
      text: plainText,
      formatted,
      raw: null, // Will be populated if needed
      author: {
        userId: "self",
        userName: adapter.userName,
        fullName: adapter.userName,
        isBot: true,
        isMe: true,
      },
      metadata: {
        dateSent: new Date(),
        edited: false,
      },
      attachments,

      async edit(newContent: string | PostableMessage): Promise<SentMessage> {
        await adapter.editMessage(threadId, messageId, newContent);
        return self.createSentMessage(messageId, newContent);
      },

      async delete(): Promise<void> {
        await adapter.deleteMessage(threadId, messageId);
      },

      async addReaction(emoji: string): Promise<void> {
        await adapter.addReaction(threadId, messageId, emoji);
      },

      async removeReaction(emoji: string): Promise<void> {
        await adapter.removeReaction(threadId, messageId, emoji);
      },
    };

    return sentMessage;
  }
}

/**
 * Extract plain text, AST, and attachments from a PostableMessage.
 */
function extractMessageContent(message: PostableMessage): {
  plainText: string;
  formatted: Root;
  attachments: Attachment[];
} {
  if (typeof message === "string") {
    // Raw string - create simple AST
    return {
      plainText: message,
      formatted: root([paragraph([textNode(message)])]),
      attachments: [],
    };
  }

  if ("raw" in message) {
    // Raw text - create simple AST
    return {
      plainText: message.raw,
      formatted: root([paragraph([textNode(message.raw)])]),
      attachments: message.attachments || [],
    };
  }

  if ("markdown" in message) {
    // Markdown - parse to AST
    const ast = parseMarkdown(message.markdown);
    return {
      plainText: toPlainText(ast),
      formatted: ast,
      attachments: message.attachments || [],
    };
  }

  if ("ast" in message) {
    // AST provided directly
    return {
      plainText: toPlainText(message.ast),
      formatted: message.ast,
      attachments: message.attachments || [],
    };
  }

  // Should never reach here with proper typing
  throw new Error("Invalid PostableMessage format");
}
