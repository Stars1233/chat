import { Modal, Select, SelectOption, TextInput } from "chat";
import { describe, expect, it } from "vitest";
import {
  decodeModalMetadata,
  encodeModalMetadata,
  modalToSlackView,
} from "./modals";

describe("modalToSlackView", () => {
  it("converts a simple modal with text input", () => {
    const modal = Modal({
      callbackId: "feedback_form",
      title: "Send Feedback",
      children: [
        TextInput({
          id: "message",
          label: "Your Feedback",
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.type).toBe("modal");
    expect(view.callback_id).toBe("feedback_form");
    expect(view.title).toEqual({ type: "plain_text", text: "Send Feedback" });
    expect(view.submit).toEqual({ type: "plain_text", text: "Submit" });
    expect(view.close).toEqual({ type: "plain_text", text: "Cancel" });
    expect(view.blocks).toHaveLength(1);
    expect(view.blocks[0]).toMatchObject({
      type: "input",
      block_id: "message",
      optional: false,
      label: { type: "plain_text", text: "Your Feedback" },
      element: {
        type: "plain_text_input",
        action_id: "message",
        multiline: false,
      },
    });
  });

  it("converts a modal with custom submit/close labels", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test Modal",
      submitLabel: "Send",
      closeLabel: "Dismiss",
      children: [],
    });

    const view = modalToSlackView(modal);

    expect(view.submit).toEqual({ type: "plain_text", text: "Send" });
    expect(view.close).toEqual({ type: "plain_text", text: "Dismiss" });
  });

  it("converts multiline text input", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [
        TextInput({
          id: "description",
          label: "Description",
          multiline: true,
          placeholder: "Enter description...",
          maxLength: 500,
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.blocks[0]).toMatchObject({
      type: "input",
      element: {
        type: "plain_text_input",
        action_id: "description",
        multiline: true,
        placeholder: { type: "plain_text", text: "Enter description..." },
        max_length: 500,
      },
    });
  });

  it("converts optional text input", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [
        TextInput({
          id: "notes",
          label: "Notes",
          optional: true,
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.blocks[0]).toMatchObject({
      type: "input",
      optional: true,
    });
  });

  it("converts text input with initial value", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [
        TextInput({
          id: "name",
          label: "Name",
          initialValue: "John Doe",
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.blocks[0]).toMatchObject({
      element: {
        initial_value: "John Doe",
      },
    });
  });

  it("converts select element with options", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [
        Select({
          id: "category",
          label: "Category",
          options: [
            SelectOption({ label: "Bug Report", value: "bug" }),
            SelectOption({ label: "Feature Request", value: "feature" }),
          ],
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.blocks[0]).toMatchObject({
      type: "input",
      block_id: "category",
      label: { type: "plain_text", text: "Category" },
      element: {
        type: "static_select",
        action_id: "category",
        options: [
          { text: { type: "plain_text", text: "Bug Report" }, value: "bug" },
          {
            text: { type: "plain_text", text: "Feature Request" },
            value: "feature",
          },
        ],
      },
    });
  });

  it("converts select with initial option", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [
        Select({
          id: "priority",
          label: "Priority",
          options: [
            SelectOption({ label: "Low", value: "low" }),
            SelectOption({ label: "Medium", value: "medium" }),
            SelectOption({ label: "High", value: "high" }),
          ],
          initialOption: "medium",
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.blocks[0]).toMatchObject({
      element: {
        initial_option: {
          text: { type: "plain_text", text: "Medium" },
          value: "medium",
        },
      },
    });
  });

  it("converts select with placeholder", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [
        Select({
          id: "category",
          label: "Category",
          placeholder: "Select a category",
          options: [SelectOption({ label: "General", value: "general" })],
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.blocks[0]).toMatchObject({
      element: {
        placeholder: { type: "plain_text", text: "Select a category" },
      },
    });
  });

  it("includes contextId as private_metadata when provided", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [],
    });

    const view = modalToSlackView(modal, "context-uuid-123");

    expect(view.private_metadata).toBe("context-uuid-123");
  });

  it("private_metadata is undefined when no contextId provided", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [],
    });

    const view = modalToSlackView(modal);

    expect(view.private_metadata).toBeUndefined();
  });

  it("sets notify_on_close when provided", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      notifyOnClose: true,
      children: [],
    });

    const view = modalToSlackView(modal);

    expect(view.notify_on_close).toBe(true);
  });

  it("truncates long titles to 24 chars", () => {
    const modal = Modal({
      callbackId: "test",
      title: "This is a very long modal title that exceeds the limit",
      children: [],
    });

    const view = modalToSlackView(modal);

    expect(view.title.text.length).toBeLessThanOrEqual(24);
  });

  it("converts a complete modal with multiple inputs", () => {
    const modal = Modal({
      callbackId: "feedback_form",
      title: "Submit Feedback",
      submitLabel: "Send",
      closeLabel: "Cancel",
      notifyOnClose: true,
      children: [
        TextInput({
          id: "message",
          label: "Your Feedback",
          placeholder: "Tell us what you think...",
          multiline: true,
        }),
        Select({
          id: "category",
          label: "Category",
          options: [
            SelectOption({ label: "Bug", value: "bug" }),
            SelectOption({ label: "Feature", value: "feature" }),
            SelectOption({ label: "Other", value: "other" }),
          ],
        }),
        TextInput({
          id: "email",
          label: "Email (optional)",
          optional: true,
        }),
      ],
    });

    const view = modalToSlackView(modal, "thread-context-123");

    expect(view.callback_id).toBe("feedback_form");
    expect(view.private_metadata).toBe("thread-context-123");
    expect(view.blocks).toHaveLength(3);
    expect(view.blocks[0].type).toBe("input");
    expect(view.blocks[1].type).toBe("input");
    expect(view.blocks[2].type).toBe("input");
  });
});

