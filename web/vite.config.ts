import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

const rootDirectory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.1.0")
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png", "sw-notifications.js"],
      manifest: {
        name: "Hot Cross Buns",
        short_name: "Hot Cross Buns",
        description: "A browser-local Google Tasks and Calendar workspace.",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        file_handlers: [{
          action: "/",
          accept: {
            "text/plain": [".txt", ".hcb"],
            "text/csv": [".csv"],
            "text/calendar": [".ics", ".ical"]
          }
        }],
        icons: [
          {
            src: "/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any"
          },
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable"
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        navigateFallbackDenylist: [/^\/api\//],
        importScripts: ["sw-notifications.js"]
      }
    })
  ],
  resolve: {
    alias: {
      "@": resolve(rootDirectory, "./src")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    globals: true,
    clearMocks: true
  }
});
