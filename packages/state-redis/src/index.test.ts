import { describe, expect, it } from "vitest";
import { createRedisState, RedisStateAdapter } from "./index";

describe("RedisStateAdapter", () => {
  it("should export createRedisState function", () => {
    expect(typeof createRedisState).toBe("function");
  });

  it("should create an adapter instance", () => {
    const adapter = createRedisState({ url: "redis://localhost:6379" });
    expect(adapter).toBeInstanceOf(RedisStateAdapter);
  });

  // Note: Integration tests with a real Redis instance would go here
  // but require a running Redis server, so they're skipped by default

  describe.skip("integration tests (require Redis)", () => {
    it("should connect to Redis", async () => {
      const adapter = createRedisState({
        url: process.env.REDIS_URL || "redis://localhost:6379",
      });
      await adapter.connect();
      await adapter.disconnect();
    });
  });
});
