import { describe, expect, it } from "vitest";
import { createIoRedisState, IoRedisStateAdapter } from "./index";

describe("IoRedisStateAdapter", () => {
  it("should export createIoRedisState function", () => {
    expect(typeof createIoRedisState).toBe("function");
  });

  it("should create an adapter instance with URL", () => {
    const adapter = createIoRedisState({ url: "redis://localhost:6379" });
    expect(adapter).toBeInstanceOf(IoRedisStateAdapter);
    // Clean up - disconnect the auto-connected client
    adapter.getClient().disconnect();
  });

  // Note: Integration tests with a real Redis instance would go here
  // but require a running Redis server, so they're skipped by default

  describe.skip("integration tests (require Redis)", () => {
    it("should connect to Redis", async () => {
      const adapter = createIoRedisState({
        url: process.env.REDIS_URL || "redis://localhost:6379",
      });
      await adapter.connect();
      await adapter.disconnect();
    });
  });
});
