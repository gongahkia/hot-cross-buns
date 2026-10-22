import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.setTimeout(120_000);
const modifier = process.platform === "darwin" ? "Meta" : "Control";

test("retains complex clipboard content, cross-mode history and composition input", async () => {
  const profile = mkdtempSync(join(tmpdir(), "hcb-markdown-interop-"));
  const app = await electron.launch({ args: [resolve(__dirname, "../.."), `--user-data-dir=${profile}`], env: { ...process.env, NODE_ENV: "test", HCB_TEST_DATABASE_ROOT: profile } });
  try {
    const page = await app.firstWindow();
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Hot Cross Buns", exact: true })).toBeVisible();
    const noteId = await page.evaluate(async () => {
      await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual" });
      const note = await window.hcb!.notes.create({ title: "Interoperability fixture", body: "Original" });
      if (!note.ok) throw new Error(note.error.message);
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      return note.data.id;
    });
    await expect(page.getByRole("dialog", { name: "Hot Cross Buns", exact: true })).toBeHidden();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Notes/ }).click();
    await page.getByRole("button", { name: "Open note Interoperability fixture", exact: true }).click();
    const body = page.getByRole("textbox", { name: "Note body", exact: true });
    await body.fill("Before source");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByRole("textbox", { name: "Note body", exact: true }).fill("## After source");
    await page.getByRole("button", { name: "Visual", exact: true }).click();
    await expect(body.locator("h2")).toHaveText("After source");
    await body.focus(); await body.press(`${modifier}+z`);
    await expect(body).toHaveText("Before source");
    await body.press(`${modifier}+Shift+z`); await expect(body.locator("h2")).toHaveText("After source");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByRole("button", { name: "Visual", exact: true }).click();
    await body.focus(); await body.press(`${modifier}+z`); await expect(body).toHaveText("Before source");

    await body.fill("");
    await page.getByRole("button", { name: "Insert block", exact: true }).click();
    await expect(page.getByRole("listbox", { name: "Insert block", exact: true })).toBeVisible();
    await expect(body).toBeFocused();
    const divider = page.getByRole("option", { name: "Divider", exact: true });
    // Opening under the pointer can select a hovered option. Traverse from
    // the actual selection and verify keyboard wrapping reveals the last row.
    for (let step = 0; step < 15 && await divider.getAttribute("aria-selected") !== "true"; step += 1) await body.press("ArrowUp");
    await expect(divider).toHaveAttribute("aria-selected", "true");
    await expect(body).toHaveAttribute("aria-activedescendant", await divider.getAttribute("id") as string);
    const fits = await divider.evaluate((element) => {
      const list = element.closest('[role="listbox"]')!.getBoundingClientRect();
      const rect = element.getBoundingClientRect(); return rect.top >= list.top && rect.bottom <= list.bottom;
    });
    expect(fits).toBe(true);
    await body.press("Escape");
    await expect(body).not.toHaveAttribute("aria-activedescendant");
    await body.fill(""); await body.pressSequentially("/quote");
    await body.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true, bubbles: true, cancelable: true })));
    await expect(body.locator("blockquote")).toHaveCount(0);
    await expect(page.getByRole("listbox", { name: "Insert block" })).toBeVisible();
    await body.press("Escape"); await body.fill(""); await body.focus();
    const cdp = await app.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "日本", selectionStart: 2, selectionEnd: 2 });
    await expect(body).toContainText("日本");
    await cdp.send("Input.insertText", { text: "日本語" });
    await expect(body).toHaveText("日本語");
    await cdp.detach();

    await body.fill("");
    await body.evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text/html", '<meta charset="utf-8"><div class="ak-renderer-document"><table data-layout="default"><tbody><tr><th colspan="2"><p>Merged <strong>heading</strong></p></th></tr><tr><td rowspan="2"><p>First paragraph</p><p>Second paragraph</p><ul><li><p>Nested item</p></li></ul></td><td><p>Right</p></td></tr><tr><td><p>Last</p></td></tr></tbody></table></div>');
      data.setData("text/plain", "Merged heading\nFirst paragraph\nSecond paragraph\nNested item\nRight\nLast");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(body.locator('th[colspan="2"]')).toHaveText("Merged heading");
    await expect(body.locator('td[rowspan="2"] li')).toHaveText("Nested item");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    const source = await page.getByRole("textbox", { name: "Note body", exact: true }).inputValue();
    expect(source).toContain('colspan="2"'); expect(source).toContain('rowspan="2"');
    await page.getByRole("button", { name: "Visual", exact: true }).click();
    await expect(body.locator('td[rowspan="2"] li')).toHaveText("Nested item");
    await page.getByRole("textbox", { name: "Note title" }).focus();
    await expect.poll(async () => { const result = await page.evaluate((id) => window.hcb!.notes.get({ id }), noteId); return result.ok ? result.data.body : ""; }).toBe(source);
    await page.screenshot({ path: "output/markdown-interoperability-editor.png" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open note Interoperability fixture", exact: true }).click();
    await expect(page.getByRole("columnheader", { name: "Merged heading", exact: true })).toHaveAttribute("colspan", "2");
    await expect(page.getByRole("cell", { name: "First paragraph Second paragraph Nested item", exact: true })).toHaveAttribute("rowspan", "2");
    await page.screenshot({ path: "output/markdown-interoperability-preview.png" });
    expect(errors).toEqual([]);
  } finally { await app.close(); rmSync(profile, { recursive: true, force: true }); }
});
