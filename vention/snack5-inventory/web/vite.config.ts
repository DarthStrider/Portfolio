import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, /api goes to the API on port 8080 (npm start in ../api).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8080" } },
});
