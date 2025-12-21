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
  });
});
