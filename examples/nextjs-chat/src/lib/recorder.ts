/**
 * Webhook and API call recorder for replay testing.
 *
 * This module is completely optional - if RECORDING_ENABLED is not set,
 * all recording functions are no-ops.
 *
 * Usage:
 *   1. Set RECORDING_ENABLED=true and optionally RECORDING_SESSION_ID
 *   2. Import { recorder, withRecording } from './recorder'
 *   3. Wrap webhook handling: await recorder.recordWebhook(platform, request)
 *   4. Retrieve logs: await recorder.getRecords()
 *
 * CLI to export recordings:
 *   pnpm --filter example-nextjs-chat exec tsx src/lib/recorder.ts [sessionId]
 */

import { createClient, type RedisClientType } from "redis";

export interface WebhookRecord {
  type: "webhook";
  timestamp: number;
  platform: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface ApiCallRecord {
  type: "api-call";
  timestamp: number;
  platform: string;
  method: string;
  args: unknown;
  response?: unknown;
  error?: string;
}

export type RecordEntry = WebhookRecord | ApiCallRecord;

const RECORDING_TTL_SECONDS = 24 * 60 * 60; // 24 hours

class Recorder {
  private redis: RedisClientType | null = null;
  private sessionId: string;
  private enabled: boolean;
  private connected = false;

  constructor() {
    this.enabled = process.env.RECORDING_ENABLED === "true";
    this.sessionId =
      process.env.RECORDING_SESSION_ID ||
      `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (this.enabled && process.env.REDIS_URL) {
      this.redis = createClient({ url: process.env.REDIS_URL });
      this.redis.on("error", (err) =>
        console.error("[recorder] Redis error:", err),
      );
      console.log(`[recorder] Recording enabled, session: ${this.sessionId}`);
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis && !this.connected) {
      await this.redis.connect();
      this.connected = true;
    }
  }

  get isEnabled(): boolean {
    return this.enabled && this.redis !== null;
  }

  get currentSessionId(): string {
    return this.sessionId;
  }

  private get redisKey(): string {
    return `recording:${this.sessionId}`;
  }

  /**
   * Record an incoming webhook request.
   */
  async recordWebhook(platform: string, request: Request): Promise<void> {
    if (!this.isEnabled || !this.redis) return;

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const body = await request.clone().text();

    const record: WebhookRecord = {
      type: "webhook",
      timestamp: Date.now(),
      platform,
      method: request.method,
      url: request.url,
      headers,
      body,
    };

    await this.appendRecord(record);
  }

  /**
   * Record an outgoing API call.
   */
  async recordApiCall(
    platform: string,
    method: string,
    args: unknown,
    response?: unknown,
    error?: Error,
  ): Promise<void> {
    if (!this.isEnabled || !this.redis) return;

    const record: ApiCallRecord = {
      type: "api-call",
      timestamp: Date.now(),
      platform,
      method,
      args,
      response,
      error: error?.message,
    };

    await this.appendRecord(record);
  }

  private async appendRecord(record: RecordEntry): Promise<void> {
    if (!this.redis) return;

    try {
      await this.ensureConnected();
      await this.redis.rPush(this.redisKey, JSON.stringify(record));
      await this.redis.expire(this.redisKey, RECORDING_TTL_SECONDS);
    } catch (err) {
      console.error("[recorder] Failed to record:", err);
    }
  }

  /**
   * Get all records for the current session.
   */
  async getRecords(sessionId?: string): Promise<RecordEntry[]> {
    if (!this.redis) return [];

    await this.ensureConnected();
    const key = sessionId ? `recording:${sessionId}` : this.redisKey;
    const entries = await this.redis.lRange(key, 0, -1);
    return entries.map((e) => JSON.parse(e) as RecordEntry);
  }

  /**
   * List all recording sessions.
   */
  async listSessions(): Promise<string[]> {
    if (!this.redis) return [];

    await this.ensureConnected();
    const keys = await this.redis.keys("recording:*");
    return keys.map((k) => k.replace("recording:", ""));
  }

  /**
   * Delete a recording session.
   */
  async deleteSession(sessionId?: string): Promise<void> {
    if (!this.redis) return;

    await this.ensureConnected();
    const key = sessionId ? `recording:${sessionId}` : this.redisKey;
    await this.redis.del(key);
  }

  /**
   * Export records as JSON string.
   */
  async exportRecords(sessionId?: string): Promise<string> {
    const records = await this.getRecords(sessionId);
    return JSON.stringify(records, null, 2);
  }
}

// Singleton instance
export const recorder = new Recorder();

/**
 * Wrap an adapter to record its API calls.
 * Returns a proxy that intercepts method calls.
 */
export function withRecording<T extends object>(
  adapter: T,
  platform: string,
  methodsToRecord: string[],
): T {
  if (!recorder.isEnabled) return adapter;

  return new Proxy(adapter, {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (
        typeof value === "function" &&
        methodsToRecord.includes(prop as string)
      ) {
        return async (...args: unknown[]) => {
          let response: unknown;
          let error: Error | undefined;

          try {
            response = await value.apply(target, args);
            return response;
          } catch (err) {
            error = err as Error;
            throw err;
          } finally {
            await recorder.recordApiCall(
              platform,
              prop as string,
              args,
              response,
              error,
            );
          }
        };
      }

      return value;
    },
  });
}

// CLI: Run this file directly to export recordings
// pnpm --filter example-nextjs-chat exec tsx src/lib/recorder.ts [sessionId]
async function main() {
  // Load .env.local for CLI usage
  try {
    const { config } = await import("dotenv");
    config({ path: ".env.local" });
  } catch {
    // dotenv not available, skip
  }
  const sessionId = process.argv[2];

  if (!process.env.REDIS_URL) {
    console.error("REDIS_URL environment variable is required");
    process.exit(1);
  }

  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();

  try {
    if (sessionId === "--list" || sessionId === "-l") {
      const keys = await redis.keys("recording:*");
      const sessions = keys.map((k) => k.replace("recording:", ""));
      console.log("Recording sessions:");
      for (const s of sessions) {
        const count = await redis.lLen(`recording:${s}`);
        console.log(`  ${s} (${count} entries)`);
      }
    } else if (sessionId === "--help" || sessionId === "-h" || !sessionId) {
      console.log(`
Usage: tsx src/lib/recorder.ts [command|sessionId]

Commands:
  --list, -l     List all recording sessions
  --help, -h     Show this help
  <sessionId>    Export records for a specific session as JSON

Environment:
  REDIS_URL      Redis connection URL (required)
`);
    } else {
      const entries = await redis.lRange(`recording:${sessionId}`, 0, -1);
      if (entries.length === 0) {
        console.error(`No records found for session: ${sessionId}`);
        process.exit(1);
      }
      const records = entries.map((e) => JSON.parse(e));
      console.log(JSON.stringify(records, null, 2));
    }
  } finally {
    await redis.quit();
  }
}

// Run CLI if executed directly
const isMainModule = typeof require !== "undefined" && require.main === module;
const isDirectRun = process.argv[1]?.includes("recorder");
if (isMainModule || isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
