import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse pulls pdf.js; keeping it external avoids broken worker resolution in the bundle.
  serverExternalPackages: ["pdf-parse", "better-sqlite3"],
};

export default nextConfig;
