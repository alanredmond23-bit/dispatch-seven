import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// D7 Frontend — Vite 5 config
// Deploys to Netlify via main branch CI
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3000, proxy: { "/api": "http://localhost:3001" } },
  build: { outDir: "dist" },
});
