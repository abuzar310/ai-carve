import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3030,
    proxy: {
      "/api/imagine": {
        target: "https://image.pollinations.ai",
        changeOrigin: true,
        rewrite: (path) => {
          const q = new URL(path, "http://vite.local").searchParams;
          const prompt = q.get("prompt") || "wood carving";
          const seed = q.get("seed") || "1";
          return "/prompt/" + encodeURIComponent(prompt) + "?width=768&height=768&nologo=true&seed=" + seed;
        },
      },
    },
  },
});
