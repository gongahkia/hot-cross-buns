import { builtinModules } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const rendererRoot = join(process.cwd(), "src", "renderer", "src");
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`)
]);
const forbiddenAliases = ["@main/", "@preload/"];
const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(entryPath);
    }

    if (
      !entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".tsx") &&
      !entry.name.endsWith(".d.ts")
    ) {
      return [];
    }

    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      return [];
    }

    return [entryPath];
  });
}

describe("renderer privilege boundary", () => {
  it("does not import Electron, Node builtins, main, or preload modules", () => {
    const violations = sourceFiles(rendererRoot).flatMap((filePath) => {
      const contents = readFileSync(filePath, "utf8");
      const imports = [...contents.matchAll(importPattern)].map((match) => match[1]);

      return imports
        .filter(
          (specifier) =>
            specifier === "electron" ||
            nodeBuiltins.has(specifier) ||
            forbiddenAliases.some((alias) => specifier.startsWith(alias))
        )
        .map((specifier) => `${relative(process.cwd(), filePath)} imports ${specifier}`);
    });

    expect(violations).toEqual([]);
  });
});
