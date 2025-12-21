export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Chat SDK Example</h1>
      <p>This is an example Next.js app using chat-sdk.</p>

      <h2>Webhook Endpoints</h2>
      <ul>
        <li>
          <code>/api/webhooks/slack</code> - Slack events
        </li>
        <li>
          <code>/api/webhooks/teams</code> - Microsoft Teams events
        </li>
        <li>
          <code>/api/webhooks/gchat</code> - Google Chat events
        </li>
        <li>
          <code>/api/webhooks/discord</code> - Discord events
        </li>
      </ul>

      <h2>Configuration</h2>
      <p>Set the following environment variables to enable each platform:</p>

      <h3>Slack</h3>
      <pre>
        {`SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...`}
      </pre>

      <h3>Microsoft Teams</h3>
      <pre>
        {`TEAMS_APP_ID=...
TEAMS_APP_PASSWORD=...`}
      </pre>

      <h3>Google Chat</h3>
      <pre>{`GOOGLE_CHAT_CREDENTIALS={"type":"service_account",...}`}</pre>

      <h3>Discord</h3>
      <pre>
        {`DISCORD_BOT_TOKEN=...
DISCORD_PUBLIC_KEY=...`}
      </pre>
    </main>
  );
}
