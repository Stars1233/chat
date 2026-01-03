/**
 * Fixture data extracted from recordings for fetchMessages tests.
 * These are the raw API responses from actual platform calls.
 */

// GChat fixture data
export const GCHAT_THREAD_ID =
  "gchat:spaces/AAQAO1heGsE:c3BhY2VzL0FBUUFPMWhlR3NFL3RocmVhZHMvN2tJaS14N1NEQVk";
export const GCHAT_SPACE = "spaces/AAQAO1heGsE";
export const GCHAT_THREAD = "spaces/AAQAO1heGsE/threads/7kIi-x7SDAY";
export const GCHAT_BOT_USER_ID = "users/113977916201552346146";
export const GCHAT_HUMAN_USER_ID = "users/117994873354375860089";

// Raw GChat messages as returned by the API (messages.list)
export const GCHAT_RAW_MESSAGES = [
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.7kIi-x7SDAY",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:24.703183Z",
    text: "@Chat SDK Demo Hey",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.zQJx8Wa0z_4",
    sender: { name: GCHAT_BOT_USER_ID, type: "BOT" },
    createTime: "2026-01-03T18:12:26.338079Z",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
    cardsV2: [{ cardId: "card-1", card: { header: { title: "Welcome!" } } }],
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.2uWgiC1K31g",
    sender: { name: GCHAT_BOT_USER_ID, type: "BOT" },
    createTime: "2026-01-03T18:12:32.026415Z",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
    cardsV2: [
      {
        cardId: "card-2",
        card: { header: { title: "Message Fetch Results" } },
      },
    ],
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.fWAPBm3mNwk",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:38.835519Z",
    text: "1",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.N7qC3VnngCE",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:39.447967Z",
    text: "2",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.koeoAynQTZY",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:40.132847Z",
    text: "3",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.hHWZqw7H3Fw",
    sender: { name: GCHAT_BOT_USER_ID, type: "BOT" },
    createTime: "2026-01-03T18:12:40.802479Z",
    text: "✅ Thanks for your message!",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.qcbjxe8HLfs",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:40.992575Z",
    text: "4",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.gIEY6fhjBdg",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:41.530415Z",
    text: "5",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.ZuwwXpHWaF4",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:42.014527Z",
    text: "6",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.E0NgNX8--dk",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:42.492255Z",
    text: "7",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.hoaTCJFshR0",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:43.415535Z",
    text: "8",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.-7Ie_Ne0CAI",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:44.543423Z",
    text: "9",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.d8-cIESZWlA",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:45.031519Z",
    text: "10",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.Y3YNVC8aH60",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:45.887647Z",
    text: "11",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.A3Yd5Mh8hkE",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:46.541663Z",
    text: "12",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.n5Jae9b02GA",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:47.529295Z",
    text: "13",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.K2PGAMXcXYc",
    sender: { name: GCHAT_BOT_USER_ID, type: "BOT" },
    createTime: "2026-01-03T18:12:47.732639Z",
    text: "✅ Thanks for your message!",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
  {
    name: "spaces/AAQAO1heGsE/messages/7kIi-x7SDAY.LJ9BPxaYIcg",
    sender: { name: GCHAT_HUMAN_USER_ID, type: "HUMAN" },
    createTime: "2026-01-03T18:12:49.880095Z",
    text: "14",
    thread: { name: GCHAT_THREAD },
    space: { name: GCHAT_SPACE },
  },
];

// Slack fixture data
export const SLACK_CHANNEL = "C0A511MBCUW";
export const SLACK_THREAD_TS = "1767463909.801009";
export const SLACK_THREAD_ID = `slack:${SLACK_CHANNEL}:${SLACK_THREAD_TS}`;
export const SLACK_BOT_USER_ID = "U0A56JUFP9A";
export const SLACK_HUMAN_USER_ID = "U03STHCA1JM";

// Raw Slack messages as returned by the API (conversations.replies)
export const SLACK_RAW_MESSAGES = [
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463909.801009",
    text: "<@U0A56JUFP9A> Hey",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_BOT_USER_ID,
    type: "message",
    ts: "1767463912.389869",
    bot_id: "B0A5XAH4F6U",
    text: "*:wave: Welcome!* Connected via slack",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_BOT_USER_ID,
    type: "message",
    ts: "1767463915.639159",
    bot_id: "B0A5XAH4F6U",
    text: "*:memo: Message Fetch Results*",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463918.512379",
    text: "1",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463919.069289",
    text: "2",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463919.900679",
    text: "3",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463920.336619",
    text: "4",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463920.988659",
    text: "5",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_BOT_USER_ID,
    type: "message",
    ts: "1767463921.893159",
    bot_id: "B0A5XAH4F6U",
    text: ":white_check_mark: Thanks for your message!",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463921.917609",
    text: "6",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463922.271059",
    text: "7",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463923.142709",
    text: "8",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463923.556219",
    text: "9",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463925.399189",
    text: "10",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463926.169239",
    text: "11",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463927.322589",
    text: "12",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_BOT_USER_ID,
    type: "message",
    ts: "1767463927.615339",
    bot_id: "B0A5XAH4F6U",
    text: ":white_check_mark: Thanks for your message!",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463928.143519",
    text: "13",
    thread_ts: SLACK_THREAD_TS,
  },
  {
    user: SLACK_HUMAN_USER_ID,
    type: "message",
    ts: "1767463929.427789",
    text: "14",
    thread_ts: SLACK_THREAD_TS,
  },
];

// Expected numbered messages in chronological order (1-14)
export const EXPECTED_NUMBERED_TEXTS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
];
