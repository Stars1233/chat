import {
  Actions,
  Button,
  Card,
  CardText,
  Divider,
  Field,
  Fields,
  Image,
  Section,
} from "chat";
import { describe, expect, it } from "vitest";
import { cardToBlockKit, cardToFallbackText } from "./cards";

describe("cardToBlockKit", () => {
  it("converts a simple card with title", () => {
    const card = Card({ title: "Welcome" });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "header",
      text: {
        type: "plain_text",
        text: "Welcome",
        emoji: true,
      },
    });
  });

  it("converts a card with title and subtitle", () => {
    const card = Card({
      title: "Order Update",
      subtitle: "Your order is on its way",
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("header");
    expect(blocks[1]).toEqual({
      type: "context",
      elements: [{ type: "mrkdwn", text: "Your order is on its way" }],
    });
  });

  it("converts a card with header image", () => {
    const card = Card({
      title: "Product",
      imageUrl: "https://example.com/product.png",
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({
      type: "image",
      image_url: "https://example.com/product.png",
      alt_text: "Product",
    });
  });

  it("converts text elements", () => {
    const card = Card({
      children: [
        CardText("Regular text"),
        CardText("Bold text", { style: "bold" }),
        CardText("Muted text", { style: "muted" }),
      ],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(3);

    // Regular text
    expect(blocks[0]).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "Regular text" },
    });

    // Bold text
    expect(blocks[1]).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "*Bold text*" },
    });

    // Muted text (uses context block)
    expect(blocks[2]).toEqual({
      type: "context",
      elements: [{ type: "mrkdwn", text: "Muted text" }],
    });
  });

  it("converts image elements", () => {
    const card = Card({
      children: [
        Image({ url: "https://example.com/img.png", alt: "My image" }),
      ],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "image",
      image_url: "https://example.com/img.png",
      alt_text: "My image",
    });
  });

  it("converts divider elements", () => {
    const card = Card({
      children: [Divider()],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: "divider" });
  });

  it("converts actions with buttons", () => {
    const card = Card({
      children: [
        Actions([
          Button({ id: "approve", label: "Approve", style: "primary" }),
          Button({
            id: "reject",
            label: "Reject",
            style: "danger",
            value: "data-123",
          }),
          Button({ id: "skip", label: "Skip" }),
        ]),
      ],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("actions");

    const elements = blocks[0].elements as Array<{
      type: string;
      text: { type: string; text: string; emoji: boolean };
      action_id: string;
      value?: string;
      style?: string;
    }>;
    expect(elements).toHaveLength(3);

    expect(elements[0]).toEqual({
      type: "button",
      text: { type: "plain_text", text: "Approve", emoji: true },
      action_id: "approve",
      style: "primary",
    });

    expect(elements[1]).toEqual({
      type: "button",
      text: { type: "plain_text", text: "Reject", emoji: true },
      action_id: "reject",
      value: "data-123",
      style: "danger",
    });

    expect(elements[2]).toEqual({
      type: "button",
      text: { type: "plain_text", text: "Skip", emoji: true },
      action_id: "skip",
    });
  });

  it("converts fields", () => {
    const card = Card({
      children: [
        Fields([
          Field({ label: "Status", value: "Active" }),
          Field({ label: "Priority", value: "High" }),
        ]),
      ],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("section");
    expect(blocks[0].fields).toEqual([
      { type: "mrkdwn", text: "*Status*\nActive" },
      { type: "mrkdwn", text: "*Priority*\nHigh" },
    ]);
  });

  it("flattens section children", () => {
    const card = Card({
      children: [Section([CardText("Inside section"), Divider()])],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("section");
    expect(blocks[1].type).toBe("divider");
  });

  it("converts a complete card", () => {
    const card = Card({
      title: "Order #1234",
      subtitle: "Status update",
      children: [
        CardText("Your order has been shipped!"),
        Divider(),
        Fields([
          Field({ label: "Tracking", value: "ABC123" }),
          Field({ label: "ETA", value: "Dec 25" }),
        ]),
        Actions([
          Button({ id: "track", label: "Track Package", style: "primary" }),
        ]),
      ],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(6);
    expect(blocks[0].type).toBe("header");
    expect(blocks[1].type).toBe("context");
    expect(blocks[2].type).toBe("section");
    expect(blocks[3].type).toBe("divider");
    expect(blocks[4].type).toBe("section");
    expect(blocks[5].type).toBe("actions");
  });
});

describe("cardToFallbackText", () => {
  it("generates fallback text for a card", () => {
    const card = Card({
      title: "Order Update",
      subtitle: "Status changed",
      children: [
        CardText("Your order is ready"),
        Fields([
          Field({ label: "Order ID", value: "#1234" }),
          Field({ label: "Status", value: "Ready" }),
        ]),
        Actions([
          Button({ id: "pickup", label: "Schedule Pickup" }),
          Button({ id: "delay", label: "Delay" }),
        ]),
      ],
    });

    const text = cardToFallbackText(card);

    expect(text).toContain("*Order Update*");
    expect(text).toContain("Status changed");
    expect(text).toContain("Your order is ready");
    expect(text).toContain("Order ID: #1234");
    expect(text).toContain("Status: Ready");
    expect(text).toContain("[Schedule Pickup] [Delay]");
  });

  it("handles card with only title", () => {
    const card = Card({ title: "Simple Card" });
    const text = cardToFallbackText(card);
    expect(text).toBe("*Simple Card*");
  });
});
