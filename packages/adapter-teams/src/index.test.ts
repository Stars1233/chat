import { describe, expect, it } from "vitest";
import { createTeamsAdapter, TeamsAdapter } from "./index";

describe("TeamsAdapter", () => {
  it("should export createTeamsAdapter function", () => {
    expect(typeof createTeamsAdapter).toBe("function");
  });

  it("should create an adapter instance", () => {
    const adapter = createTeamsAdapter({
      appId: "test-app-id",
      appPassword: "test-password",
    });
    expect(adapter).toBeInstanceOf(TeamsAdapter);
    expect(adapter.name).toBe("teams");
  });

  describe("thread ID encoding", () => {
    it("should encode and decode thread IDs", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
      });

      const original = {
        conversationId: "19:abc123@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const encoded = adapter.encodeThreadId(original);
      expect(encoded).toMatch(/^teams:/);

      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded.conversationId).toBe(original.conversationId);
      expect(decoded.serviceUrl).toBe(original.serviceUrl);
    });

    it("should preserve messageid in thread context for channel threads", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
      });

      // Teams channel threads include ;messageid=XXX in the conversation ID
      // This is the thread context needed to reply in the correct thread
      const original = {
        conversationId:
          "19:d441d38c655c47a085215b2726e76927@thread.tacv2;messageid=1767297849909",
        serviceUrl: "https://smba.trafficmanager.net/amer/",
      };

      const encoded = adapter.encodeThreadId(original);
      const decoded = adapter.decodeThreadId(encoded);

      // The full conversation ID including messageid must be preserved
      expect(decoded.conversationId).toBe(original.conversationId);
      expect(decoded.conversationId).toContain(";messageid=");
    });
  });
});
