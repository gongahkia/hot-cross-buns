import { describe, expect, it } from "vitest";
import type { NativeMenuBarSnapshot } from "../types";
import { menuBarPanelDataUrl, menuBarPanelHtml } from "./menuBarPanelHtml";

describe("menu bar panel HTML", () => {
  it("escapes snapshot text before rendering the panel", () => {
    const snapshot: NativeMenuBarSnapshot = {
      panelStyle: "adaptive",
      primaryClickAction: "open-menu",
      title: "<script>&\"'",
      syncLabel: "Sync <ok>",
      tooltip: "Tooltip",
      sections: [
        {
          title: "Danger & Co",
          items: [
            {
              label: "Buy <milk>",
              detail: "Use \"oat\" & tea",
              action: "quickCapture"
            }
          ]
        }
      ]
    };

    const html = menuBarPanelHtml(snapshot);

    expect(html).toContain("&lt;script&gt;&amp;&quot;&#39;");
    expect(html).toContain("Sync &lt;ok&gt;");
    expect(html).toContain("Danger &amp; Co");
    expect(html).toContain("Buy &lt;milk&gt;");
    expect(html).toContain("Use &quot;oat&quot; &amp; tea");
    expect(html).not.toContain("Buy <milk>");
    expect(menuBarPanelDataUrl(snapshot)).toMatch(/^data:text\/html;charset=utf-8,/);
  });
});
