import { existsSync, readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// HTTPS when certs/ exists (made by hand, gitignored): the iPhone only gets
// WebGPU and service workers on a secure origin. Without certs, plain http on
// localhost.
const hasCerts = existsSync("certs/key.pem");

export default defineConfig({
  plugins: [react()],
  // dist/asset-manifest.json lists the build's files for public/sw.js to
  // cache (the default .vite/manifest.json isn't served: dot folder).
  build: { manifest: "asset-manifest.json" },
  // Also used by `npm run preview`.
  server: {
    // Listen on the Wi-Fi too, so the phone can connect.
    host: hasCerts,
    https: hasCerts
      ? {
          key: readFileSync("certs/key.pem"),
          cert: readFileSync("certs/cert.pem"),
        }
      : undefined,
  },
});
