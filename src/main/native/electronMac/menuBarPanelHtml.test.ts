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

  it("renders agenda rows without leading icons", () => {
    const snapshot: NativeMenuBarSnapshot = {
      panelStyle: "adaptive",
      primaryClickAction: "open-menu",
      title: "Agenda",
      syncLabel: "Synced",
      tooltip: "Tooltip",
      sections: [
        {
          title: "Today",
          items: [
            {
              label: "Focus block",
              detail: "9:00 AM-10:00 AM",
              route: { kind: "event", id: "event-1" }
            }
          ]
        }
      ]
    };

    const html = menuBarPanelHtml(snapshot);

    expect(html).toContain("Focus block");
    expect(html).not.toContain("row-icon");
  });

  it("renders the account block without the old avatar offset", () => {
    const snapshot: NativeMenuBarSnapshot = {
      panelStyle: "adaptive",
      primaryClickAction: "open-menu",
      title: "Agenda",
      syncLabel: "Synced",
      tooltip: "Tooltip",
      sections: [],
      account: {
        displayName: "Google account",
        connectionState: "connected"
      }
    };

    const html = menuBarPanelHtml(snapshot);

    expect(html).not.toContain("class=\"avatar\"");
    expect(html).toContain("<span class=\"account-name\">Connected</span>");
  });
});
