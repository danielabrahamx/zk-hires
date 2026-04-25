import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@aztec/bb.js", "better-sqlite3"],
  turbopack: {
    resolveAlias: {
      pino: "pino/browser.js",
    },
  },
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      topLevelAwait: true,
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      pino: "pino/browser.js",
    };
    return config;
  },
};

export default nextConfig;
