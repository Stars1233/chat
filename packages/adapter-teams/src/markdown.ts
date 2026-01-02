/**
 * Teams-specific format conversion using AST-based parsing.
 *
 * Teams supports a subset of HTML for formatting:
 * - Bold: <b> or <strong>
 * - Italic: <i> or <em>
 * - Strikethrough: <s> or <strike>
 * - Links: <a href="url">text</a>
 * - Code: <pre> and <code>
 *
 * Teams also accepts standard markdown in most cases.
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
  type PostableMessage,
  parseMarkdown,
  type Root,
  type Strong,
  type Text,
} from "chat";

export class TeamsFormatConverter extends BaseFormatConverter {
  /**
   * Convert @mentions to Teams format in plain text.
   * @name → <at>name</at>
   */
  private convertMentionsToTeams(text: string): string {
    return text.replace(/@(\w+)/g, "<at>$1</at>");
  }

  /**
   * Override renderPostable to convert @mentions in plain strings.
   */
  override renderPostable(message: PostableMessage): string {
    if (typeof message === "string") {
      return this.convertMentionsToTeams(message);
    }
    if ("raw" in message) {
      return this.convertMentionsToTeams(message.raw);
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
   * Render an AST to Teams format.
   * Teams accepts standard markdown, so we just stringify cleanly.
   */
  fromAst(ast: Root): string {
    const parts: string[] = [];

    for (const node of ast.children) {
      parts.push(this.nodeToTeams(node as Content));
    }

    return parts.join("\n\n");
  }

  /**
   * Parse Teams message into an AST.
   * Converts Teams HTML/mentions to standard markdown format.
   */
  toAst(teamsText: string): Root {
    // Convert Teams HTML to markdown, then parse
    let markdown = teamsText;

    // Convert @mentions from Teams format: <at>Name</at> -> @Name
    markdown = markdown.replace(/<at>([^<]+)<\/at>/gi, "@$1");

    // Convert HTML tags to markdown
    // Bold: <b>, <strong> -> **text**
    markdown = markdown.replace(
      /<(b|strong)>([^<]+)<\/(b|strong)>/gi,
      "**$2**",
    );

    // Italic: <i>, <em> -> _text_
    markdown = markdown.replace(/<(i|em)>([^<]+)<\/(i|em)>/gi, "_$2_");

    // Strikethrough: <s>, <strike> -> ~~text~~
    markdown = markdown.replace(
      /<(s|strike)>([^<]+)<\/(s|strike)>/gi,
      "~~$2~~",
    );

    // Links: <a href="url">text</a> -> [text](url)
    markdown = markdown.replace(
      /<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi,
      "[$2]($1)",
    );

    // Code: <code>text</code> -> `text`
    markdown = markdown.replace(/<code>([^<]+)<\/code>/gi, "`$1`");

    // Pre: <pre>text</pre> -> ```text```
    markdown = markdown.replace(/<pre>([^<]+)<\/pre>/gi, "```\n$1\n```");

    // Strip remaining HTML tags
    markdown = markdown.replace(/<[^>]+>/g, "");

    // Decode HTML entities
    markdown = markdown
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    return parseMarkdown(markdown);
  }

  private nodeToTeams(node: Content): string {
    switch (node.type) {
      case "paragraph":
        return (node as Paragraph).children
          .map((child) => this.nodeToTeams(child as Content))
          .join("");

      case "text": {
        // Convert @mentions to Teams format <at>mention</at>
        const textValue = (node as Text).value;
        return textValue.replace(/@(\w+)/g, "<at>$1</at>");
      }

      case "strong":
        // Teams supports **text** markdown
        return `**${(node as Strong).children
          .map((child) => this.nodeToTeams(child as Content))
          .join("")}**`;

      case "emphasis":
        // Teams supports _text_ markdown
        return `_${(node as Emphasis).children
          .map((child) => this.nodeToTeams(child as Content))
          .join("")}_`;

      case "delete":
        // Teams supports ~~text~~ markdown
        return `~~${(node as Delete).children
          .map((child) => this.nodeToTeams(child as Content))
          .join("")}~~`;

      case "inlineCode":
        return `\`${(node as InlineCode).value}\``;

      case "code": {
        const codeNode = node as Code;
        return `\`\`\`${codeNode.lang || ""}\n${codeNode.value}\n\`\`\``;
      }

      case "link": {
        const linkNode = node as Link;
        const linkText = linkNode.children
          .map((child) => this.nodeToTeams(child as Content))
          .join("");
        // Standard markdown link format
        return `[${linkText}](${linkNode.url})`;
      }

      case "blockquote":
        return node.children
          .map((child) => `> ${this.nodeToTeams(child as Content)}`)
          .join("\n");

      case "list":
        return node.children
          .map((item, i) => {
            const prefix = node.ordered ? `${i + 1}.` : "-";
            const content = item.children
              .map((child) => this.nodeToTeams(child as Content))
              .join("");
            return `${prefix} ${content}`;
          })
          .join("\n");

      case "listItem":
        return node.children
          .map((child) => this.nodeToTeams(child as Content))
          .join("");

      case "break":
        return "\n";

      case "thematicBreak":
        return "---";

      default:
        // For unsupported nodes, try to extract text
        if ("children" in node && Array.isArray(node.children)) {
          return node.children
            .map((child) => this.nodeToTeams(child as Content))
            .join("");
        }
        if ("value" in node) {
          return String(node.value);
        }
        return "";
    }
  }
}
