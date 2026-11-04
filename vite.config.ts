import { existsSync, readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Stage 8: HTTPS so the iPhone gets a secure origin (WebGPU is hidden on
// plain http, except on localhost). certs/ is made by mkcert and ignored by
// git; without it the server stays plain http on localhost.
const hasCerts = existsSync("certs/key.pem") && existsSync("certs/cert.pem");

// Stage 7, step 4: the web app's dev server (npm run dev, port 5173).
// Since stage 9 embedding and search run in the browser (server.ts and its
// /api proxy are gone, see commit b0f7fae), and since stage 10 the answer
// too, so the /ollama proxy is gone as well (see commit f95ccc9).
export default defineConfig({
  plugins: [react()],
  // Stage 10: dist/asset-manifest.json lists every file of the build, so the
  // service worker (public/sw.js) can cache them all when it installs. Not
  // the default .vite/manifest.json: `vite preview` doesn't serve dot folders.
  build: { manifest: "asset-manifest.json" },
  // `npm run preview` serves dist/ and reuses server's host and https.
  server: {
    // Listen on the Wi-Fi too (not only localhost), so the phone can connect.
    host: hasCerts,
    https: hasCerts
      ? {
          key: readFileSync("certs/key.pem"),
          cert: readFileSync("certs/cert.pem"),
        }
      : undefined,
  },
});
