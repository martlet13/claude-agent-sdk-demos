import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    open: process.env.ETSY_ASSISTANT_NO_OPEN === "1" ? false : "http://127.0.0.1:5173",
    proxy: {
      // Trailing slashes so Vite does not proxy a client module like /api.ts.
      "/api/": "http://127.0.0.1:8787",
      "/media/": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
