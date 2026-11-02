import { existsSync, readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Stage 8: HTTPS so the iPhone gets a secure origin (WebGPU is hidden on
// plain http, except on localhost). certs/ is made by mkcert and ignored by
// git; without it the server stays plain http on localhost.
const hasCerts = existsSync("certs/key.pem") && existsSync("certs/cert.pem");

// Stage 7, step 4: the web app's dev server (npm run dev, port 5173).
// The browser only talks to this server. The proxy forwards:
// - /ollama/* to Ollama (embeddings + chat), without the /ollama prefix
// - /api/*    to server.ts (search)
// Same origin for everything, so no CORS setup in Ollama or server.ts.
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on the Wi-Fi too (not only localhost), so the phone can connect.
    host: hasCerts,
    https: hasCerts
      ? {
          key: readFileSync("certs/key.pem"),
          cert: readFileSync("certs/cert.pem"),
        }
      : undefined,
    proxy: {
      "/ollama": {
        target: "http://localhost:11434",
        rewrite: (path) => path.replace(/^\/ollama/, ""),
      },
      "/api": "http://localhost:3000",
    },
  },
});
