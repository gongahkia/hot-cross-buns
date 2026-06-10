import { spawnSync } from "node:child_process";

interface SmokeStep {
  name: string;
  command?: string[];
  envGate?: string;
  skippedReason?: string;
}

const steps: SmokeStep[] = [
  {
    name: "first-class tags generated perf",
    command: ["pnpm", "test:perf"]
  },
  {
    name: "auto-tag real-profile-copy smoke",
    envGate: "HCB_REAL_PROFILE_COPY",
    command: ["pnpm", "vitest", "run", "--config", "vitest.config.ts", "src/main/services/sqliteDomainServices.test.ts", "-t", "reapplies auto tags"]
  },
  {
    name: "recurrence future-series and missing-master local smoke",
    command: ["pnpm", "vitest", "run", "--config", "vitest.config.ts", "src/main/services/sqliteDomainServices.test.ts", "-t", "future-scoped recurrence"]
  },
  {
    name: "recurrence live Google smoke",
    envGate: "HCB_LIVE_GOOGLE_SMOKE",
    skippedReason: "set HCB_LIVE_GOOGLE_SMOKE=1 after connecting a disposable Google calendar profile"
  },
  {
    name: "search DSL and semantic smoke",
    command: ["pnpm", "vitest", "run", "--config", "vitest.config.ts", "src/shared/search/localSearch.test.ts", "src/main/services/sqliteDomainServices.test.ts", "-t", "semantic|boolean|relative date"]
  },
  {
    name: "MCP/CLI action proposal smoke",
    command: ["pnpm", "hcb:smoke"]
  },
  {
    name: "duplicate cleanup generated smoke",
    command: ["pnpm", "vitest", "run", "--config", "vitest.config.ts", "src/main/services/sqliteDomainServices.test.ts", "-t", "duplicate cleanup|duplicate tasks|duplicate cleanup mutations"]
  },
  {
    name: "duplicate cleanup real-profile-copy smoke",
    envGate: "HCB_REAL_PROFILE_COPY",
    command: ["pnpm", "vitest", "run", "--config", "vitest.config.ts", "src/main/services/sqliteDomainServices.test.ts", "-t", "duplicate cleanup"]
  }
];

let failed = 0;

for (const step of steps) {
  if (step.envGate && !process.env[step.envGate]) {
    console.log(`SKIP ${step.name}: ${step.skippedReason ?? `set ${step.envGate}`}`);
    continue;
  }

  if (!step.command) {
    console.log(`SKIP ${step.name}: ${step.skippedReason ?? "no command configured"}`);
    continue;
  }

  console.log(`RUN ${step.name}`);
  const result = spawnSync(step.command[0], step.command.slice(1), {
    env: process.env,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    failed += 1;
    console.error(`FAIL ${step.name}`);
  } else {
    console.log(`PASS ${step.name}`);
  }
}

if (failed > 0) {
  process.exitCode = 1;
}
