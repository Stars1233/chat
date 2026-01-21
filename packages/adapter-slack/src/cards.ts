/**
 * Slack Block Kit converter for cross-platform cards.
 *
 * Converts CardElement to Slack Block Kit blocks.
 * @see https://api.slack.com/block-kit
 */

import {
  createEmojiConverter,
  mapButtonStyle,
  cardToFallbackText as sharedCardToFallbackText,
} from "@chat-adapter/shared";
import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  DividerElement,
  FieldsElement,
  ImageElement,
  LinkButtonElement,
  SectionElement,
  TextElement,
} from "chat";

/**
 * Convert emoji placeholders in text to Slack format.
 */
const convertEmoji = createEmojiConverter("slack");

// Slack Block Kit types (simplified)
export interface SlackBlock {
  type: string;
  block_id?: string;
  [key: string]: unknown;
}

interface SlackTextObject {
  type: "plain_text" | "mrkdwn";
  text: string;
  emoji?: boolean;
}

interface SlackButtonElement {
  type: "button";
  text: SlackTextObject;
  action_id: string;
  value?: string;
  style?: "primary" | "danger";
}

interface SlackLinkButtonElement {
  type: "button";
  text: SlackTextObject;
  action_id: string;
  url: string;
  style?: "primary" | "danger";
}

/**
 * Convert a CardElement to Slack Block Kit blocks.
 */
export function cardToBlockKit(card: CardElement): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  // Add header if title is present
  if (card.title) {
    blocks.push({
      type: "header",
      text: {
        type: "plain_text",
        text: convertEmoji(card.title),
        emoji: true,
      },
    });
  }

  // Add subtitle as context if present
  if (card.subtitle) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: convertEmoji(card.subtitle),
        },
      ],
    });
  }

  // Add header image if present
  if (card.imageUrl) {
    blocks.push({
      type: "image",
      image_url: card.imageUrl,
      alt_text: card.title || "Card image",
    });
  }

  // Convert children
  for (const child of card.children) {
    const childBlocks = convertChildToBlocks(child);
    blocks.push(...childBlocks);
  }

  return blocks;
}

/**
 * Convert a card child element to Slack blocks.
 */
function convertChildToBlocks(child: CardChild): SlackBlock[] {
  switch (child.type) {
    case "text":
      return [convertTextToBlock(child)];
    case "image":
      return [convertImageToBlock(child)];
    case "divider":
      return [convertDividerToBlock(child)];
    case "actions":
      return [convertActionsToBlock(child)];
    case "section":
      return convertSectionToBlocks(child);
    case "fields":
      return [convertFieldsToBlock(child)];
    default:
      return [];
  }
}

function convertTextToBlock(element: TextElement): SlackBlock {
  const text = convertEmoji(element.content);
  let formattedText = text;

  // Apply style
  if (element.style === "bold") {
    formattedText = `*${text}*`;
  } else if (element.style === "muted") {
    // Slack doesn't have a muted style, use context block
    return {
      type: "context",
      elements: [{ type: "mrkdwn", text }],
    };
  }

  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: formattedText,
    },
  };
}

function convertImageToBlock(element: ImageElement): SlackBlock {
  return {
    type: "image",
    image_url: element.url,
    alt_text: element.alt || "Image",
  };
}

function convertDividerToBlock(_element: DividerElement): SlackBlock {
  return { type: "divider" };
}

function convertActionsToBlock(element: ActionsElement): SlackBlock {
  const elements: (SlackButtonElement | SlackLinkButtonElement)[] =
    element.children.map((button) => {
      if (button.type === "link-button") {
        return convertLinkButtonToElement(button);
      }
      return convertButtonToElement(button);
    });

  return {
    type: "actions",
    elements,
  };
}

function convertButtonToElement(button: ButtonElement): SlackButtonElement {
  const element: SlackButtonElement = {
    type: "button",
    text: {
      type: "plain_text",
      text: convertEmoji(button.label),
      emoji: true,
    },
    action_id: button.id,
  };

  if (button.value) {
    element.value = button.value;
  }

  const style = mapButtonStyle(button.style, "slack");
  if (style) {
    element.style = style as "primary" | "danger";
  }

  return element;
}

function convertLinkButtonToElement(
  button: LinkButtonElement,
): SlackLinkButtonElement {
  const element: SlackLinkButtonElement = {
    type: "button",
    text: {
      type: "plain_text",
      text: convertEmoji(button.label),
      emoji: true,
    },
    action_id: `link-${button.url.slice(0, 200)}`,
    url: button.url,
  };

  const style = mapButtonStyle(button.style, "slack");
  if (style) {
    element.style = style as "primary" | "danger";
  }

  return element;
}

function convertSectionToBlocks(element: SectionElement): SlackBlock[] {
  // Flatten section children into blocks
  const blocks: SlackBlock[] = [];
  for (const child of element.children) {
    blocks.push(...convertChildToBlocks(child));
  }
  return blocks;
}

function convertFieldsToBlock(element: FieldsElement): SlackBlock {
  const fields: SlackTextObject[] = [];

  for (const field of element.children) {
    // Add label and value as separate field items
    fields.push({
      type: "mrkdwn",
      text: `*${convertEmoji(field.label)}*\n${convertEmoji(field.value)}`,
    });
  }

  return {
    type: "section",
    fields,
  };
}

/**
 * Generate fallback text from a card element.
 * Used when blocks aren't supported or for notifications.
 */
export function cardToFallbackText(card: CardElement): string {
  return sharedCardToFallbackText(card, {
    boldFormat: "*",
    lineBreak: "\n",
    platform: "slack",
  });
}
