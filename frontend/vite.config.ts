import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// D7 Frontend — Vite 5 config
// GitHub Pages deployment: base = /dispatch-seven/
// Vercel deployment: base = /
const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    port: 3000,
    proxy: { "/api": "http://localhost:3001" }
  },
  build: { outDir: "dist" },
});
