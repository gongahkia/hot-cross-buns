import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const fromRoot = (path: string) => resolve(__dirname, path);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@main": fromRoot("src/main"),
        "@shared": fromRoot("src/shared")
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: fromRoot("src/main/index.ts")
        }
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        "@preload": fromRoot("src/preload"),
        "@shared": fromRoot("src/shared")
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: fromRoot("src/preload/index.ts")
        },
        external: ["electron"]
      }
    }
  },
  renderer: {
    root: fromRoot("src/renderer"),
    plugins: [react()],
    resolve: {
      alias: {
        "@renderer": fromRoot("src/renderer/src"),
        "@shared": fromRoot("src/shared")
      }
    }
  }
});
