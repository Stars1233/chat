import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-sdk/gchat";
import { createSlackAdapter, type SlackAdapter } from "@chat-sdk/slack";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-sdk/teams";
import {
  IdentityPoolClient,
  type SubjectTokenSupplier,
} from "google-auth-library";
import { getVercelOidcToken } from "@vercel/functions/oidc";

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
    return null;
  }

  const client = new IdentityPoolClient({
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: new VercelOidcSupplier(),
  });
  client.scopes = ["https://www.googleapis.com/auth/chat.bot"];
  return client;
}

/**
 * Build type-safe adapters based on available environment variables.
 */
export function buildAdapters(): Adapters {
  const adapters: Adapters = {};

  // Slack adapter
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET) {
    adapters.slack = createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
    });
  }

  // Teams adapter
  if (process.env.TEAMS_APP_ID && process.env.TEAMS_APP_PASSWORD) {
    adapters.teams = createTeamsAdapter({
      appId: process.env.TEAMS_APP_ID,
      appPassword: process.env.TEAMS_APP_PASSWORD,
    });
  }

  // Google Chat adapter
  // Option 1: Vercel OIDC (Workload Identity Federation)
  const vercelAuth = createVercelOIDCAuth();
  if (vercelAuth) {
    adapters.gchat = createGoogleChatAdapter({ auth: vercelAuth });
  }
  // Option 2: Service account credentials (JSON key)
  else if (process.env.GOOGLE_CHAT_CREDENTIALS) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_CHAT_CREDENTIALS);
      adapters.gchat = createGoogleChatAdapter({ credentials });
    } catch (e) {
      console.warn("[bot] Failed to parse GOOGLE_CHAT_CREDENTIALS:", e);
    }
  }
  // Option 3: Application Default Credentials (ADC)
  else if (process.env.GOOGLE_CHAT_USE_ADC === "true") {
    adapters.gchat = createGoogleChatAdapter({
      useApplicationDefaultCredentials: true,
    });
  }

  return adapters;
}
