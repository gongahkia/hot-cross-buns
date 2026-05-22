import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { CheckCircle2, Command, RefreshCw, WifiOff } from "lucide-react";
import { CommandPalette } from "./components/CommandPalette";
import { Badge, Button, IconButton, StatusBanner, cx } from "./components/primitives";
import { getPlannerSection, plannerSections, type SectionId } from "./data/mockPlanner";
import { SectionContent } from "./features/core/CoreScreens";
import { RenderTimingBoundary, useRenderTiming } from "./hooks/useRenderTiming";

function scheduleFrame(callback: () => void): void {
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
    return;
  }

  window.setTimeout(callback, 0);
}

export default function App(): JSX.Element {
  useRenderTiming("App");

  const [activeSectionId, setActiveSectionId] = useState<SectionId>("today");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [healthLabel, setHealthLabel] = useState("Starting");
  const [searchQuery, setSearchQuery] = useState("");
  const shellVisibleReported = useRef(false);
  const sectionButtonRefs = useRef(new Map<SectionId, HTMLButtonElement>());

  const activeSection = getPlannerSection(activeSectionId);
  const ActiveIcon = activeSection.icon;

  const setSectionButtonRef = useCallback(
    (sectionId: SectionId) =>
      (node: HTMLButtonElement | null): void => {
        if (node) {
          sectionButtonRefs.current.set(sectionId, node);
        } else {
          sectionButtonRefs.current.delete(sectionId);
        }
      },
    []
  );

  const navigateToSection = useCallback((sectionId: SectionId): void => {
    setActiveSectionId(sectionId);
  }, []);

  const focusSection = useCallback(
    (sectionId: SectionId): void => {
      navigateToSection(sectionId);
      sectionButtonRefs.current.get(sectionId)?.focus();
      scheduleFrame(() => sectionButtonRefs.current.get(sectionId)?.focus());
    },
    [navigateToSection]
  );

  function handleNavigationKeyDown(event: KeyboardEvent<HTMLButtonElement>, sectionId: SectionId): void {
    const currentIndex = plannerSections.findIndex((section) => section.id === sectionId);
    let nextIndex = currentIndex;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = Math.min(currentIndex + 1, plannerSections.length - 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = Math.max(currentIndex - 1, 0);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = plannerSections.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    focusSection(plannerSections[nextIndex].id);
  }

  useEffect(() => {
    let cancelled = false;

    if (!window.hcb) {
      setHealthLabel("Renderer only");
      return;
    }

    window.hcb.diagnostics.health().then((result) => {
      if (cancelled) {
        return;
      }

      setHealthLabel(result.ok ? "Ready" : "Diagnostics unavailable");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (shellVisibleReported.current) {
      return;
    }

    shellVisibleReported.current = true;
    scheduleFrame(() => {
      void window.hcb?.diagnostics.markShellVisible();
    });
  }, []);

  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  return (
    <div
      className="grid h-screen min-h-[640px] grid-cols-[232px_minmax(0,1fr)] bg-bg-primary text-text-primary"
      data-testid="app-shell"
    >
      <aside className="flex min-h-0 flex-col border-r border-border bg-bg-secondary">
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <div className="flex size-8 items-center justify-center rounded-hcbMd bg-surface-0 text-accent">
            <CheckCircle2 aria-hidden="true" size={18} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[var(--text-md)] font-semibold">Hot Cross Buns 2</div>
            <div className="text-[var(--text-xs)] text-text-muted">Local planner shell</div>
          </div>
        </div>

        <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 px-2 py-3">
          {plannerSections.map((section) => {
            const Icon = section.icon;
            const selected = section.id === activeSectionId;

            return (
              <button
                aria-current={selected ? "page" : undefined}
                className={cx(
                  "flex h-9 w-full items-center gap-3 rounded-hcbMd px-3 text-left text-[var(--text-base)] transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  selected
                    ? "bg-surface-0 text-text-primary"
                    : "text-text-secondary hover:bg-surface-0 hover:text-text-primary"
                )}
                key={section.id}
                onClick={() => navigateToSection(section.id)}
                onKeyDown={(event) => handleNavigationKeyDown(event, section.id)}
                ref={setSectionButtonRef(section.id)}
                type="button"
              >
                <Icon aria-hidden="true" size={16} strokeWidth={2} />
                <span className="min-w-0 flex-1 truncate">{section.label}</span>
                <span className="shrink-0 text-[var(--text-xs)] text-text-muted">{section.metric}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-border px-4 py-3 text-[var(--text-xs)] text-text-muted">
          <div className="flex items-center justify-between gap-3">
            <span>Runtime</span>
            <Badge tone={healthLabel === "Ready" ? "success" : "neutral"}>{healthLabel}</Badge>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border bg-bg-primary px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-hcbMd bg-surface-0 text-accent">
              <ActiveIcon aria-hidden="true" size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[var(--text-xl)] font-bold" id="planner-title">
                {activeSection.title}
              </h1>
              <p className="truncate text-[var(--text-sm)] text-text-muted">{activeSection.subtitle}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2" role="toolbar" aria-label="Planner actions">
            <Button
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => setCommandPaletteOpen(true)}
              variant="secondary"
            >
              <Command aria-hidden="true" size={15} />
              Command palette
              <span className="rounded-hcbSm border border-border px-1.5 font-mono text-[var(--text-xs)] text-text-muted">
                Ctrl K
              </span>
            </Button>
            <IconButton icon={RefreshCw} label="Mock refresh" variant="ghost" />
          </div>
        </header>

        <section
          aria-labelledby="planner-title"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4"
        >
          <StatusBanner
            action={<Badge tone="warning">No real data access</Badge>}
            description="Using local mock rows only. SQLite, Google, MCP, and filesystem services are not wired."
            icon={WifiOff}
            title="Offline mock mode"
            tone="offline"
          />

          <RenderTimingBoundary id={`section:${activeSectionId}`}>
            <SectionContent
              activeSectionId={activeSectionId}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
            />
          </RenderTimingBoundary>
        </section>
      </main>

      <RenderTimingBoundary id="command-palette">
        <CommandPalette
          onNavigate={navigateToSection}
          onOpenChange={setCommandPaletteOpen}
          open={commandPaletteOpen}
        />
      </RenderTimingBoundary>
    </div>
  );
}
