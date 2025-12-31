import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-sdk/gchat";
import { createSlackAdapter, type SlackAdapter } from "@chat-sdk/slack";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-sdk/teams";
import { getVercelOidcToken } from "@vercel/functions/oidc";
import {
  IdentityPoolClient,
  type SubjectTokenSupplier,
} from "google-auth-library";

export type Adapters = {
  slack?: SlackAdapter;
  teams?: TeamsAdapter;
  gchat?: GoogleChatAdapter;
};

/**
 * Custom subject token supplier that retrieves Vercel OIDC tokens.
 */
class VercelOidcSupplier implements SubjectTokenSupplier {
  async getSubjectToken(): Promise<string> {
    return await getVercelOidcToken();
  }
}

/**
 * Create a Google Auth client using Vercel OIDC tokens.
 * Requires env vars from https://vercel.com/docs/security/secure-backend-access/oidc/gcp
 */
function createVercelOIDCAuth() {
  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;

  if (!projectNumber || !poolId || !providerId || !serviceAccountEmail) {
    throw new Error(
      "GCP_PROJECT_NUMBER, GCP_WORKLOAD_IDENTITY_POOL_ID, GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID, and GCP_SERVICE_ACCOUNT_EMAIL are required",
    );
  }

  const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;
  console.log(
    "[gchat] Using Workload Identity Federation with audience:",
    audience,
  );
  const client = new IdentityPoolClient({
    audience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    type: "external_account",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: new VercelOidcSupplier(),
  });
  // Include both Chat API scope and Workspace Events API scopes
  client.scopes = [
    "https://www.googleapis.com/auth/chat.bot",
    "https://www.googleapis.com/auth/chat.spaces.readonly",
    "https://www.googleapis.com/auth/chat.messages.readonly",
  ];
  return client;
}

/**
 * Build type-safe adapters based on available environment variables.
 */
export function buildAdapters(): Adapters {
  const adapters: Adapters = {};

  // Slack adapter
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_SIGNING_SECRET) {
    throw new Error("SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are required");
  }
  adapters.slack = createSlackAdapter({
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  });

  // Teams adapter
  if (!process.env.TEAMS_APP_ID || !process.env.TEAMS_APP_PASSWORD) {
    throw new Error("TEAMS_APP_ID and TEAMS_APP_PASSWORD are required");
  }
  adapters.teams = createTeamsAdapter({
    appId: process.env.TEAMS_APP_ID,
    appPassword: process.env.TEAMS_APP_PASSWORD,
    appType: "SingleTenant",
    appTenantId: process.env.TEAMS_APP_TENANT_ID as string,
    userName: "Chat SDK Demo",
  });

  // Google Chat adapter
  // Optional: Pub/Sub topic for receiving ALL messages (not just @mentions)
  // When set, subscriptions are auto-created when bot is added to a space
  const pubsubTopic = process.env.GOOGLE_CHAT_PUBSUB_TOPIC;

  // Option 1: Service account credentials (JSON key) - supports Pub/Sub subscriptions
  if (process.env.GOOGLE_CHAT_CREDENTIALS) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_CHAT_CREDENTIALS);
      adapters.gchat = createGoogleChatAdapter({
        credentials,
        pubsubTopic, // Auto-subscribe when threads are subscribed
      });
    } catch (e) {
      console.warn("[bot] Failed to parse GOOGLE_CHAT_CREDENTIALS:", e);
    }
  }
  // Option 2: Application Default Credentials (ADC) - supports Pub/Sub subscriptions
  else if (process.env.GOOGLE_CHAT_USE_ADC === "true") {
    adapters.gchat = createGoogleChatAdapter({
      useApplicationDefaultCredentials: true,
      pubsubTopic, // Auto-subscribe when threads are subscribed
    });
  }
  // Option 3: Vercel OIDC (Workload Identity Federation)
  // Uses Workload Identity Federation for keyless auth
  else {
    const vercelAuth = createVercelOIDCAuth();
    adapters.gchat = createGoogleChatAdapter({
      auth: vercelAuth,
      userName: "Chat SDK Demo",
      pubsubTopic, // Now supported with custom auth
    });
  }

  return adapters;
}
