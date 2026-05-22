import { describe, expect, it } from "vitest";
import {
  generatePerfFixtureSet,
  PERF_FIXTURE_COUNTS,
  summarizePerfFixtureSet,
  type PerfFixtureSize
} from "./fixtures";

const sizes: PerfFixtureSize[] = ["small", "medium", "large"];

describe("performance fixtures", () => {
  it("generates the documented dataset sizes", () => {
    for (const size of sizes) {
      const fixture = generatePerfFixtureSet(size);
      const counts = PERF_FIXTURE_COUNTS[size];

      expect(fixture.generatedDataOnly).toBe(true);
      expect(fixture.tasks).toHaveLength(counts.tasks);
      expect(fixture.eventInstances).toHaveLength(counts.eventInstances);
      expect(fixture.notes).toHaveLength(counts.notes);
    }
  });

  it("is deterministic for repeated runs", () => {
    for (const size of sizes) {
      expect(generatePerfFixtureSet(size)).toEqual(generatePerfFixtureSet(size));
      expect(summarizePerfFixtureSet(size)).toEqual(summarizePerfFixtureSet(size));
    }
  });

  it("uses generated local data only", () => {
    const serialized = JSON.stringify(generatePerfFixtureSet("small"));

    expect(serialized).toContain("Generated task");
    expect(serialized).not.toMatch(/oauth|access_token|refresh_token|gmail|googleapis/i);
  });
});
