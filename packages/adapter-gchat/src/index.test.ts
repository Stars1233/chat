import { describe, expect, it } from "vitest";
import { createGoogleChatAdapter, GoogleChatAdapter } from "./index";

describe("GoogleChatAdapter", () => {
  it("should export createGoogleChatAdapter function", () => {
    expect(typeof createGoogleChatAdapter).toBe("function");
  });

  it("should create an adapter instance", () => {
    const adapter = createGoogleChatAdapter({
      credentials: {
        client_email: "test@test.iam.gserviceaccount.com",
        private_key:
          "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
      },
    });
    expect(adapter).toBeInstanceOf(GoogleChatAdapter);
    expect(adapter.name).toBe("gchat");
  });

  describe("thread ID encoding", () => {
    it("should encode and decode thread IDs without thread name", () => {
      const adapter = createGoogleChatAdapter({
        credentials: {
          client_email: "test@test.iam.gserviceaccount.com",
          private_key:
            "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
        },
      });

      const original = {
        spaceName: "spaces/ABC123",
      };

      const encoded = adapter.encodeThreadId(original);
      expect(encoded).toMatch(/^gchat:/);

      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded.spaceName).toBe(original.spaceName);
    });

    it("should encode and decode thread IDs with thread name", () => {
      const adapter = createGoogleChatAdapter({
        credentials: {
          client_email: "test@test.iam.gserviceaccount.com",
          private_key:
            "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
        },
      });

      const original = {
        spaceName: "spaces/ABC123",
        threadName: "spaces/ABC123/threads/XYZ789",
      };

      const encoded = adapter.encodeThreadId(original);
      const decoded = adapter.decodeThreadId(encoded);

      expect(decoded.spaceName).toBe(original.spaceName);
      expect(decoded.threadName).toBe(original.threadName);
    });
  });
});
