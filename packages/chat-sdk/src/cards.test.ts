import { describe, expect, it } from "vitest";
import {
  Actions,
  Button,
  Card,
  Divider,
  Field,
  Fields,
  Image,
  isCardElement,
  Section,
  Text,
} from "./cards";

describe("Card Builder Functions", () => {
  describe("Card", () => {
    it("creates a card with title", () => {
      const card = Card({ title: "My Card" });
      expect(card.type).toBe("card");
      expect(card.title).toBe("My Card");
      expect(card.children).toEqual([]);
    });

    it("creates a card with all options", () => {
      const card = Card({
        title: "Order #1234",
        subtitle: "Processing",
        imageUrl: "https://example.com/image.png",
        children: [Text("Hello")],
      });
      expect(card.title).toBe("Order #1234");
      expect(card.subtitle).toBe("Processing");
      expect(card.imageUrl).toBe("https://example.com/image.png");
      expect(card.children).toHaveLength(1);
    });

    it("creates an empty card", () => {
      const card = Card();
      expect(card.type).toBe("card");
      expect(card.children).toEqual([]);
    });
  });

  describe("Text", () => {
    it("creates a text element", () => {
      const text = Text("Hello, world!");
      expect(text.type).toBe("text");
      expect(text.content).toBe("Hello, world!");
      expect(text.style).toBeUndefined();
    });

    it("creates a bold text element", () => {
      const text = Text("Important", { style: "bold" });
      expect(text.content).toBe("Important");
      expect(text.style).toBe("bold");
    });

    it("creates a muted text element", () => {
      const text = Text("Subtle note", { style: "muted" });
      expect(text.style).toBe("muted");
    });
  });

  describe("Image", () => {
    it("creates an image element", () => {
      const img = Image({ url: "https://example.com/img.png" });
      expect(img.type).toBe("image");
      expect(img.url).toBe("https://example.com/img.png");
      expect(img.alt).toBeUndefined();
    });

    it("creates an image with alt text", () => {
      const img = Image({
        url: "https://example.com/img.png",
        alt: "A beautiful sunset",
      });
      expect(img.alt).toBe("A beautiful sunset");
    });
  });

  describe("Divider", () => {
    it("creates a divider element", () => {
      const div = Divider();
      expect(div.type).toBe("divider");
    });
  });

  describe("Button", () => {
    it("creates a button element", () => {
      const btn = Button({ id: "submit", label: "Submit" });
      expect(btn.type).toBe("button");
      expect(btn.id).toBe("submit");
      expect(btn.label).toBe("Submit");
      expect(btn.style).toBeUndefined();
      expect(btn.value).toBeUndefined();
    });

    it("creates a primary button", () => {
      const btn = Button({ id: "ok", label: "OK", style: "primary" });
      expect(btn.style).toBe("primary");
    });

    it("creates a danger button with value", () => {
      const btn = Button({
        id: "delete",
        label: "Delete",
        style: "danger",
        value: "item-123",
      });
      expect(btn.style).toBe("danger");
      expect(btn.value).toBe("item-123");
    });
  });

  describe("Actions", () => {
    it("creates an actions container", () => {
      const actions = Actions([
        Button({ id: "ok", label: "OK" }),
        Button({ id: "cancel", label: "Cancel" }),
      ]);
      expect(actions.type).toBe("actions");
      expect(actions.children).toHaveLength(2);
      expect(actions.children[0].label).toBe("OK");
      expect(actions.children[1].label).toBe("Cancel");
    });

    it("creates empty actions", () => {
      const actions = Actions([]);
      expect(actions.children).toEqual([]);
    });
  });

  describe("Section", () => {
    it("creates a section container", () => {
      const section = Section([Text("Content"), Divider()]);
      expect(section.type).toBe("section");
      expect(section.children).toHaveLength(2);
    });
  });

  describe("Field", () => {
    it("creates a field element", () => {
      const field = Field({ label: "Status", value: "Active" });
      expect(field.type).toBe("field");
      expect(field.label).toBe("Status");
      expect(field.value).toBe("Active");
    });
  });

  describe("Fields", () => {
    it("creates a fields container", () => {
      const fields = Fields([
        Field({ label: "Name", value: "John" }),
        Field({ label: "Email", value: "john@example.com" }),
      ]);
      expect(fields.type).toBe("fields");
      expect(fields.children).toHaveLength(2);
    });
  });

  describe("isCardElement", () => {
    it("returns true for CardElement", () => {
      const card = Card({ title: "Test" });
      expect(isCardElement(card)).toBe(true);
    });

    it("returns false for non-card objects", () => {
      expect(isCardElement({ type: "text", content: "hello" })).toBe(false);
      expect(isCardElement({ type: "button", id: "x", label: "X" })).toBe(
        false,
      );
      expect(isCardElement("string")).toBe(false);
      expect(isCardElement(null)).toBe(false);
      expect(isCardElement(undefined)).toBe(false);
      expect(isCardElement(123)).toBe(false);
      expect(isCardElement({})).toBe(false);
    });
  });
});

describe("Card Composition", () => {
  it("creates a complete card with all element types", () => {
    const card = Card({
      title: "Order #1234",
      subtitle: "Processing your order",
      imageUrl: "https://example.com/order.png",
      children: [
        Text("Thank you for your order!"),
        Divider(),
        Fields([
          Field({ label: "Order ID", value: "#1234" }),
          Field({ label: "Total", value: "$99.99" }),
        ]),
        Section([
          Text("Items:", { style: "bold" }),
          Text("2x Widget, 1x Gadget", { style: "muted" }),
        ]),
        Divider(),
        Actions([
          Button({ id: "track", label: "Track Order", style: "primary" }),
          Button({
            id: "cancel",
            label: "Cancel Order",
            style: "danger",
            value: "order-1234",
          }),
        ]),
      ],
    });

    expect(card.type).toBe("card");
    expect(card.title).toBe("Order #1234");
    expect(card.children).toHaveLength(6);

    // Verify structure
    expect(card.children[0].type).toBe("text");
    expect(card.children[1].type).toBe("divider");
    expect(card.children[2].type).toBe("fields");
    expect(card.children[3].type).toBe("section");
    expect(card.children[4].type).toBe("divider");
    expect(card.children[5].type).toBe("actions");

    // Verify nested content
    const fields = card.children[2];
    if (fields.type === "fields") {
      expect(fields.children).toHaveLength(2);
    }

    const actions = card.children[5];
    if (actions.type === "actions") {
      expect(actions.children).toHaveLength(2);
      expect(actions.children[0].id).toBe("track");
      expect(actions.children[1].value).toBe("order-1234");
    }
  });
});

// JSX tests moved to jsx-react.test.tsx and jsx-runtime.test.tsx
