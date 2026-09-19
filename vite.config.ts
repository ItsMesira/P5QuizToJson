import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    // loopback by default — run `npm run dev -- --host` to expose deliberately
    host: "127.0.0.1",
    allowedHosts: [
      "localhost",
      "127.0.0.1",
      ".ngrok-free.dev",
      ".ngrok-free.app",
      ".ngrok.io",
    ],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 900,
  },
});
