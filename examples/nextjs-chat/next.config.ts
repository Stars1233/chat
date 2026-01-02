import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "chat",
    "@chat-adapter/slack",
    "@chat-adapter/state-memory",
    "@chat-adapter/state-redis",
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
