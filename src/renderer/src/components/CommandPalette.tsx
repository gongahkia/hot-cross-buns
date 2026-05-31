import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Command, Search, X } from "lucide-react";
import {
  plannerActionAvailability,
  plannerActions,
  type PlannerAction,
  type PlannerActionContext
} from "../actions/plannerActions";
import type { SectionId } from "../data/mockPlanner";
import { useLocalSearch } from "../features/core/coreViewModelSource";
import type { SearchResultViewModel, SearchSource } from "../features/core/coreViewModels";
import { Badge, IconButton, Input, cx } from "./primitives";

interface CommandPaletteProps {
  actionContext: PlannerActionContext;
  initialQuery?: string;
  onCommand?: (command: PlannerAction) => boolean | void;
  onNavigate: (sectionId: SectionId) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

function commandMatches(command: PlannerAction, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [command.label, command.description, command.category, ...command.keywords]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function searchResultSection(source: SearchSource): SectionId {
  if (source === "event") {
    return "calendar";
  }

  if (source === "note") {
    return "notes";
  }

  return "tasks";
}

function searchResultTone(source: SearchSource): "accent" | "success" | "info" {
  if (source === "event") {
    return "accent";
  }

  if (source === "note") {
    return "info";
  }

  return "success";
}

function dispatchCalendarCommand(command: PlannerAction): void {
  if (!command.calendarAction) {
    return;
  }

  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent("hcb:calendar-command", {
        detail:
          command.calendarAction === "new-event"
            ? { action: "new-event" }
            : { action: "set-view", viewId: command.calendarAction }
      })
    );
  }, 0);
}

function dispatchNoteCommand(command: PlannerAction): void {
  if (!command.noteAction) {
    return;
  }

  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent("hcb:note-command", {
        detail: { action: command.noteAction }
      })
    );
  }, 0);
}

function dispatchSearchResultOpen(result: SearchResultViewModel): void {
  window.setTimeout(() => {
    if (result.source === "event") {
      window.dispatchEvent(
        new CustomEvent("hcb:calendar-command", {
          detail: { action: "open-event", eventId: result.targetId }
        })
      );
      return;
    }

    if (result.source === "note") {
      window.dispatchEvent(
        new CustomEvent("hcb:note-command", {
          detail: { action: "open-note", noteId: result.targetId }
        })
      );
      return;
    }

    window.dispatchEvent(
      new CustomEvent("hcb:task-command", {
        detail: { action: "open-task", taskId: result.targetId }
      })
    );
  }, 0);
}

