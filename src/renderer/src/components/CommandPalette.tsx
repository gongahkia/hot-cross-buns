import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Command, Search, X } from "lucide-react";
import { mockCommands, type MockCommand, type SectionId } from "../data/mockPlanner";
import { Badge, Button, IconButton, Input, cx } from "./primitives";

interface CommandPaletteProps {
  onNavigate: (sectionId: SectionId) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

function commandMatches(command: MockCommand, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [command.label, command.description, command.category, ...command.keywords]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

export function CommandPalette({
  onNavigate,
  onOpenChange,
  open
}: CommandPaletteProps): JSX.Element | null {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCommands = useMemo(
    () => mockCommands.filter((command) => commandMatches(command, query)),
    [query]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery("");
    setHighlightedIndex(0);
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  if (!open) {
    return null;
  }

  function closePalette(): void {
    onOpenChange(false);
  }

  function runCommand(command: MockCommand | undefined): void {
    if (!command) {
      return;
    }

    if (command.sectionId) {
      onNavigate(command.sectionId);
    }

    closePalette();
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.min(current + 1, filteredCommands.length - 1));
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
    }

    if (event.key === "Enter") {
      event.preventDefault();
      runCommand(filteredCommands[highlightedIndex]);
    }
  }

  const activeOptionId = filteredCommands[highlightedIndex]
    ? `command-option-${filteredCommands[highlightedIndex].id}`
    : undefined;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-start justify-center bg-bg-tertiary px-4 pt-[12vh]"
      onKeyDown={handleDialogKeyDown}
      role="presentation"
    >
      <div
        aria-labelledby="command-palette-title"
        aria-modal="true"
        className="w-full max-w-[620px] overflow-hidden rounded-hcbLg border border-border bg-bg-secondary shadow-2xl"
        role="dialog"
      >
        <div className="flex h-11 items-center gap-3 border-b border-border px-3">
          <Command aria-hidden="true" className="text-accent" size={17} />
          <h2 className="min-w-0 flex-1 truncate text-[var(--text-md)] font-semibold" id="command-palette-title">
            Command palette
          </h2>
          <IconButton icon={X} label="Close command palette" onClick={closePalette} variant="ghost" />
        </div>

        <div className="border-b border-border p-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
              size={15}
            />
            <Input
              aria-activedescendant={activeOptionId}
              aria-controls="command-palette-options"
              aria-label="Filter commands"
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Run a command or jump to a section"
              ref={inputRef}
              role="searchbox"
              value={query}
            />
          </div>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-2" id="command-palette-options" role="listbox">
          {filteredCommands.length > 0 ? (
            filteredCommands.map((command, index) => (
              <button
                aria-selected={index === highlightedIndex}
                className={cx(
                  "flex min-h-12 w-full items-center gap-3 rounded-hcbMd px-3 py-2 text-left transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  index === highlightedIndex
                    ? "bg-surface-0 text-text-primary"
                    : "text-text-secondary hover:bg-surface-0 hover:text-text-primary"
                )}
                id={`command-option-${command.id}`}
                key={command.id}
                onClick={() => runCommand(command)}
                onMouseEnter={() => setHighlightedIndex(index)}
                role="option"
                type="button"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[var(--text-md)] font-medium">{command.label}</div>
                  <div className="truncate text-[var(--text-xs)] text-text-muted">
                    {command.description}
                  </div>
                </div>
                <Badge tone={command.sectionId ? "accent" : "neutral"}>{command.category}</Badge>
              </button>
            ))
          ) : (
            <div className="grid min-h-28 place-items-center text-center">
              <div>
                <p className="text-[var(--text-md)] font-semibold text-text-primary">No commands found</p>
                <p className="mt-1 text-[var(--text-sm)] text-text-muted">Try a section name or action.</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex h-9 items-center justify-between border-t border-border px-3 text-[var(--text-xs)] text-text-muted">
          <span>Enter runs selected command</span>
          <span>Esc closes</span>
        </div>
      </div>
    </div>
  );
}
