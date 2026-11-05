import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

// The service worker (public/sw.js) lets the app open offline. Only in
// builds: in `npm run dev` it would cache dev files that change on every edit.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");
createRoot(root).render(<App />);
