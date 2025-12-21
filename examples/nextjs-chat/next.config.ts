import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["chat-sdk", "@chat-sdk/slack", "@chat-sdk/state-memory", "@chat-sdk/state-redis"],
};

export default nextConfig;
