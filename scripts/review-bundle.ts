import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { extname, join, relative, resolve } from "node:path";
import packageJson from "../package.json";

const OUT_DIR = resolve("out");
const MAIN_DIR = join(OUT_DIR, "main");
const PRELOAD_DIR = join(OUT_DIR, "preload");
const RENDERER_DIR = join(OUT_DIR, "renderer");
const REPORT_DIR = resolve("artifacts", "release");
const REPORT_JSON = join(REPORT_DIR, "bundle-review.json");
const REPORT_MD = join(REPORT_DIR, "bundle-review.md");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const RENDERER_SOURCE_DIR = resolve("src", "renderer");
const PRELOAD_SOURCE_DIR = resolve("src", "preload");
const forbiddenRendererImportPrefixes = [
  "electron",
  "node:",
  "fs",
  "fs/",
  "path",
  "path/",
  "child_process",
  "worker_threads",
  "net",
  "http",
  "https",
  "@main",
  "@main/",
  "@preload",
  "@preload/",
  "../main",
  "../../main",
  "../preload",
  "../../preload"
];
const forbiddenPreloadImportPrefixes = ["@main", "@main/", "../main", "../../main"];
const devOnlyRuntimeDependencies = new Set([
  "@playwright/test",
  "@testing-library/jest-dom",
  "@testing-library/react",
  "@testing-library/user-event",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "@vitejs/plugin-react",
  "autoprefixer",
  "electron",
  "electron-builder",
  "electron-vite",
  "jsdom",
  "postcss",
  "tailwindcss",
  "tsx",
  "typescript",
  "vite",
  "vitest"
]);
const nativeExternalRuntimeDependencies = new Set(["better-sqlite3"]);

interface FileSize {
  path: string;
  bytes: number;
}

interface ImportViolation {
  file: string;
  importPath: string;
}

interface ReviewReport {
  generatedAt: string;
  runtimeDependencies: string[];
  devDependencies: string[];
  externalMainOrPreloadRequires: string[];
  rendererAssetBytes: number;
  mainAssetBytes: number;
  preloadAssetBytes: number;
  largestRendererAssets: FileSize[];
  issues: string[];
  rendererImportViolations: ImportViolation[];
  preloadImportViolations: ImportViolation[];
}

async function ensureBuiltOutput(): Promise<void> {
  const requiredFiles = [
    join(MAIN_DIR, "index.js"),
    join(PRELOAD_DIR, "index.js"),
    join(RENDERER_DIR, "index.html")
  ];

  for (const filePath of requiredFiles) {
    if (!existsSync(filePath)) {
      throw new Error(`Missing ${relative(process.cwd(), filePath)}. Run pnpm build first.`);
    }
  }
}

async function walkFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const filePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return walkFiles(filePath);
      }

      return [filePath];
    })
  );

  return files.flat();
}

async function totalBytes(directory: string): Promise<number> {
  const files = await walkFiles(directory);
  const sizes = await Promise.all(files.map((file) => stat(file)));

  return sizes.reduce((total, size) => total + size.size, 0);
}

async function largestFiles(directory: string, limit: number): Promise<FileSize[]> {
  const files = await walkFiles(directory);
  const sizes = await Promise.all(
    files.map(async (file) => ({
      path: relative(process.cwd(), file),
      bytes: (await stat(file)).size
    }))
  );

  return sizes.sort((left, right) => right.bytes - left.bytes).slice(0, limit);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round((bytes / 1024) * 10) / 10} KiB`;
  }

  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MiB`;
}

function importsFrom(source: string): string[] {
  const imports = new Set<string>();
  const patterns = [
    /import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g,
    /export\s+(?:type\s+)?[^'"]+\s+from\s+["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.add(match[1]);
    }
  }

  return [...imports];
}

function isForbiddenImport(importPath: string, prefixes: readonly string[]): boolean {
  if (prefixes.some((prefix) => importPath === prefix || importPath.startsWith(prefix))) {
    return true;
  }

  return builtinModules.some(
    (moduleName) => importPath === moduleName || importPath.startsWith(`${moduleName}/`)
  );
}

async function importViolations(
  directory: string,
  prefixes: readonly string[]
): Promise<ImportViolation[]> {
  const files = (await walkFiles(directory)).filter(
    (file) =>
      SOURCE_EXTENSIONS.has(extname(file)) &&
      !file.endsWith(".test.ts") &&
      !file.endsWith(".test.tsx") &&
      !file.endsWith(".test.js") &&
      !file.endsWith(".test.jsx")
  );
  const violations: ImportViolation[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");

    for (const importPath of importsFrom(source)) {
      if (isForbiddenImport(importPath, prefixes)) {
        violations.push({
          file: relative(process.cwd(), file),
          importPath
        });
      }
    }
  }

  return violations;
}

