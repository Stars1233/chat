import { describe, expect, it } from "vitest";
import {
  fromReactModalElement,
  isModalElement,
  Modal,
  Select,
  SelectOption,
  TextInput,
} from "./modals";

describe("Modal Elements", () => {
  describe("Modal", () => {
    it("should create a modal element", () => {
      const modal = Modal({
        callbackId: "test-callback",
        title: "Test Modal",
      });

      expect(modal.type).toBe("modal");
      expect(modal.callbackId).toBe("test-callback");
      expect(modal.title).toBe("Test Modal");
      expect(modal.children).toEqual([]);
    });

    it("should include optional properties", () => {
      const modal = Modal({
        callbackId: "test",
        title: "Test",
        submitLabel: "Submit",
        closeLabel: "Cancel",
        notifyOnClose: true,
        privateMetadata: "some-data",
      });

      expect(modal.submitLabel).toBe("Submit");
      expect(modal.closeLabel).toBe("Cancel");
      expect(modal.notifyOnClose).toBe(true);
      expect(modal.privateMetadata).toBe("some-data");
    });
  });

  describe("TextInput", () => {
    it("should create a text input element", () => {
      const input = TextInput({
        id: "name",
        label: "Your Name",
      });

      expect(input.type).toBe("text_input");
      expect(input.id).toBe("name");
      expect(input.label).toBe("Your Name");
    });

    it("should include optional properties", () => {
      const input = TextInput({
        id: "feedback",
        label: "Feedback",
        placeholder: "Enter your feedback",
        initialValue: "Great!",
        multiline: true,
        optional: true,
        maxLength: 500,
      });

      expect(input.placeholder).toBe("Enter your feedback");
      expect(input.initialValue).toBe("Great!");
      expect(input.multiline).toBe(true);
      expect(input.optional).toBe(true);
      expect(input.maxLength).toBe(500);
    });
  });

  describe("Select", () => {
    it("should create a select element", () => {
      const select = Select({
        id: "priority",
        label: "Priority",
        options: [
          SelectOption({ label: "High", value: "high" }),
          SelectOption({ label: "Low", value: "low" }),
        ],
      });

      expect(select.type).toBe("select");
      expect(select.id).toBe("priority");
      expect(select.label).toBe("Priority");
      expect(select.options).toHaveLength(2);
    });
  });

  describe("isModalElement", () => {
    it("should return true for modal elements", () => {
      const modal = Modal({ callbackId: "test", title: "Test" });
      expect(isModalElement(modal)).toBe(true);
    });

    it("should return false for non-modal elements", () => {
      expect(isModalElement(null)).toBe(false);
      expect(isModalElement(undefined)).toBe(false);
      expect(isModalElement({ type: "text_input" })).toBe(false);
      expect(isModalElement("string")).toBe(false);
    });
  });
});

describe("JSX Support", () => {
  describe("fromReactModalElement", () => {
    it("should return existing ModalElement unchanged", () => {
      const modal = Modal({ callbackId: "test", title: "Test" });
      const result = fromReactModalElement(modal);
      expect(result).toBe(modal);
    });

    it("should return null for null input", () => {
      expect(fromReactModalElement(null)).toBeNull();
    });

    it("should return null for undefined input", () => {
      expect(fromReactModalElement(undefined)).toBeNull();
    });
  });
});
