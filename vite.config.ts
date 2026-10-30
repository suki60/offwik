import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Stage 7, step 4: the web app's dev server (npm run dev, port 5173).
// The browser only talks to this server. The proxy forwards:
// - /ollama/* to Ollama (embeddings + chat), without the /ollama prefix
// - /api/*    to server.ts (search)
// Same origin for everything, so no CORS setup in Ollama or server.ts.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ollama": {
        target: "http://localhost:11434",
        rewrite: (path) => path.replace(/^\/ollama/, ""),
      },
      "/api": "http://localhost:3000",
    },
  },
});
