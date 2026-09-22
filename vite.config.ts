import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3030,
    proxy: {
      // Avoid browser CORS on the free image host.
      "/imagine": {
        target: "https://image.pollinations.ai",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/imagine/, "/prompt"),
      },
    },
  },
});
