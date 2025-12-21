import type { Lock, StateAdapter } from "chat-sdk";

interface MemoryLock extends Lock {
  threadId: string;
  token: string;
  expiresAt: number;
}

/**
 * In-memory state adapter for development and testing.
 *
 * WARNING: State is not persisted across restarts.
 * Use RedisStateAdapter for production.
 */
export class MemoryStateAdapter implements StateAdapter {
  private subscriptions = new Set<string>();
  private locks = new Map<string, MemoryLock>();
  private connected = false;

  async connect(): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[chat-sdk] MemoryStateAdapter is not recommended for production. " +
          "Consider using @chat-sdk/state-redis instead.",
      );
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.subscriptions.clear();
    this.locks.clear();
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    this.subscriptions.add(threadId);
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    this.subscriptions.delete(threadId);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();
    return this.subscriptions.has(threadId);
  }

  async *listSubscriptions(adapterName?: string): AsyncIterable<string> {
    this.ensureConnected();

    for (const threadId of this.subscriptions) {
      if (adapterName) {
        // Thread ID format: "adapter:channel:thread"
        if (threadId.startsWith(`${adapterName}:`)) {
          yield threadId;
        }
      } else {
        yield threadId;
      }
    }
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();
    this.cleanExpiredLocks();

    // Check if already locked
    const existingLock = this.locks.get(threadId);
    if (existingLock && existingLock.expiresAt > Date.now()) {
      return null;
    }

    // Create new lock
    const lock: MemoryLock = {
      threadId,
      token: generateToken(),
      expiresAt: Date.now() + ttlMs,
    };

    this.locks.set(threadId, lock);
    return lock;
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();

    const existingLock = this.locks.get(lock.threadId);
    if (existingLock && existingLock.token === lock.token) {
      this.locks.delete(lock.threadId);
    }
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const existingLock = this.locks.get(lock.threadId);
    if (!existingLock || existingLock.token !== lock.token) {
      return false;
    }

    if (existingLock.expiresAt < Date.now()) {
      // Lock has already expired
      this.locks.delete(lock.threadId);
      return false;
    }

    // Extend the lock
    existingLock.expiresAt = Date.now() + ttlMs;
    return true;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "MemoryStateAdapter is not connected. Call connect() first.",
      );
    }
  }

  private cleanExpiredLocks(): void {
    const now = Date.now();
    for (const [threadId, lock] of this.locks) {
      if (lock.expiresAt <= now) {
        this.locks.delete(threadId);
      }
    }
  }

  // For testing purposes
  _getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  _getLockCount(): number {
    this.cleanExpiredLocks();
    return this.locks.size;
  }
}

function generateToken(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

export function createMemoryState(): MemoryStateAdapter {
  return new MemoryStateAdapter();
}
