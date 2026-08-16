import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Hot Cross Buns",
        short_name: "Hot Cross Buns",
        description: "A browser-local Google Tasks and Calendar workspace.",
        theme_color: "#f5efe4",
        background_color: "#f5efe4",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        navigateFallbackDenylist: [/^\/api\//]
      }
    })
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    clearMocks: true
  }
});