describe("encodeModalMetadata", () => {
  it("returns undefined when both fields are empty", () => {
    expect(encodeModalMetadata({})).toBeUndefined();
  });

  it("encodes contextId only", () => {
    const encoded = encodeModalMetadata({ contextId: "uuid-123" });
    expect(encoded).toBeDefined();
    const parsed = JSON.parse(encoded as string);
    expect(parsed.c).toBe("uuid-123");
    expect(parsed.m).toBeUndefined();
  });

  it("encodes privateMetadata only", () => {
    const encoded = encodeModalMetadata({
      privateMetadata: '{"chatId":"abc"}',
    });
    expect(encoded).toBeDefined();
    const parsed = JSON.parse(encoded as string);
    expect(parsed.c).toBeUndefined();
    expect(parsed.m).toBe('{"chatId":"abc"}');
  });

  it("encodes both contextId and privateMetadata", () => {
    const encoded = encodeModalMetadata({
      contextId: "uuid-123",
      privateMetadata: '{"chatId":"abc"}',
    });
    expect(encoded).toBeDefined();
    const parsed = JSON.parse(encoded as string);
    expect(parsed.c).toBe("uuid-123");
    expect(parsed.m).toBe('{"chatId":"abc"}');
  });
});

describe("decodeModalMetadata", () => {
  it("returns empty object for undefined input", () => {
    expect(decodeModalMetadata(undefined)).toEqual({});
  });

  it("returns empty object for empty string", () => {
    expect(decodeModalMetadata("")).toEqual({});
  });

  it("decodes contextId only", () => {
    const encoded = JSON.stringify({ c: "uuid-123" });
    expect(decodeModalMetadata(encoded)).toEqual({
      contextId: "uuid-123",
      privateMetadata: undefined,
    });
  });

  it("decodes privateMetadata only", () => {
    const encoded = JSON.stringify({ m: '{"chatId":"abc"}' });
    expect(decodeModalMetadata(encoded)).toEqual({
      contextId: undefined,
      privateMetadata: '{"chatId":"abc"}',
    });
  });

  it("decodes both contextId and privateMetadata", () => {
    const encoded = JSON.stringify({
      c: "uuid-123",
      m: '{"chatId":"abc"}',
    });
    expect(decodeModalMetadata(encoded)).toEqual({
      contextId: "uuid-123",
      privateMetadata: '{"chatId":"abc"}',
    });
  });

  it("falls back to treating plain string as contextId (backward compat)", () => {
    expect(decodeModalMetadata("plain-uuid-456")).toEqual({
      contextId: "plain-uuid-456",
    });
  });

  it("falls back for JSON without c/m keys", () => {
    expect(decodeModalMetadata('{"other":"value"}')).toEqual({
      contextId: '{"other":"value"}',
    });
  });

  it("roundtrips encode then decode", () => {
    const original = {
      contextId: "ctx-1",
      privateMetadata: '{"key":"val"}',
    };
    const encoded = encodeModalMetadata(original);
    const decoded = decodeModalMetadata(encoded);
    expect(decoded).toEqual(original);
  });
});
