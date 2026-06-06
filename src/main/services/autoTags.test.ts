import { describe, expect, it } from "vitest";
import type { AutoTagRule } from "@shared/ipc/contracts";
import {
  applyAutoTagRules,
  previewAutoTagRules,
  validateAutoTagRule
} from "./autoTags";

const now = "2026-06-06T00:00:00.000Z";

function rule(patch: Partial<AutoTagRule> = {}): AutoTagRule {
  return {
    id: "rule-1",
    name: "Coding",
    enabled: true,
    targetKinds: ["task", "event", "note"],
    matchField: "title",
    matchType: "prefix",
    pattern: "CODING",
    tags: ["coding"],
    stripMatchedPrefix: false,
    eventColorId: null,
    overrideExistingEventColor: false,
    createdAt: now,
    updatedAt: now,
    ...patch
  };
}

describe("auto tags", () => {
  it("adds tags, strips prefixes, and preserves explicit tag casing", () => {
    expect(applyAutoTagRules([rule({ stripMatchedPrefix: true })], {
      kind: "task",
      title: "CODING: Ship auto tags",
      body: "",
      explicitTags: ["Launch"],
      existingTags: ["launch"]
    })).toEqual({
      title: "Ship auto tags",
      body: "",
      tags: ["launch", "coding"],
      eventColorId: undefined
    });
  });

  it("maps event color only when no explicit or existing color is present unless overridden", () => {
    const colorRule = rule({ eventColorId: "5" });

    expect(applyAutoTagRules([colorRule], {
      kind: "event",
      title: "CODING: Review",
      body: "",
      requestedEventColorId: null,
      existingEventColorId: null
    }).eventColorId).toBe("5");

    expect(applyAutoTagRules([colorRule], {
      kind: "event",
      title: "CODING: Review",
      body: "",
      requestedEventColorId: "3",
      existingEventColorId: null
    }).eventColorId).toBe("3");

    expect(applyAutoTagRules([rule({ eventColorId: "5", overrideExistingEventColor: true })], {
      kind: "event",
      title: "CODING: Review",
      body: "",
      requestedEventColorId: "3",
      existingEventColorId: "2"
    }).eventColorId).toBe("5");
  });

  it("allows event color-only rules for events", () => {
    expect(applyAutoTagRules([rule({ tags: [], eventColorId: "5" })], {
      kind: "event",
      title: "CODING: Review",
      body: "",
      requestedEventColorId: null,
      existingEventColorId: null
    })).toEqual({
      title: "CODING: Review",
      body: "",
      tags: [],
      eventColorId: "5"
    });
  });

  it("validates invalid regex rules without matching them", () => {
    const invalid = rule({ matchType: "regex", pattern: "[" });

    expect(validateAutoTagRule(invalid)).toEqual([
      expect.objectContaining({
        field: "pattern",
        message: expect.stringContaining("Invalid regex"),
        severity: "error"
      })
    ]);

    expect(previewAutoTagRules([invalid], {
      kind: "task",
      title: "CODING: Review",
      body: ""
    })).toEqual(expect.objectContaining({
      invalidRuleIds: ["rule-1"],
      matchedRuleCount: 0,
      tags: [],
      traces: [
        expect.objectContaining({
          status: "invalid"
        })
      ]
    }));
  });

  it("previews rule order, prefix stripping, tags, and conflicts", () => {
    const preview = previewAutoTagRules([
      rule({ id: "rule-coding", name: "Coding", stripMatchedPrefix: true }),
      rule({
        id: "rule-github",
        name: "Github",
        matchType: "contains",
        pattern: "github",
        tags: ["github"]
      })
    ], {
      kind: "task",
      title: "CODING: Research github alternatives",
      body: ""
    });

    expect(preview).toEqual(expect.objectContaining({
      title: "Research github alternatives",
      tags: ["coding", "github"],
      matchedRuleCount: 2,
      hasConflicts: true
    }));
    expect(preview.traces).toEqual([
      expect.objectContaining({
        ruleId: "rule-coding",
        order: 1,
        status: "matched",
        strippedField: "title",
        tagsAdded: ["coding"]
      }),
      expect.objectContaining({
        ruleId: "rule-github",
        order: 2,
        status: "matched",
        tagsAdded: ["github"]
      })
    ]);
  });

  it("skips birthdays", () => {
    expect(applyAutoTagRules([rule({ eventColorId: "5" })], {
      kind: "event",
      title: "CODING: Birthday",
      body: "",
      hcbKind: "birthday",
      explicitTags: ["manual"],
      requestedEventColorId: null
    })).toEqual({
      title: "CODING: Birthday",
      body: "",
      tags: ["manual"],
      eventColorId: null
    });
  });
});
