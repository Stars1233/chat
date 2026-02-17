import { MessageCircleIcon } from "lucide-react";

export const Logo = () => (
  <div className="flex items-center gap-2">
    <MessageCircleIcon className="size-5" />
    <p className="font-semibold text-xl tracking-tight">Chat SDK</p>
  </div>
);

export const github = {
  owner: "vercel",
  repo: "chat",
};

export const nav = [
  {
    label: "Docs",
    href: "/docs",
  },
  {
    label: "Source",
    href: `https://github.com/${github.owner}/${github.repo}/`,
  },
];

export const suggestions = [
  "What is Chat SDK?",
  "What can I make with Chat SDK?",
  "What syntax does Chat SDK support?",
  "How do I deploy my Chat SDK site?",
];

export const title = "Chat SDK Documentation";

export const prompt =
  "You are a helpful assistant specializing in answering questions about Chat SDK, a unified SDK for building chat bots across Slack, Microsoft Teams, Google Chat, Discord, and more.";

export const translations = {
  en: {
    displayName: "English",
  },
};

export const basePath: string | undefined = undefined;

/**
 * Unique identifier for this site, used in markdown request tracking analytics.
 * Each site using geistdocs should set this to a unique value (e.g. "ai-sdk-docs", "next-docs").
 */
export const siteId: string | undefined = 'chat-sdk';
