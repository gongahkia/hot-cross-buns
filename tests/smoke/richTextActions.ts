import { expect, type Locator } from "@playwright/test";

/** Use the editor's keymap so its selection stays in sync with the DOM. */
export async function replaceRichText(editor: Locator, value = "") {
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.click();
  await expect(editor).toBeFocused();
  // fill() selects a DOM range directly. A pending editor focus transaction
  // can restore the previous selection and make that operation append instead.
  await editor.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
  await editor.press("Backspace");
  await expect(editor).toHaveText("");
  if (value) {
    await editor.pressSequentially(value);
    await expect(editor).toHaveText(value);
  }
}
