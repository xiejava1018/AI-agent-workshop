import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  serverExternalPackages: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"],
  allowedDevOrigins: ['192.168.*.*'],
  // Monorepo: pin Turbopack to this app's directory so Next doesn't walk up
  // and mistake an unrelated lockfile (e.g. ~/pnpm-lock.yaml) for the root.
  turbopack: {
    root: __dirname,
  },
  // M2.2 follow-up: redirect bare paths to default locale.
  // next.config.ts redirects run BEFORE middleware, so they bypass
  // the JWT-gate matcher exclusion issue (path-to-regexp v8 alternation
  // for the bare / and /en cases is fragile). App page also has a
  // server redirect as a defense-in-depth fallback.
  async redirects() {
    return [
      { source: '/', destination: '/en', permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
