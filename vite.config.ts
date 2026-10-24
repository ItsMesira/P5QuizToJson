import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

export default defineConfig({
  base: "./",
  plugins: [tailwindcss()],
  resolve: {
    /* shadcn convention — the brief's demo imports "@/components/ui/..." */
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    // loopback by default — run `npm run dev -- --host` to expose deliberately
    host: "127.0.0.1",
    fs: {
      /* This worktree symlinks node_modules to the existing app. Vite's fs
         guard otherwise 403s the font files behind the symlink. */
      allow: [fileURLToPath(new URL(".", import.meta.url)), realpathSync(fileURLToPath(new URL("./node_modules", import.meta.url)))],
    },
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
    rollupOptions: {
      onwarn(warning, warn) {
        /* framer-motion ships "use client" banners for Next.js; Rollup ignores
           them and warns once per file — dozens of lines that would bury a real
           warning. Only suppressed when it comes from node_modules. */
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          /node_modules/.test(warning.id ?? "")
        ) {
          return;
        }
        warn(warning);
      },
    },
  },
});
