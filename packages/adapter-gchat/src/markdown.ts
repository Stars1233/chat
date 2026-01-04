/**
 * Google Chat-specific format conversion using AST-based parsing.
 *
 * Google Chat supports a subset of text formatting:
 * - Bold: *text*
 * - Italic: _text_
 * - Strikethrough: ~text~
 * - Monospace: `text`
 * - Code blocks: ```text```
 * - Links are auto-detected
 *
 * Very similar to Slack's mrkdwn format.
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
  type Root,
  type Strong,
  type Text,
} from "chat";

export class GoogleChatFormatConverter extends BaseFormatConverter {
  /**
   * Render an AST to Google Chat format.
   */
  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) => this.nodeToGChat(node));
  }

  /**
   * Parse Google Chat message into an AST.
   */
  toAst(gchatText: string): Root {
    // Convert Google Chat format to standard markdown, then parse
    let markdown = gchatText;

    // Bold: *text* -> **text**
    markdown = markdown.replace(/(?<![_*\\])\*([^*\n]+)\*(?![_*])/g, "**$1**");

    // Strikethrough: ~text~ -> ~~text~~
    markdown = markdown.replace(/(?<!~)~([^~\n]+)~(?!~)/g, "~~$1~~");

    // Italic and code are the same format as markdown

    return parseMarkdown(markdown);
  }

  private nodeToGChat(node: Content): string {
    switch (node.type) {
      case "paragraph":
        return (node as Paragraph).children
          .map((child) => this.nodeToGChat(child as Content))
          .join("");

      case "text": {
        // Google Chat: @mentions are passed through as-is
        // To create clickable mentions in Google Chat, you'd need to use <users/{user_id}> format
        // which requires user ID lookup - beyond the scope of format conversion
        return (node as Text).value;
      }

      case "strong":
        // Markdown **text** -> GChat *text*
        return `*${(node as Strong).children
          .map((child) => this.nodeToGChat(child as Content))
          .join("")}*`;

      case "emphasis":
        // Both use _text_
        return `_${(node as Emphasis).children
          .map((child) => this.nodeToGChat(child as Content))
          .join("")}_`;

      case "delete":
        // Markdown ~~text~~ -> GChat ~text~
        return `~${(node as Delete).children
          .map((child) => this.nodeToGChat(child as Content))
          .join("")}~`;

      case "inlineCode":
        return `\`${(node as InlineCode).value}\``;

      case "code": {
        const codeNode = node as Code;
        return `\`\`\`\n${codeNode.value}\n\`\`\``;
      }

      case "link": {
        // Google Chat auto-detects links, so we just output the URL
        const linkNode = node as Link;
        const linkText = linkNode.children
          .map((child) => this.nodeToGChat(child as Content))
          .join("");
        // If link text matches URL, just output URL
        if (linkText === linkNode.url) {
          return linkNode.url;
        }
        // Otherwise output "text (url)"
        return `${linkText} (${linkNode.url})`;
      }

      case "blockquote":
        // Google Chat doesn't have native blockquote, use > prefix
        return node.children
          .map((child) => `> ${this.nodeToGChat(child as Content)}`)
          .join("\n");

      case "list":
        return node.children
          .map((item, i) => {
            const prefix = node.ordered ? `${i + 1}.` : "•";
            const content = item.children
              .map((child) => this.nodeToGChat(child as Content))
              .join("");
            return `${prefix} ${content}`;
          })
          .join("\n");

      case "listItem":
        return node.children
          .map((child) => this.nodeToGChat(child as Content))
          .join("");

      case "break":
        return "\n";

      case "thematicBreak":
        return "---";

      default:
        if ("children" in node && Array.isArray(node.children)) {
          return node.children
            .map((child) => this.nodeToGChat(child as Content))
            .join("");
        }
        if ("value" in node) {
          return String(node.value);
        }
        return "";
    }
  }
}
