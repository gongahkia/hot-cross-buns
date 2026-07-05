import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openOptionsPage, sendExtensionMessage } from "./extensionApi";
import type { AuthStatus, CacheSummary, PlannerCache, SearchFilter, SearchResult } from "./types";
import "./styles.css";

type LoadState = "loading" | "ready" | "error";
type ResultGroupName = "Today" | "Upcoming" | "Later" | "No date";

interface ResultGroup {
  name: ResultGroupName;
  results: SearchResult[];
}

export function SidebarApp() {
  const [auth, setAuth] = useState<AuthStatus | undefined>();
  const [summary, setSummary] = useState<CacheSummary>({ taskCount: 0, eventCount: 0 });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | undefined>();
  const searchRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLElement | null>>([]);

  const groupedResults = useMemo(() => groupResults(results), [results]);
  const activeResult = results[activeIndex];

  const refreshStatus = useCallback(async () => {
    const [nextAuth, nextSummary] = await Promise.all([
      sendExtensionMessage<AuthStatus>({ type: "auth.status" }),
      sendExtensionMessage<CacheSummary>({ type: "cache.summary" })
    ]);
    setAuth(nextAuth);
    setSummary(nextSummary);
    return { nextAuth, nextSummary };
  }, []);

  const runSearch = useCallback(async (nextQuery: string, nextFilter: SearchFilter) => {
    const items = await sendExtensionMessage<SearchResult[]>({
      type: "data.search",
      query: nextQuery,
      filter: nextFilter,
      limit: 50
    });
    setResults(items);
    setActiveIndex(0);
  }, []);

  const refreshData = useCallback(async () => {
    setState("loading");
    setError(undefined);

    try {
      const cache = await sendExtensionMessage<PlannerCache>({ type: "data.refresh" });
      setSummary({
        fetchedAt: cache.fetchedAt,
        taskCount: cache.tasks.length,
        eventCount: cache.events.length,
        windowStart: cache.windowStart,
        windowEnd: cache.windowEnd,
        accountEmail: cache.accountEmail
      });
      await runSearch(query, filter);
      setState("ready");
    } catch (nextError) {
      setError(errorText(nextError));
      setState("error");
    }
  }, [filter, query, runSearch]);

  useEffect(() => {
    void refreshStatus()
      .then(({ nextAuth, nextSummary }) => {
        if (nextAuth.signedIn && nextSummary.taskCount + nextSummary.eventCount > 0) {
          return runSearch("", "upcoming");
        }
        return undefined;
      })
      .then(() => setState("ready"))
      .catch((nextError) => {
        setError(errorText(nextError));
        setState("error");
      });
  }, [refreshStatus, runSearch]);

  useEffect(() => {
    if (!auth?.signedIn) {
      return;
    }

    const timer = window.setTimeout(() => {
      setState((current) => current === "loading" ? current : "ready");
      void runSearch(query, filter).catch((nextError) => {
        setError(errorText(nextError));
        setState("error");
      });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [auth?.signedIn, filter, query, runSearch]);

  useEffect(() => {
    resultRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const displaySummary = useMemo(() => {
    if (!summary.fetchedAt) {
      return "No cache";
    }

    return `${summary.taskCount} tasks, ${summary.eventCount} events`;
  }, [summary]);

  const connect = async () => {
    setState("loading");
    setError(undefined);

    try {
      setAuth(await sendExtensionMessage<AuthStatus>({ type: "auth.start" }));
      await refreshData();
    } catch (nextError) {
      setError(errorText(nextError));
      setState("error");
    }
  };

  const signOut = async () => {
    setAuth(await sendExtensionMessage<AuthStatus>({ type: "auth.signOut" }));
    setResults([]);
    setSummary({ taskCount: 0, eventCount: 0 });
  };

  const openActiveResult = () => {
    if (!activeResult?.sourceUrl) {
      return;
    }

    window.open(activeResult.sourceUrl, "_blank", "noreferrer");
  };

  const moveActiveResult = (direction: 1 | -1) => {
    if (results.length === 0) {
      return;
    }

    setActiveIndex((current) => (current + direction + results.length) % results.length);
  };

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
    const modified = event.metaKey || event.ctrlKey || event.altKey;

    if (modified) {
      return;
    }

    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
      searchRef.current?.focus();
      return;
    }

    if (typing) {
      return;
    }

    if (event.key === "/") {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }

    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      void refreshData();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveResult(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveResult(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      openActiveResult();
    }
  }, [openActiveResult, query, refreshData, results.length]);

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  let renderedIndex = 0;

  return (
    <main className="app-shell" tabIndex={-1}>
      <header className="topbar">
        <div>
          <h1>Hot Cross Buns</h1>
          <p>{auth?.accountEmail ?? displaySummary}</p>
        </div>
        <button className="icon-button" type="button" title="Options" onClick={() => void openOptionsPage()}>
          &#9881;
        </button>
      </header>

      {!auth?.configured ? (
        <section className="empty-state">
          <h2>OAuth client required</h2>
          <p>Add a Google OAuth client ID in options, then connect Google.</p>
          <button type="button" onClick={() => void openOptionsPage()}>Open options</button>
        </section>
      ) : !auth.signedIn ? (
        <section className="empty-state">
          <h2>Connect Google</h2>
          <p>Read-only access to Tasks and Calendar.</p>
          <button type="button" onClick={() => void connect()}>Connect</button>
        </section>
      ) : (
        <>
          <div className="toolbar">
            <input
              aria-label="Search tasks and events"
              placeholder="Search tasks and events"
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="button" onClick={() => void refreshData()} disabled={state === "loading"}>
              Refresh
            </button>
          </div>

          <nav className="segmented" aria-label="Search filters">
            {(["all", "today", "upcoming", "tasks", "events"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? "active" : ""}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </nav>

          {error ? <p className="error">{error}</p> : null}
          {state === "loading" ? <p className="status">Loading...</p> : null}
          {state !== "loading" && results.length === 0 ? <p className="status">No results</p> : null}

          <section className="result-list" aria-label="Results" role="listbox">
            {groupedResults.map((group) => (
              <section className="result-group" key={group.name}>
                <h2 className="result-group-heading">{group.name}</h2>
                {group.results.map((result) => {
                  const currentIndex = renderedIndex++;
                  const active = currentIndex === activeIndex;

                  return (
                    <article
                      aria-selected={active}
                      className={`result-card${active ? " active" : ""}`}
                      key={`${result.kind}:${result.id}`}
                      ref={(node) => {
                        resultRefs.current[currentIndex] = node;
                      }}
                      role="option"
                    >
                      <div>
                        <span className={`badge ${result.kind}`}>{result.kind}</span>
                        <h3>{result.title}</h3>
                        <p>{result.subtitle}</p>
                        <p className="meta">{formatResultDate(result)}</p>
                        {result.snippet ? <p className="snippet">{result.snippet}</p> : null}
                      </div>
                      {result.sourceUrl ? (
                        <a href={result.sourceUrl} target="_blank" rel="noreferrer">Open</a>
                      ) : null}
                    </article>
                  );
                })}
              </section>
            ))}
          </section>

          <footer>
            <button className="link-button" type="button" onClick={() => void signOut()}>Sign out</button>
          </footer>
        </>
      )}
    </main>
  );
}

export function groupResults(results: SearchResult[], now = new Date()): ResultGroup[] {
  const groups: Record<ResultGroupName, SearchResult[]> = {
    Today: [],
    Upcoming: [],
    Later: [],
    "No date": []
  };

  for (const result of results) {
    groups[groupNameForResult(result, now)].push(result);
  }

  return (Object.entries(groups) as Array<[ResultGroupName, SearchResult[]]>)
    .filter(([, groupResults]) => groupResults.length > 0)
    .map(([name, groupResults]) => ({ name, results: groupResults }));
}

function groupNameForResult(result: SearchResult, now: Date): ResultGroupName {
  const value = result.startsAt ?? result.dueAt;

  if (!value) {
    return "No date";
  }

  const key = localDateKey(value);
  const today = localDateKey(now.toISOString());

  if (key === today) {
    return "Today";
  }

  return key > today ? "Upcoming" : "Later";
}

function formatResultDate(result: SearchResult): string {
  const value = result.startsAt ?? result.dueAt;

  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: result.startsAt ? "short" : undefined
  }).format(new Date(value));
}

function localDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
