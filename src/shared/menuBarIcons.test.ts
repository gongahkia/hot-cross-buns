import { describe, expect, it } from "vitest";

import {
  calendarCheckMenuBarIconBody,
  calendarMenuBarIconBody,
  menuBarIconDataUrl,
  menuBarIconSvg,
  sanitizeMenuBarIconSvg
} from "./menuBarIcons";

describe("menu bar icon SVG sanitizer", () => {
  it("accepts Lucide SVG and returns safe body markup", () => {
    expect(
      sanitizeMenuBarIconSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/></svg>'
      )
    ).toBe('<path d="M8 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/>');
  });

  it("rejects scripts and event handlers", () => {
    expect(sanitizeMenuBarIconSvg('<svg><script>alert(1)</script></svg>')).toBeNull();
    expect(sanitizeMenuBarIconSvg('<svg><path onclick="alert(1)" d="M0 0"/></svg>')).toBeNull();
    expect(sanitizeMenuBarIconSvg('<svg><path style="fill:red" d="M0 0"/></svg>')).toBeNull();
  });

  it("rejects external references", () => {
    expect(sanitizeMenuBarIconSvg('<svg><use href="https://example.com/icon.svg#x"/></svg>')).toBeNull();
  });

  it("wraps icon bodies with the tray SVG shell", () => {
    expect(menuBarIconSvg(calendarMenuBarIconBody)).toContain('viewBox="0 0 24 24"');
    expect(menuBarIconSvg(calendarCheckMenuBarIconBody)).toContain('<path d="m9 16 2 2 4-4"/>');
    expect(decodeURIComponent(menuBarIconDataUrl(calendarMenuBarIconBody))).toContain(calendarMenuBarIconBody);
  });
});
