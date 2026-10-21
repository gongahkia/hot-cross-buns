"use client";

import * as React from "react";
import { ArrowLeft, CircleHelp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

const SHORTCUTS = [
  { label: "Command menu", keys: ["⌘", "K"] },
  { label: "Search events", keys: ["⌘", "F"] },
  { label: "Settings", keys: ["⌘", ","] },
  { label: "All keyboard shortcuts", keys: ["?"] },
  { label: "Toggle calendar sidebar", keys: ["⌘", "/"] },
  { label: "Toggle context panel", keys: ["/"] },
  { label: "Go to today", keys: ["T"] },
  { label: "Previous period", keys: ["J", "or", "←"] },
  { label: "Next period", keys: ["K", "or", "→"] },
  { label: "Day view", keys: ["1", "or", "D"] },
  { label: "Week view", keys: ["0", "or", "W"] },
  { label: "Month view", keys: ["M"] },
  { label: "Number of displayed days", keys: ["2–9"] },
  { label: "Toggle weekends", keys: ["shift", "⌘", "E"] },
  { label: "Toggle declined events", keys: ["shift", "⌘", "D"] },
  { label: "Cycle theme", keys: ["shift", "M"] },
  { label: "Deselect event", keys: ["esc"] },
];

const UNAVAILABLE_SHORTCUTS = [
  { label: "Menu bar calendar", keys: ["control", "⌘", "K"] },
  { label: "Show teammate calendar", keys: ["P"] },
  { label: "Go to date", keys: ["."] },
];

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const heading = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="bg-sidebar w-full shrink-0 border-b px-4 py-4 md:w-60 md:border-r md:border-b-0">
        <Button
          variant="ghost"
          className="mb-5 h-11 justify-start px-2 transition-colors md:h-10"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
          Back to calendar
        </Button>
        <p className="px-2 text-lg font-semibold tracking-tight">Settings</p>
        <nav aria-label="Settings" className="mt-4">
          <div
            aria-current="page"
            className="bg-sidebar-accent text-sidebar-accent-foreground flex min-h-10 items-center gap-2 rounded-sm px-3 text-sm font-medium"
          >
            <CircleHelp className="size-4" />
            About &amp; Help
          </div>
        </nav>
      </aside>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-12">
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight text-balance outline-none"
          >
            About &amp; Help
          </h1>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            Keyboard shortcuts and help.
          </p>

          <section aria-labelledby="keyboard-shortcuts" className="mt-10">
            <h2 id="keyboard-shortcuts" className="text-sm font-semibold">
              Keyboard shortcuts
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Use these shortcuts while viewing the calendar.
            </p>
            <dl className="mt-3 divide-y border-y">
              {SHORTCUTS.map((shortcut) => (
                <ShortcutRow key={shortcut.label} {...shortcut} />
              ))}
            </dl>
          </section>

          <section aria-labelledby="unavailable-shortcuts" className="mt-8">
            <h2 id="unavailable-shortcuts" className="text-sm font-semibold">
              Not available yet
            </h2>
            <p className="text-muted-foreground mt-2 text-sm text-pretty">
              These reference shortcuts do not have an action in this version.
            </p>
            <dl className="mt-3 divide-y border-y text-muted-foreground">
              {UNAVAILABLE_SHORTCUTS.map((shortcut) => (
                <ShortcutRow key={shortcut.label} {...shortcut} />
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2 text-sm">
      <dt>{label}</dt>
      <dd className="flex shrink-0 items-center gap-1">
        {keys.map((key) =>
          key === "or" ? (
            <span key={key} className="text-muted-foreground px-1 text-xs">
              or
            </span>
          ) : (
            <Kbd key={key}>{key}</Kbd>
          ),
        )}
      </dd>
    </div>
  );
}
