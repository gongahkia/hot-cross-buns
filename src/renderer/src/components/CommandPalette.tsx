import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { KeyboardEvent } from "react";
import { Search } from "lucide-react";
import {
  plannerActionAvailability,
  plannerActions,
  type PlannerAction,
  type PlannerActionContext
} from "../actions/plannerActions";
import type { SectionId } from "../data/mockPlanner";
import { useLocalSearch } from "../features/core/coreViewModelSource";
import type { SearchResultViewModel, SearchSource } from "../features/core/coreViewModels";
import { useI18n } from "../i18n";
import { LoadingIndicator } from "./LoadingIndicator";

const commandCategories = ["Create", "Navigate", "Calendar", "Task", "Edit", "Sync", "Diagnostics"];

interface CommandPaletteProps {
  actionContext: PlannerActionContext;
  initialQuery?: string;
  mode?: "open" | "action";
  onCommand?: (command: PlannerAction) => boolean | void;
  onNavigate: (sectionId: SectionId, afterNavigate?: () => void) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pinnedFilters?: Array<{ id: string; name: string; query: string }>;
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

function commandAllowedInMode(command: PlannerAction, mode: "open" | "action"): boolean {
  if (mode === "open") {
    return true;
  }

  return command.category !== "Navigate";
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
  mode = "open",
  onCommand,
  onNavigate,
  onOpenChange,
  open,
  pinnedFilters = []
}: CommandPaletteProps): JSX.Element | null {
  const { t } = useI18n();
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedQuery = query.trim();

  const filteredCommands = useMemo(
    () => plannerActions
      .filter((command) => commandAllowedInMode(command, mode) && commandMatches(command, query))
      .sort((a, b) => commandCategories.indexOf(a.category) - commandCategories.indexOf(b.category)),
    [mode, query]
  );
  const searchEnabled = mode === "open" && trimmedQuery.length > 0 && filteredCommands.length === 0;
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

  useEffect(() => {
    if (!open) return;
    const option = document.querySelector<HTMLElement>("#command-palette-options [aria-selected='true']");
    option?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, open, query]);

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

    const dispatch = () => {
      dispatchCalendarCommand(command);
      dispatchNoteCommand(command);
    };
    if (command.sectionId) onNavigate(command.sectionId, dispatch);
    else dispatch();

    closePalette();
  }

  function runSearchResult(result: SearchResultViewModel | undefined): void {
    if (!result) {
      return;
    }

    onNavigate(searchResultSection(result.source), () => dispatchSearchResultOpen(result));
    closePalette();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const enabled = filteredCommands.length > 0
        ? filteredCommands.flatMap((command, index) => plannerActionAvailability(command, actionContext).enabled ? [index] : [])
        : searchResults.map((_, index) => index);
      const position = enabled.indexOf(highlightedIndex);
      const next = event.key === "Home" ? enabled[0]
        : event.key === "End" ? enabled.at(-1)
        : event.key === "ArrowDown" ? enabled[Math.min(position + 1, enabled.length - 1)]
        : enabled[Math.max(position - 1, 0)];
      if (next !== undefined) setHighlightedIndex(next);
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="command-palette-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="command-palette"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">
            {mode === "open" ? t("command.title") : "Action Palette"}
          </Dialog.Title>
          <div className="command-palette-search">
            <Search aria-hidden="true" size={20} />
            <input
              aria-activedescendant={activeOptionId}
              aria-controls="command-palette-options"
              aria-label={t("command.filter")}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={mode === "open" ? "Type a command or search…" : "Type a command…"}
              ref={inputRef}
              role="searchbox"
              spellCheck={false}
              value={query}
            />
          </div>
          <div className="command-palette-filters">
          {pinnedFilters.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Pinned filters">
              {pinnedFilters.map((filter) => (
                <button
                  className="min-h-10 max-w-full truncate rounded-hcbMd border border-border bg-surface-0 px-3 text-[var(--text-xs)] font-medium text-text-secondary transition-[background-color,border-color,color] duration-fast ease-hcb hover:bg-surface-1 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  key={filter.id}
                  onClick={() => setQuery(filter.query)}
                  title={filter.query}
                  type="button"
                >
                  {filter.name}
                </button>
              ))}
            </div>
          ) : null}
          {search.parsed.explain.filter((item) => !item.startsWith("Text: ")).length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Search query explanation">
              {search.parsed.explain.filter((item) => !item.startsWith("Text: ")).map((item) => (
                <span
                  className="max-w-full truncate rounded-hcbMd border border-border bg-surface-0 px-2 py-1 text-[var(--text-xs)] text-text-muted"
                  key={item}
                  title={item}
                >
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="command-palette-options" id="command-palette-options" aria-label="Commands and search results" role="listbox">
          {filteredCommands.length > 0 ? (
            filteredCommands.map((command, index) => {
              const availability = plannerActionAvailability(command, actionContext);

              const category = command.category === "Navigate" ? "Navigation" : command.category === "Calendar" ? "View" : command.category;
              return (
                <Fragment key={command.id}>
                  {filteredCommands[index - 1]?.category !== command.category ? (
                    <div className="command-palette-group" role="presentation">{category}</div>
                  ) : null}
                  <button
                    aria-disabled={!availability.enabled}
                    aria-selected={index === highlightedIndex}
                    className="command-palette-option"
                    data-action-id={command.id}
                    disabled={!availability.enabled}
                    id={`command-option-${command.id}`}
                    onClick={() => runCommand(command)}
                    onMouseMove={() => { if (availability.enabled) setHighlightedIndex(index); }}
                    role="option"
                    tabIndex={-1}
                    title={availability.reason ?? command.description}
                    type="button"
                  >
                    <span className="min-w-0 flex-1 truncate">{command.label}</span>
                    {availability.reason ? <span className="command-palette-reason">{availability.reason}</span> : null}
                  </button>
                </Fragment>
              );
            })
          ) : search.parsed.errors.length > 0 ? (
            <div
              aria-live="polite"
              className="rounded-hcbMd border border-warning bg-bg-tertiary px-3 py-2 text-[var(--text-sm)] text-warning"
              role="alert"
            >
              {search.parsed.errors.map((error) => error.message).join(" ")}
            </div>
          ) : search.state === "loading" || search.state === "stale" ? (
            <div className="grid min-h-28 place-items-center text-center">
              <div>
                <LoadingIndicator className="mx-auto text-accent" size={20} surface="search" />
                <p className="text-[var(--text-md)] font-semibold text-text-primary">{t("command.loading.title")}</p>
                <p className="mt-1 text-[var(--text-sm)] text-text-muted">{t("command.loading.detail")}</p>
              </div>
            </div>
          ) : searchResults.length > 0 ? (
            searchResults.map((result, index) => (
              <button
                aria-selected={index === highlightedIndex}
                className="command-palette-option"
                id={`search-option-${result.id}`}
                key={result.id}
                onClick={() => runSearchResult(result)}
                onMouseMove={() => setHighlightedIndex(index)}
                role="option"
                tabIndex={-1}
                type="button"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[var(--text-md)] font-medium">{result.title}</div>
                  <div className="truncate text-[var(--text-xs)] text-text-muted">{result.detail}</div>
                </div>
              </button>
            ))
          ) : trimmedQuery ? (
            <div className="grid min-h-28 place-items-center text-center">
              <div>
                <p className="text-[var(--text-md)] font-semibold text-text-primary">{t("command.empty.noLocalResults")}</p>
                <p className="mt-1 text-[var(--text-sm)] text-text-muted">{t("command.empty.unmatched")}</p>
              </div>
            </div>
          ) : (
            <div className="grid min-h-28 place-items-center text-center">
              <div>
                <p className="text-[var(--text-md)] font-semibold text-text-primary">{t("command.empty.noCommands")}</p>
                <p className="mt-1 text-[var(--text-sm)] text-text-muted">{t("command.empty.trySection")}</p>
              </div>
            </div>
          )}
        </div>
          <div className="command-palette-footer">
            <span><span aria-hidden="true">↑↓</span> Navigate</span>
            <span><span aria-hidden="true">↵</span> Select</span>
            <Dialog.Close className="command-palette-close" aria-label={t("command.close")}>
              <kbd>esc</kbd> Close
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
