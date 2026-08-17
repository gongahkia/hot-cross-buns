import type { WorkspaceKeybindings } from "@/types";

const modifierOrder = ["Meta", "Control", "Alt", "Shift"] as const;

export const keybindingLabels: Readonly<Record<keyof WorkspaceKeybindings, string>> = {
  commandPalette: "Search and command palette",
  quickCapture: "Quick capture",
  sync: "Synchronize now",
  tasks: "Open Tasks",
  calendar: "Open Calendar",
  settings: "Open Settings",
  health: "Open Health",
  tutorial: "Open tutorial"
};

function keyName(key: string): string {
  if (key === " ") return "Space";
  if (key === "Escape") return "Esc";
  if (key === "ArrowUp") return "↑";
  if (key === "ArrowDown") return "↓";
  if (key === "ArrowLeft") return "←";
  if (key === "ArrowRight") return "→";
  return key.length === 1 ? key.toUpperCase() : key;
}

export function bindingFromKeyboardEvent(event: KeyboardEvent | React.KeyboardEvent): string | undefined {
  const key = event.key;
  if (["Meta", "Control", "Alt", "Shift", "Dead"].includes(key)) return undefined;
  const parts: string[] = [];
  if (event.metaKey) parts.push("Meta");
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(keyName(key));
  return parts.join("+");
}

export function normalizedBinding(value: string): string {
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  const modifiers = modifierOrder.filter((modifier) => parts.some((part) => part.toLocaleLowerCase() === modifier.toLocaleLowerCase()));
  const key = parts.find((part) => !modifierOrder.some((modifier) => modifier.toLocaleLowerCase() === part.toLocaleLowerCase()));
  return key ? [...modifiers, keyName(key)].join("+") : "";
}

export function matchesBinding(event: KeyboardEvent, value: string): boolean {
  const expected = normalizedBinding(value);
  const actual = bindingFromKeyboardEvent(event);
  return Boolean(expected && actual && expected === actual);
}

export function formatBinding(value: string): string {
  return normalizedBinding(value)
    .replaceAll("Meta", "⌘")
    .replaceAll("Control", "Ctrl")
    .replaceAll("Alt", "⌥")
    .replaceAll("Shift", "⇧")
    .replaceAll("+", " ");
}