export function CommandPalette({
  actionContext,
  initialQuery = "",
  onCommand,
  onNavigate,
  onOpenChange,
  open
}: CommandPaletteProps): JSX.Element | null {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedQuery = query.trim();

  const filteredCommands = useMemo(
    () => plannerActions.filter((command) => commandMatches(command, query)),
    [query]
  );
  const searchEnabled = trimmedQuery.length > 0 && filteredCommands.length === 0;
  const search = useLocalSearch(searchEnabled ? query : "");
  const searchResults = searchEnabled && search.viewModel.state === "results" ? search.viewModel.results : [];
  const activeOptionCount = filteredCommands.length > 0 ? filteredCommands.length : searchResults.length;

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery(initialQuery);
    setHighlightedIndex(0);
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [initialQuery, open]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  useEffect(() => {
    const input = inputRef.current;

    if (!input || document.activeElement !== input || input.selectionStart !== query.length) {
      return;
    }

    input.scrollLeft = input.scrollWidth;
  }, [query]);

  useEffect(() => {
    if (activeOptionCount === 0) {
      setHighlightedIndex(0);
      return;
    }

    setHighlightedIndex((current) => Math.min(current, activeOptionCount - 1));
  }, [activeOptionCount]);

  if (!open) {
    return null;
  }

  function closePalette(): void {
    onOpenChange(false);
  }

  function runCommand(command: PlannerAction | undefined): void {
    if (!command) {
      return;
    }

    const availability = plannerActionAvailability(command, actionContext);

    if (!availability.enabled) {
      return;
    }

    if (onCommand?.(command)) {
      closePalette();
      return;
    }

    if (command.sectionId) {
      onNavigate(command.sectionId);
    }

    dispatchCalendarCommand(command);
    dispatchNoteCommand(command);

    closePalette();
  }

  function runSearchResult(result: SearchResultViewModel | undefined): void {
    if (!result) {
      return;
    }

    onNavigate(searchResultSection(result.source));
    dispatchSearchResultOpen(result);
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
      setHighlightedIndex((current) => Math.min(current + 1, Math.max(0, activeOptionCount - 1)));
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (filteredCommands.length > 0) {
        runCommand(filteredCommands[highlightedIndex]);
        return;
      }

      runSearchResult(searchResults[highlightedIndex]);
    }
  }

  const activeOptionId = filteredCommands.length > 0 && filteredCommands[highlightedIndex]
    ? `command-option-${filteredCommands[highlightedIndex].id}`
    : searchResults[highlightedIndex]
      ? `search-option-${searchResults[highlightedIndex].id}`
      : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-bg-tertiary/45 px-4 pt-[12vh] backdrop-blur-sm"
      onKeyDown={handleDialogKeyDown}
      role="presentation"
    >
      <div
        aria-labelledby="command-palette-title"
        aria-modal="true"
        className="w-full max-w-[960px] overflow-hidden rounded-hcbLg border border-border bg-bg-secondary shadow-2xl"
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
              placeholder="Run a command or search local data"
              ref={inputRef}
              role="searchbox"
              value={query}
            />
          </div>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-2" id="command-palette-options" role="listbox">
          {filteredCommands.length > 0 ? (
            filteredCommands.map((command, index) => {
              const availability = plannerActionAvailability(command, actionContext);

              return (
                <button
                  aria-disabled={!availability.enabled}
                  aria-selected={index === highlightedIndex}
                  className={cx(
                    "flex min-h-12 w-full items-center gap-3 rounded-hcbMd px-3 py-2 text-left transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-55",
                    index === highlightedIndex
                      ? "bg-surface-0 text-text-primary"
                      : "text-text-secondary hover:bg-surface-0 hover:text-text-primary"
                  )}
                  data-action-id={command.id}
                  disabled={!availability.enabled}
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
                      {availability.reason ?? command.description}
                    </div>
                  </div>
                  <Badge tone={availability.enabled && command.sectionId ? "accent" : "neutral"}>
                    {command.category}
                  </Badge>
                </button>
              );
            })
          ) : search.parsed.errors.length > 0 ? (
            <div
              aria-live="polite"
              className="rounded-hcbMd border border-warning bg-bg-tertiary px-3 py-2 text-[var(--text-sm)] text-warning"
              role="alert"
            >
              {search.parsed.errors[0]?.message ?? "Invalid search query."}
            </div>
          ) : search.state === "loading" || search.state === "stale" ? (
            <div className="grid min-h-28 place-items-center text-center">
              <div>
                <p className="text-[var(--text-md)] font-semibold text-text-primary">Searching planner data</p>
                <p className="mt-1 text-[var(--text-sm)] text-text-muted">Tasks, events, notes, birthdays, and calendar text.</p>
              </div>
            </div>
          ) : searchResults.length > 0 ? (
            searchResults.map((result, index) => (
              <button
                aria-selected={index === highlightedIndex}
                className={cx(
                  "flex min-h-12 w-full items-center gap-3 rounded-hcbMd px-3 py-2 text-left transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  index === highlightedIndex
                    ? "bg-surface-0 text-text-primary"
                    : "text-text-secondary hover:bg-surface-0 hover:text-text-primary"
                )}
                id={`search-option-${result.id}`}
                key={result.id}
                onClick={() => runSearchResult(result)}
                onMouseEnter={() => setHighlightedIndex(index)}
                role="option"
                type="button"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[var(--text-md)] font-medium">{result.title}</div>
                  <div className="truncate text-[var(--text-xs)] text-text-muted">{result.detail}</div>
                </div>
                <Badge tone={searchResultTone(result.source)}>{result.source}</Badge>
              </button>
            ))
          ) : trimmedQuery ? (
            <div className="grid min-h-28 place-items-center text-center">
              <div>
                <p className="text-[var(--text-md)] font-semibold text-text-primary">No local results</p>
                <p className="mt-1 text-[var(--text-sm)] text-text-muted">No commands or cached items matched this query.</p>
              </div>
            </div>
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
          <span>Enter opens selected command or result</span>
          <span>Esc closes</span>
        </div>
      </div>
    </div>
  );
}
