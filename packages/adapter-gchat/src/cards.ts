/**
 * Google Chat Card converter for cross-platform cards.
 *
 * Converts CardElement to Google Chat Card v2 format.
 * @see https://developers.google.com/chat/api/reference/rest/v1/cards
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

// Google Chat Card v2 types (simplified)
export interface GoogleChatCard {
  cardId?: string;
  card: {
    header?: GoogleChatCardHeader;
    sections: GoogleChatCardSection[];
  };
}

export interface GoogleChatCardHeader {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  imageType?: "CIRCLE" | "SQUARE";
}

export interface GoogleChatCardSection {
  header?: string;
  widgets: GoogleChatWidget[];
  collapsible?: boolean;
}

export interface GoogleChatWidget {
  textParagraph?: { text: string };
  image?: { imageUrl: string; altText?: string };
  decoratedText?: {
    topLabel?: string;
    text: string;
    bottomLabel?: string;
    startIcon?: { knownIcon?: string };
  };
  buttonList?: { buttons: GoogleChatButton[] };
  divider?: Record<string, never>;
}

export interface GoogleChatButton {
  text: string;
  onClick: {
    action: {
      function: string;
      parameters?: Array<{ key: string; value: string }>;
    };
  };
  color?: { red: number; green: number; blue: number };
}

/**
 * Convert a CardElement to Google Chat Card v2 format.
 */
export function cardToGoogleCard(
  card: CardElement,
  cardId?: string,
): GoogleChatCard {
  const sections: GoogleChatCardSection[] = [];

  // Build header
  let header: GoogleChatCardHeader | undefined;
  if (card.title || card.subtitle || card.imageUrl) {
    header = {
      title: card.title || "",
    };
    if (card.subtitle) {
      header.subtitle = card.subtitle;
    }
    if (card.imageUrl) {
      header.imageUrl = card.imageUrl;
      header.imageType = "SQUARE";
    }
  }

  // Group children into sections
  // GChat cards require widgets to be inside sections
  let currentWidgets: GoogleChatWidget[] = [];

  for (const child of card.children) {
    if (child.type === "section") {
      // If we have pending widgets, flush them to a section
      if (currentWidgets.length > 0) {
        sections.push({ widgets: currentWidgets });
        currentWidgets = [];
      }
      // Convert section as its own section
      const sectionWidgets = convertSectionToWidgets(child);
      sections.push({ widgets: sectionWidgets });
    } else {
      // Add to current widgets
      const widgets = convertChildToWidgets(child);
      currentWidgets.push(...widgets);
    }
  }

  // Flush remaining widgets
  if (currentWidgets.length > 0) {
    sections.push({ widgets: currentWidgets });
  }

  // GChat requires at least one section with at least one widget
  if (sections.length === 0) {
    sections.push({
      widgets: [{ textParagraph: { text: "" } }],
    });
  }

  const googleCard: GoogleChatCard = {
    card: {
      sections,
    },
  };

  if (header) {
    googleCard.card.header = header;
  }

  if (cardId) {
    googleCard.cardId = cardId;
  }

  return googleCard;
}

/**
 * Convert a card child element to Google Chat widgets.
 */
function convertChildToWidgets(child: CardChild): GoogleChatWidget[] {
  switch (child.type) {
    case "text":
      return [convertTextToWidget(child)];
    case "image":
      return [convertImageToWidget(child)];
    case "divider":
      return [convertDividerToWidget(child)];
    case "actions":
      return [convertActionsToWidget(child)];
    case "section":
      return convertSectionToWidgets(child);
    case "fields":
      return convertFieldsToWidgets(child);
    default:
      return [];
  }
}

function convertTextToWidget(element: TextElement): GoogleChatWidget {
  let text = element.content;

  // Apply style using Google Chat formatting
  if (element.style === "bold") {
    text = `*${text}*`;
  } else if (element.style === "muted") {
    // GChat doesn't have muted, use regular text
    text = element.content;
  }

  return {
    textParagraph: { text },
  };
}

function convertImageToWidget(element: ImageElement): GoogleChatWidget {
  return {
    image: {
      imageUrl: element.url,
      altText: element.alt || "Image",
    },
  };
}

function convertDividerToWidget(_element: DividerElement): GoogleChatWidget {
  return { divider: {} };
}

function convertActionsToWidget(element: ActionsElement): GoogleChatWidget {
  const buttons: GoogleChatButton[] = element.children.map((button) =>
    convertButtonToGoogleButton(button),
  );

  return {
    buttonList: { buttons },
  };
}

function convertButtonToGoogleButton(button: ButtonElement): GoogleChatButton {
  const googleButton: GoogleChatButton = {
    text: button.label,
    onClick: {
      action: {
        function: button.id,
        parameters: button.value
          ? [{ key: "value", value: button.value }]
          : undefined,
      },
    },
  };

  // Apply button style colors
  if (button.style === "primary") {
    // Blue color for primary
    googleButton.color = { red: 0.2, green: 0.5, blue: 0.9 };
  } else if (button.style === "danger") {
    // Red color for danger
    googleButton.color = { red: 0.9, green: 0.2, blue: 0.2 };
  }

  return googleButton;
}

function convertSectionToWidgets(element: SectionElement): GoogleChatWidget[] {
  const widgets: GoogleChatWidget[] = [];
  for (const child of element.children) {
    widgets.push(...convertChildToWidgets(child));
  }
  return widgets;
}

function convertFieldsToWidgets(element: FieldsElement): GoogleChatWidget[] {
  // Convert fields to decorated text widgets
  return element.children.map((field) => ({
    decoratedText: {
      topLabel: field.label,
      text: field.value,
    },
  }));
}

/**
 * Generate fallback text from a card element.
 * Used when cards aren't supported.
 */
export function cardToFallbackText(card: CardElement): string {
  const parts: string[] = [];

  if (card.title) {
    parts.push(`*${card.title}*`);
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

  return parts.join("\n");
}

function childToFallbackText(child: CardChild): string | null {
  switch (child.type) {
    case "text":
      return child.content;
    case "fields":
      return child.children.map((f) => `*${f.label}*: ${f.value}`).join("\n");
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
