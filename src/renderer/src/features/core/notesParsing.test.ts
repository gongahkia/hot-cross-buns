import { describe, expect, it } from "vitest";
import { buildNotePreview } from "./notesParsing";

describe("buildNotePreview", () => {
  it("uses readable text for mixed Markdown and HTML snippets", () => {
    expect(buildNotePreview("## Plan\n[Dashboard](https://example.test) and *focus* <b>today</b>"))
      .toBe("Plan Dashboard and focus today");
  });
});
