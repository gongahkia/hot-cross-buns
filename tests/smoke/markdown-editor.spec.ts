import { chooseCalendarView, newCalendarEvent } from "./calendarActions";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.setTimeout(120_000);
const modifier = process.platform === "darwin" ? "Meta" : "Control";

async function sourceValue(page: Page, name: string) {
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const value = await page.getByRole("textbox", { name, exact: true }).inputValue();
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  return value;
}

test("edits and persists rich Markdown consistently in notes, task notes and event descriptions", async () => {
  const profile = mkdtempSync(join(tmpdir(), "hcb-rich-markdown-"));
  const app = await electron.launch({ args: [resolve(__dirname, "../.."), `--user-data-dir=${profile}`], env: { ...process.env, NODE_ENV: "test", HCB_TEST_DATABASE_ROOT: profile } });
  const errors: string[] = [];
  try {
    const page = await app.firstWindow(); page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByTestId("app-shell")).toBeVisible();
    const fixture = await page.evaluate(async () => {
      await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual" });
      const note = await window.hcb!.notes.create({ title: "Rich editing fixture", body: "Original **formatted** text." });
      const task = await window.hcb!.tasks.create({ listId: "inbox", title: "Reference fixture", notes: "Initial task notes" });
      const event = await window.hcb!.calendar.create({ calendarId: "primary", title: "Editor event", description: "<p>Imported <strong>HTML</strong> description</p>", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString() });
      if (!note.ok || !task.ok || !event.ok) throw new Error("Fixture failed");
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      return { note: note.data.id, task: task.data.id, event: event.data.id };
    });
    await expect(page.getByRole("dialog", { name: "Hot Cross Buns", exact: true })).toBeHidden();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Notes/ }).click();
    await page.getByRole("button", { name: "Open note Rich editing fixture", exact: true }).click();
    let body = page.getByRole("textbox", { name: "Note body", exact: true });
    await expect(body.locator("strong")).toHaveText("formatted");
    const formatToolbar = page.getByRole("toolbar", { name: "Note body formatting" });
    await formatToolbar.getByRole("button", { name: "Bold", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(formatToolbar.getByRole("button", { name: "Italic", exact: true })).toBeFocused();
    await body.fill(""); await body.pressSequentially("# "); await body.pressSequentially("Markdown heading");
    await expect(body.locator("h1")).toHaveText("Markdown heading");
    await body.press("Enter"); await body.press(`${modifier}+b`); await body.pressSequentially("Bold text"); await body.press(`${modifier}+b`);
    await expect(body.locator("strong")).toHaveText("Bold text");
    await body.press("Enter"); await body.pressSequentially("/table");
    await expect(page.getByRole("option", { name: "Table", exact: true })).toBeVisible();
    await body.press("ArrowDown"); await body.press("ArrowUp"); await body.press("Enter");
    await expect(body.locator("table")).toHaveCount(1);
    await body.locator("th").first().click(); await page.keyboard.type("Header");
    await page.getByRole("button", { name: "Add row", exact: true }).click();
    await expect(body.locator("tr")).toHaveCount(4);
    const tableSource = await sourceValue(page, "Note body");
    expect(tableSource).toContain("# Markdown heading"); expect(tableSource).toContain("**Bold text**"); expect(tableSource).toContain("Header");
    await page.screenshot({ path: "output/markdown-editor-formatted-note.png" });

    await body.fill(""); await body.pressSequentially("@Reference");
    await expect(page.getByRole("option", { name: /Reference fixture/ }).first()).toBeVisible();
    await body.press("ArrowDown"); await body.press("Enter");
    await expect(body.locator("[data-planner-reference]")).toHaveCount(1);
    expect(await sourceValue(page, "Note body")).toContain(`[[hcb:task:${fixture.task}|Reference fixture]]`);
    await body.fill(""); await body.pressSequentially(":smile");
    await expect(page.getByRole("listbox", { name: "Emoji suggestions" })).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Emoji suggestions" }).getByRole("option").first()).toBeVisible();
    await body.press("Enter");
    expect((await body.innerText()).trim()).not.toContain(":smile");
    await body.fill(""); await body.pressSequentially("/quote"); await body.press("Escape");
    await expect(body).toBeVisible(); // Escape dismisses suggestions before closing the inspector.
    await body.fill("Prefix "); await body.pressSequentially("/divider"); await body.press("Enter");
    await expect(body.locator("hr")).toHaveCount(1);
    await body.fill(""); await body.pressSequentially("/no-matching-command"); await body.press("Enter");
    await expect(body).toContainText("/no-matching-command");
    await body.fill("");
    await body.evaluate((element) => {
      const data = new DataTransfer(); data.setData("text/plain", "## Pasted heading\n\n**Pasted bold**");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(body.locator("h2")).toHaveText("Pasted heading");
    await expect(body.locator("strong")).toHaveText("Pasted bold");
    await body.fill("");
    await body.evaluate((element) => {
      const data = new DataTransfer(); data.setData("text/html", '<p>Pasted <em>HTML</em> <a href="javascript:alert(1)">unsafe link</a></p>');
      data.setData("text/plain", "Pasted HTML unsafe link");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(body.locator("em")).toHaveText("HTML");
    await expect(body.locator('a[href^="javascript:"]')).toHaveCount(0);
    await body.press(`${modifier}+a`);
    await expect(page.getByRole("toolbar", { name: "Selected text formatting" })).toBeVisible();
    await page.getByRole("toolbar", { name: "Selected text formatting" }).getByRole("button", { name: "Strikethrough", exact: true }).click();
    await expect(body.locator("s").first()).toContainText("Pasted");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByRole("textbox", { name: "Note body" }).fill("- Parent\n- Child");
    await page.getByRole("button", { name: "Visual", exact: true }).click();
    await body.locator("li").nth(1).click(); await page.keyboard.press("Tab");
    await expect(body.locator("ul ul")).toHaveCount(1);
    await page.keyboard.press("Shift+Tab"); await expect(body.locator("ul ul")).toHaveCount(0);

    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByRole("textbox", { name: "Note body" }).fill("Large document content. ".repeat(3000));
    await page.getByRole("button", { name: "Visual", exact: true }).click();
    await body.click(); await body.press(`${modifier}+End`);
    const typingStarted = performance.now();
    await body.pressSequentially(" Fifty typed characters stay responsive and local.");
    console.log(`Rich editor: 69 KB document, 49 keystrokes in ${Math.round(performance.now() - typingStarted)} ms (busy-host observation).`);

    // Source-to-visual conversion must preserve HCB-specific syntax and Mermaid.
    await page.getByRole("button", { name: "Source", exact: true }).click();
    const special = `[[hcb:task:${fixture.task}|Reference fixture]]\n\n![[hcb:note:${fixture.note}|Self]]\n\n\`\`\`mermaid\ngraph TD; A-->B\n\`\`\``;
    await page.getByRole("textbox", { name: "Note body" }).fill(special);
    await page.getByRole("button", { name: "Visual", exact: true }).click();
    body = page.getByRole("textbox", { name: "Note body" });
    await expect(body.locator("[data-planner-reference]")).toHaveCount(2);
    await body.click(); await body.press(`${modifier}+End`); await body.press("ArrowDown");
    expect(await sourceValue(page, "Note body")).toBe(special);
    await page.getByRole("textbox", { name: "Note title" }).focus();
    await expect.poll(async () => { const result = await page.evaluate((id) => window.hcb!.notes.get({ id }), fixture.note); return result.ok ? result.data.body : ""; }).toBe(special);
    await page.keyboard.press("Escape");

    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Tasks/ }).click();
    await page.getByRole("button", { name: "Reference fixture", exact: true }).click();
    const notes = page.getByRole("textbox", { name: "Task notes" });
    await notes.fill("Undo probe");
    await notes.press(`${modifier}+z`);
    await expect(notes).not.toContainText("Undo probe");
    await notes.press(`${modifier}+Shift+z`);
    await expect(notes).toContainText("Undo probe");
    await notes.fill(""); await notes.pressSequentially("[] "); await notes.pressSequentially("Action item");
    await expect(notes.getByRole("checkbox")).toHaveCount(1);
    await notes.getByRole("checkbox").check();
    expect(await sourceValue(page, "Task notes")).toContain("- [x] Action item");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await expect.poll(async () => { const result = await page.evaluate((id) => window.hcb!.tasks.get({ id }), fixture.task); return result.ok ? result.data.notes : ""; }).toContain("- [x] Action item");
    await page.keyboard.press("Escape");

    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Calendar/ }).click();
    await expect(page.getByRole("button", { name: "Calendar tools", exact: true })).toBeVisible();
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent("hcb:open-entity", { detail: { kind: "event", id } })), fixture.event);
    const description = page.getByRole("textbox", { name: "Event notes" });
    await expect(description.locator("strong")).toHaveText("HTML");
    await description.fill(""); await description.press(`${modifier}+k`);
    await page.getByRole("textbox", { name: "Link URL" }).fill("https://example.com/inserted");
    await page.getByRole("button", { name: "Apply link", exact: true }).click();
    await expect(description.locator("a")).toHaveText("https://example.com/inserted");
    await description.fill("Linked description"); await description.press(`${modifier}+a`); await description.press(`${modifier}+k`);
    await page.getByRole("textbox", { name: "Link URL" }).fill("https://example.com");
    await page.getByRole("textbox", { name: "Link URL" }).press("Enter");
    await expect(description.locator("a")).toHaveAttribute("href", "https://example.com");
    await expect(page.getByRole("textbox", { name: "Event title" })).toBeVisible(); // Enter in link editor must not submit the event.
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await expect.poll(async () => { const result = await page.evaluate((id) => window.hcb!.calendar.get({ id }), fixture.event); return result.ok ? result.data.description : ""; }).toContain("[Linked description](https://example.com)");
    await page.keyboard.press("Escape");
    await newCalendarEvent(page);
    await page.getByRole("button", { name: "Item type", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Task", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Task notes" })).toHaveAttribute("contenteditable", "true");
    expect(errors).toEqual([]);
    await page.screenshot({ path: "output/markdown-editor-calendar-task.png" });
  } finally { await app.close(); rmSync(profile, { recursive: true, force: true }); }
});