function dependencyIssues(runtimeDependencies: readonly string[]): string[] {
  return runtimeDependencies
    .filter((dependency) => devOnlyRuntimeDependencies.has(dependency))
    .map((dependency) => `${dependency} is listed as a runtime dependency but should stay dev-only.`);
}

async function externalDependencyRequires(
  files: readonly string[],
  dependencyNames: readonly string[]
): Promise<string[]> {
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  const externalRequires = dependencyNames.filter((dependency) => {
    const escapedDependency = dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`require\\(\\s*["']${escapedDependency}(?:/[^"']*)?["']\\s*\\)`);

    return pattern.test(source);
  });

  return externalRequires.sort();
}

function markdownReport(report: ReviewReport): string {
  const lines = [
    "# Bundle And Dependency Review",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Output Sizes",
    "",
    `- Main: ${formatBytes(report.mainAssetBytes)}`,
    `- Preload: ${formatBytes(report.preloadAssetBytes)}`,
    `- Renderer: ${formatBytes(report.rendererAssetBytes)}`,
    "",
    "## Largest Renderer Assets",
    "",
    ...report.largestRendererAssets.map((asset) => `- ${asset.path}: ${formatBytes(asset.bytes)}`),
    "",
    "## Runtime Dependencies",
    "",
    ...report.runtimeDependencies.map((dependency) => `- ${dependency}`),
    "",
    "## External Main/Preload Requires",
    "",
    ...(report.externalMainOrPreloadRequires.length === 0
      ? ["- None"]
      : report.externalMainOrPreloadRequires.map((dependency) => `- ${dependency}`)),
    "",
    "## Issues",
    "",
    ...(report.issues.length === 0 ? ["- None"] : report.issues.map((issue) => `- ${issue}`)),
    ""
  ];

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  await ensureBuiltOutput();

  const runtimeDependencies = Object.keys(packageJson.dependencies ?? {}).sort();
  const devDependencies = Object.keys(packageJson.devDependencies ?? {}).sort();
  const externalMainOrPreloadRequires = await externalDependencyRequires(
    [join(MAIN_DIR, "index.js"), join(PRELOAD_DIR, "index.js")],
    runtimeDependencies
  );
  const unexpectedExternalMainOrPreloadRequires = externalMainOrPreloadRequires.filter(
    (dependency) => !nativeExternalRuntimeDependencies.has(dependency)
  );
  const rendererImportViolations = await importViolations(
    RENDERER_SOURCE_DIR,
    forbiddenRendererImportPrefixes
  );
  const preloadImportViolations = await importViolations(
    PRELOAD_SOURCE_DIR,
    forbiddenPreloadImportPrefixes
  );
  const issues = [
    ...dependencyIssues(runtimeDependencies),
    ...unexpectedExternalMainOrPreloadRequires.map(
      (dependency) =>
        `${dependency} is required externally by main/preload; bundle it or document why it must ship in node_modules.`
    ),
    ...rendererImportViolations.map(
      (violation) => `${violation.file} imports privileged module ${violation.importPath}.`
    ),
    ...preloadImportViolations.map(
      (violation) => `${violation.file} imports main-process module ${violation.importPath}.`
    )
  ];
  const report: ReviewReport = {
    generatedAt: new Date().toISOString(),
    runtimeDependencies,
    devDependencies,
    externalMainOrPreloadRequires,
    rendererAssetBytes: await totalBytes(RENDERER_DIR),
    mainAssetBytes: await totalBytes(MAIN_DIR),
    preloadAssetBytes: await totalBytes(PRELOAD_DIR),
    largestRendererAssets: await largestFiles(RENDERER_DIR, 10),
    issues,
    rendererImportViolations,
    preloadImportViolations
  };

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(REPORT_MD, markdownReport(report), "utf8");

  console.log(`Runtime dependencies: ${runtimeDependencies.join(", ") || "none"}`);
  console.log(
    `External main/preload requires: ${externalMainOrPreloadRequires.join(", ") || "none"}`
  );
  console.log(
    `Built output: main ${formatBytes(report.mainAssetBytes)}, preload ${formatBytes(
      report.preloadAssetBytes
    )}, renderer ${formatBytes(report.rendererAssetBytes)}`
  );
  console.log(`Wrote ${relative(process.cwd(), REPORT_JSON)} and ${relative(process.cwd(), REPORT_MD)}`);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(issue);
    }

    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
