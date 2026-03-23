import { w as writable } from "./index.js";
const STORAGE_KEY = "tickclone-theme";
function getStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
  }
  return "system";
}
function getSystemPreference() {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}
const theme = writable(getStoredTheme());
writable(
  getStoredTheme() === "system" ? getSystemPreference() : getStoredTheme()
);
export {
  theme as t
};
