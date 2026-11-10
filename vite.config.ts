import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  // String shorthand enables changeOrigin in Vite and replaces the browser Host.
  // Preserve Host so the API can enforce the browser's original same-origin check.
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:3001", changeOrigin: false } },
  },
  build: {
    rollupOptions: { output: { manualChunks: { charts: ["recharts"] } } },
  },
});
