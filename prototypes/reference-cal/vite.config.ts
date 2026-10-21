import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/vendor", import.meta.url)),
      "@renderer": fileURLToPath(new URL("../../src/renderer/src", import.meta.url)),
      "@shared": fileURLToPath(new URL("../../src/shared", import.meta.url))
    },
    dedupe: ["react", "react-dom"]
  },
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  build: { outDir: "dist", emptyOutDir: true }
});
