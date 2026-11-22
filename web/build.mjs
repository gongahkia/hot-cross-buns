import mathjaxPackage from "mathjax-full/package.json" with { type: "json" };
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

export function buildBrowserDependencies() {
  return build({
    absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
    entryPoints: ["render-deps.mjs", "mermaid-entry.mjs", "math-entry.mjs", "icons-entry.mjs"],
    outdir: ".build", define: { PACKAGE_VERSION: JSON.stringify(mathjaxPackage.version) },
    bundle: true, splitting: true, format: "esm",
    outExtension: { ".js": ".mjs" }, minify: true, target: "es2022",
    logLevel: "warning",
  });
}
