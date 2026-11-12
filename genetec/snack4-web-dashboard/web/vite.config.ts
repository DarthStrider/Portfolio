import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// npm run dev: the page on :5173, forwarding /api to the API on :5080.
// npm run build: writes the page into the API's wwwroot, so the API serves both on one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:5080" },
  },
  build: {
    outDir: "../api/Dashboard.Api/wwwroot",
    emptyOutDir: true,
  },
});
