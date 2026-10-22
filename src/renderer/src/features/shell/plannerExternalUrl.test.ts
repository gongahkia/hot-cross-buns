import { expect, it } from "vitest";
import { plannerExternalUrl } from "./plannerExternalUrl";

it("routes web and mail links to the external opener without accepting executable URLs", () => {
  const base = "http://localhost:5173/";
  for (const url of ["https://example.com/docs", "http://example.com/", "mailto:hello@example.com"]) {
    expect(plannerExternalUrl(url, base)).toBe(url);
  }
  for (const url of [null, "", "#checklist", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,hello"]) {
    expect(plannerExternalUrl(url, base)).toBeNull();
  }
});
