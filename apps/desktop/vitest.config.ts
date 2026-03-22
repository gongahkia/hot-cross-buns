import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";

export default defineConfig({
  plugins: [sveltekit()],

  test: {
    // Use jsdom so Svelte components can mount in a browser-like environment.
    environment: "jsdom",

    // Run the Tauri mock setup before every test file.
    setupFiles: ["src/test/setup.ts"],

    // Include test files from both the co-located and dedicated directories.
    include: [
      "src/**/*.{test,spec}.{js,ts}",
      "tests/unit/**/*.{test,spec}.{js,ts}",
    ],

    // Ensure Svelte 5 runes compile correctly inside tests.
    alias: {
      $lib: "src/lib",
    },

    // Sensible defaults.
    globals: true,
    restoreMocks: true,
  },
});
