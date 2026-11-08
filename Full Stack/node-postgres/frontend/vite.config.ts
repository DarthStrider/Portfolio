import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In local dev (npm run dev), /api calls are forwarded to an API running on :8080.
// In Docker and Kubernetes, nginx does this forwarding instead (see nginx.conf).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:8080" },
  },
});
