/**
 * Teams Adaptive Card converter for cross-platform cards.
 *
 * Converts CardElement to Microsoft Adaptive Cards format.
 * @see https://adaptivecards.io/
 */

import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  DividerElement,
  FieldsElement,
  ImageElement,
  SectionElement,
  TextElement,
} from "chat-sdk";

// Adaptive Card types (simplified)
export interface AdaptiveCard {
  type: "AdaptiveCard";
  $schema: string;
  version: string;
  body: AdaptiveCardElement[];
  actions?: AdaptiveCardAction[];
}

export interface AdaptiveCardElement {
  type: string;
  [key: string]: unknown;
}

export interface AdaptiveCardAction {
  type: string;
  title: string;
  data?: Record<string, unknown>;
  style?: string;
}

const ADAPTIVE_CARD_SCHEMA =
  "http://adaptivecards.io/schemas/adaptive-card.json";
const ADAPTIVE_CARD_VERSION = "1.4";

/**
 * Convert a CardElement to a Teams Adaptive Card.
 */
export function cardToAdaptiveCard(card: CardElement): AdaptiveCard {
  const body: AdaptiveCardElement[] = [];
  const actions: AdaptiveCardAction[] = [];

  // Add title as TextBlock
  if (card.title) {
    body.push({
      type: "TextBlock",
      text: card.title,
      weight: "bolder",
      size: "large",
      wrap: true,
    });
  }

  // Add subtitle as TextBlock
  if (card.subtitle) {
    body.push({
      type: "TextBlock",
      text: card.subtitle,
      isSubtle: true,
      wrap: true,
    });
  }

  // Add header image if present
  if (card.imageUrl) {
    body.push({
      type: "Image",
      url: card.imageUrl,
      size: "stretch",
    });
  }

  // Convert children
  for (const child of card.children) {
    const result = convertChildToAdaptive(child);
    body.push(...result.elements);
    actions.push(...result.actions);
  }

  const adaptiveCard: AdaptiveCard = {
    type: "AdaptiveCard",
    $schema: ADAPTIVE_CARD_SCHEMA,
    version: ADAPTIVE_CARD_VERSION,
    body,
  };

  if (actions.length > 0) {
    adaptiveCard.actions = actions;
  }

  return adaptiveCard;
}

interface ConvertResult {
  elements: AdaptiveCardElement[];
  actions: AdaptiveCardAction[];
}

/**
 * Convert a card child element to Adaptive Card elements.
 */
function convertChildToAdaptive(child: CardChild): ConvertResult {
  switch (child.type) {
    case "text":
      return { elements: [convertTextToElement(child)], actions: [] };
    case "image":
      return { elements: [convertImageToElement(child)], actions: [] };
    case "divider":
      return { elements: [convertDividerToElement(child)], actions: [] };
    case "actions":
      return convertActionsToElements(child);
    case "section":
      return convertSectionToElements(child);
    case "fields":
      return { elements: [convertFieldsToElement(child)], actions: [] };
    default:
      return { elements: [], actions: [] };
  }
}

function convertTextToElement(element: TextElement): AdaptiveCardElement {
  const textBlock: AdaptiveCardElement = {
    type: "TextBlock",
    text: element.content,
    wrap: true,
  };

  if (element.style === "bold") {
    textBlock.weight = "bolder";
  } else if (element.style === "muted") {
    textBlock.isSubtle = true;
  }

  return textBlock;
}

function convertImageToElement(element: ImageElement): AdaptiveCardElement {
  return {
    type: "Image",
    url: element.url,
    altText: element.alt || "Image",
    size: "auto",
  };
}

function convertDividerToElement(_element: DividerElement): AdaptiveCardElement {
  // Adaptive Cards don't have a native divider, use a separator container
  return {
    type: "Container",
    separator: true,
    items: [],
  };
}

function convertActionsToElements(element: ActionsElement): ConvertResult {
  // In Adaptive Cards, actions go at the card level, not inline
  const actions: AdaptiveCardAction[] = element.children.map((button) =>
    convertButtonToAction(button),
  );

  return { elements: [], actions };
}

function convertButtonToAction(button: ButtonElement): AdaptiveCardAction {
  const action: AdaptiveCardAction = {
    type: "Action.Submit",
    title: button.label,
    data: {
      actionId: button.id,
      value: button.value,
    },
  };

  if (button.style === "primary") {
    action.style = "positive";
  } else if (button.style === "danger") {
    action.style = "destructive";
  }

  return action;
}

function convertSectionToElements(element: SectionElement): ConvertResult {
  const elements: AdaptiveCardElement[] = [];
  const actions: AdaptiveCardAction[] = [];

  // Wrap section in a container
  const containerItems: AdaptiveCardElement[] = [];

  for (const child of element.children) {
    const result = convertChildToAdaptive(child);
    containerItems.push(...result.elements);
    actions.push(...result.actions);
  }

  if (containerItems.length > 0) {
    elements.push({
      type: "Container",
      items: containerItems,
    });
  }

  return { elements, actions };
}

function convertFieldsToElement(element: FieldsElement): AdaptiveCardElement {
  // Use FactSet for key-value pairs
  const facts = element.children.map((field) => ({
    title: field.label,
    value: field.value,
  }));

  return {
    type: "FactSet",
    facts,
  };
}

/**
 * Generate fallback text from a card element.
 * Used when adaptive cards aren't supported.
 */
export function cardToFallbackText(card: CardElement): string {
  const parts: string[] = [];

  if (card.title) {
    parts.push(`**${card.title}**`);
  }

  if (card.subtitle) {
    parts.push(card.subtitle);
  }

  for (const child of card.children) {
    const text = childToFallbackText(child);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join("\n\n");
}

function childToFallbackText(child: CardChild): string | null {
  switch (child.type) {
    case "text":
      return child.content;
    case "fields":
      return child.children.map((f) => `**${f.label}**: ${f.value}`).join("\n");
    case "actions":
      return `[${child.children.map((b) => b.label).join("] [")}]`;
    case "section":
      return child.children
        .map((c) => childToFallbackText(c))
        .filter(Boolean)
        .join("\n");
    default:
      return null;
  }
}
