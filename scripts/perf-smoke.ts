import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const artifactDir = join(process.cwd(), "artifacts", "perf");
mkdirSync(artifactDir, { recursive: true });

const generatedAt = new Date().toISOString();
const report = {
  generatedAt,
  status: "placeholder",
  measurements: [],
  artifactConvention: {
    json: "artifacts/perf/latest.json",
    markdown: "artifacts/perf/latest.md"
  },
  note: "Performance smoke scaffolding is in place. Add deterministic local fixtures before turning budgets into gates."
};

writeFileSync(join(artifactDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(
  join(artifactDir, "latest.md"),
  [
    "# Performance Smoke",
    "",
    `Generated: ${generatedAt}`,
    "",
    "Status: placeholder",
    "",
    "No measurements are collected until deterministic local fixtures exist."
  ].join("\n")
);

console.log("Wrote performance smoke placeholders to artifacts/perf/latest.json and latest.md");
