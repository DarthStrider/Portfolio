import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the app on :5173 and forwards API calls to the gateway,
// so the browser still sees one origin (cookies and all) like in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8090" },
  },
});
