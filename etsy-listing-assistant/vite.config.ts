import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export const UI_HOST = "127.0.0.1";
export const UI_PORT = 5173;

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  server: {
    // Bind IPv4 loopback explicitly. With the default "localhost" Node resolves
    // to ::1 only, and browsers on Windows that dial 127.0.0.1 get
    // ERR_CONNECTION_REFUSED. 127.0.0.1 keeps the UI local-only and matches the API.
    host: UI_HOST,
    port: UI_PORT,
    // Fail loudly instead of silently moving to 5174 while the opener and docs say 5173.
    strictPort: true,
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
