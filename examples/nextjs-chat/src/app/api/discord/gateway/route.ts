import { after } from "next/server";
import { createClient } from "redis";
import { bot } from "@/lib/bot";

export const maxDuration = 800;

const GATEWAY_CHANNEL = "discord:gateway:control";
// Default listener duration: 10 minutes
const DEFAULT_DURATION_MS = 600 * 1000;

/**
 * Start the Discord Gateway WebSocket listener.
 * This keeps a WebSocket connection open for up to 10 minutes to receive messages.
 *
 * Uses Redis pub/sub to coordinate multiple listeners:
 * - When a new listener starts, it publishes a message to shut down existing listeners
 * - Existing listeners subscribe and gracefully shut down when they receive the message
 *
 * This endpoint is invoked by a Vercel cron job every 9 minutes to maintain
 * continuous Gateway connectivity with overlapping listeners.
 *
 * Security: Requires CRON_SECRET validation when configured.
 *
 * Usage: GET /api/discord/gateway
 * Optional query param: ?duration=600000 (milliseconds, max 600000)
 */
export async function GET(request: Request): Promise<Response> {
  // Validate CRON_SECRET if configured (required in production)
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[discord-gateway] CRON_SECRET not configured");
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.log("[discord-gateway] Unauthorized: invalid CRON_SECRET");
    return new Response("Unauthorized", { status: 401 });
  }

  // Generate unique listener ID per request
  const listenerId = `listener-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  console.log(`[discord-gateway] Starting gateway listener: ${listenerId}`);

  // Ensure bot is initialized (this normally happens on first webhook)
  await bot.initialize();

  const discord = bot.getAdapter("discord");

  if (!discord) {
    console.log("[discord-gateway] Discord adapter not configured");
    return new Response("Discord adapter not configured", { status: 404 });
  }

  // Get duration from query params (default: 10 minutes)
  const url = new URL(request.url);
  const durationParam = url.searchParams.get("duration");
  const durationMs = durationParam
    ? parseInt(durationParam, 10)
    : DEFAULT_DURATION_MS;

  // Cap at 10 minutes to avoid runaway costs
  const actualDuration = Math.min(durationMs, DEFAULT_DURATION_MS);

  // Set up Redis pub/sub for listener coordination
  let abortController: AbortController | undefined;

  if (process.env.REDIS_URL) {
    abortController = new AbortController();

    // Run the pub/sub coordination in the background
    after(async () => {
      const pubClient = createClient({ url: process.env.REDIS_URL });
      const subClient = pubClient.duplicate();

      try {
        await Promise.all([pubClient.connect(), subClient.connect()]);

        // Subscribe to shutdown signals
        await subClient.subscribe(GATEWAY_CHANNEL, (message) => {
          // Ignore our own startup message
          if (message === listenerId) return;

          console.log(
            `[discord-gateway] ${listenerId} received shutdown signal from ${message}`,
          );
          abortController?.abort();
        });

        // Publish that we're starting (this will shut down other listeners)
        await pubClient.publish(GATEWAY_CHANNEL, listenerId);
        console.log(
          `[discord-gateway] Published startup signal: ${listenerId}`,
        );

        // Keep subscription alive until abort or timeout
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, actualDuration + 5000);

          abortController?.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        });
      } catch (error) {
        console.error("[discord-gateway] Redis pub/sub error:", error);
      } finally {
        await subClient.unsubscribe(GATEWAY_CHANNEL).catch(() => {});
        await Promise.all([
          pubClient.quit().catch(() => {}),
          subClient.quit().catch(() => {}),
        ]);
        console.log(`[discord-gateway] ${listenerId} pub/sub cleanup complete`);
      }
    });
  }

  // Construct webhook URL for forwarding Gateway events
  // Use production URL if available, otherwise fall back to VERCEL_URL
  const baseUrl =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    process.env.NEXT_PUBLIC_BASE_URL;
  let webhookUrl: string | undefined;
  if (baseUrl) {
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    const queryParam = bypassSecret
      ? `?x-vercel-protection-bypass=${bypassSecret}`
      : "";
    webhookUrl = `https://${baseUrl}/api/webhooks/discord${queryParam}`;
  }

  try {
    console.log(`[discord-gateway] Calling startGatewayListener`, {
      webhookUrl: webhookUrl ? "configured" : "not configured",
    });
    const response = await discord.startGatewayListener(
      {
        waitUntil: (task: Promise<unknown>) => after(() => task),
      },
      actualDuration,
      abortController?.signal,
      webhookUrl,
    );
    console.log(
      `[discord-gateway] startGatewayListener returned status: ${response.status}`,
    );
    return response;
  } catch (error) {
    console.error("[discord-gateway] Error in startGatewayListener:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to start gateway listener",
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
