/**
 * Slack-specific format conversion using AST-based parsing.
 *
 * Slack uses "mrkdwn" format which is similar but not identical to markdown:
 * - Bold: *text* (not **text**)
 * - Italic: _text_ (same)
 * - Strikethrough: ~text~ (not ~~text~~)
 * - Links: <url|text> (not [text](url))
 * - User mentions: <@U123>
 * - Channel mentions: <#C123|name>
 */

import {
  BaseFormatConverter,
  type Code,
  type Content,
  type Delete,
  type Emphasis,
  type InlineCode,
  type Link,
  type Paragraph,
  parseMarkdown,
  type PostableMessage,
  type Root,
  type Strong,
  type Text,
} from "chat-sdk";

export class SlackFormatConverter extends BaseFormatConverter {
  /**
   * Convert @mentions to Slack format in plain text.
   * @name → <@name>
   */
  private convertMentionsToSlack(text: string): string {
    return text.replace(/@(\w+)/g, "<@$1>");
  }

  /**
   * Override renderPostable to convert @mentions in plain strings.
   */
  override renderPostable(message: PostableMessage): string {
    if (typeof message === "string") {
      return this.convertMentionsToSlack(message);
    }
    if ("raw" in message) {
      return this.convertMentionsToSlack(message.raw);
    }
    if ("markdown" in message) {
      return this.fromAst(parseMarkdown(message.markdown));
    }
    if ("ast" in message) {
      return this.fromAst(message.ast);
    }
    return "";
  }

  /**
   * Render an AST to Slack mrkdwn format.
   */
  fromAst(ast: Root): string {
    const parts: string[] = [];

    for (const node of ast.children) {
      parts.push(this.nodeToMrkdwn(node as Content));
    }

    return parts.join("\n\n");
  }

  /**
   * Parse Slack mrkdwn into an AST.
   */
  toAst(mrkdwn: string): Root {
    // Convert Slack mrkdwn to standard markdown string, then parse
    let markdown = mrkdwn;

    // User mentions: <@U123|name> -> @name or <@U123> -> @U123
    markdown = markdown.replace(/<@([^|>]+)\|([^>]+)>/g, "@$2");
    markdown = markdown.replace(/<@([^>]+)>/g, "@$1");

    // Channel mentions: <#C123|name> -> #name
    markdown = markdown.replace(/<#[^|>]+\|([^>]+)>/g, "#$1");
    markdown = markdown.replace(/<#([^>]+)>/g, "#$1");

    // Links: <url|text> -> [text](url)
    markdown = markdown.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "[$2]($1)");

    // Bare links: <url> -> url
    markdown = markdown.replace(/<(https?:\/\/[^>]+)>/g, "$1");

    // Bold: *text* -> **text** (but be careful with emphasis)
    // This is tricky because Slack uses * for bold, not emphasis
    markdown = markdown.replace(/(?<![_*\\])\*([^*\n]+)\*(?![_*])/g, "**$1**");

    // Strikethrough: ~text~ -> ~~text~~
    markdown = markdown.replace(/(?<!~)~([^~\n]+)~(?!~)/g, "~~$1~~");

    return parseMarkdown(markdown);
  }

  private nodeToMrkdwn(node: Content): string {
    switch (node.type) {
      case "paragraph":
        return (node as Paragraph).children
          .map((child) => this.nodeToMrkdwn(child as Content))
          .join("");

      case "text": {
        // Convert @mentions to Slack format <@mention>
        const textValue = (node as Text).value;
        return textValue.replace(/@(\w+)/g, "<@$1>");
      }

      case "strong":
        // Markdown **text** -> Slack *text*
        return `*${(node as Strong).children
          .map((child) => this.nodeToMrkdwn(child as Content))
          .join("")}*`;

      case "emphasis":
        // Both use _text_
        return `_${(node as Emphasis).children
          .map((child) => this.nodeToMrkdwn(child as Content))
          .join("")}_`;

      case "delete":
        // Markdown ~~text~~ -> Slack ~text~
        return `~${(node as Delete).children
          .map((child) => this.nodeToMrkdwn(child as Content))
          .join("")}~`;

      case "inlineCode":
        return `\`${(node as InlineCode).value}\``;

      case "code": {
        const codeNode = node as Code;
        return `\`\`\`${codeNode.lang || ""}\n${codeNode.value}\n\`\`\``;
      }

      case "link": {
        const linkNode = node as Link;
        const linkText = linkNode.children
          .map((child) => this.nodeToMrkdwn(child as Content))
          .join("");
        // Markdown [text](url) -> Slack <url|text>
        return `<${linkNode.url}|${linkText}>`;
      }

      case "blockquote":
        return node.children
          .map((child) => `> ${this.nodeToMrkdwn(child as Content)}`)
          .join("\n");

      case "list":
        return node.children
          .map((item, i) => {
            const prefix = node.ordered ? `${i + 1}.` : "•";
            const content = item.children
              .map((child) => this.nodeToMrkdwn(child as Content))
              .join("");
            return `${prefix} ${content}`;
          })
          .join("\n");

      case "listItem":
        return node.children
          .map((child) => this.nodeToMrkdwn(child as Content))
          .join("");

      case "break":
        return "\n";

      case "thematicBreak":
        return "---";

      default:
        // For unsupported nodes, try to extract text
        if ("children" in node && Array.isArray(node.children)) {
          return node.children
            .map((child) => this.nodeToMrkdwn(child as Content))
            .join("");
        }
        if ("value" in node) {
          return String(node.value);
        }
        return "";
    }
  }
}

// Backwards compatibility alias
export { SlackFormatConverter as SlackMarkdownConverter };
