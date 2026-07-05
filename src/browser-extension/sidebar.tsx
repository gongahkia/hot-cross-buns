import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { openOptionsPage, sendExtensionMessage } from "./extensionApi";
import type { AuthStatus, CacheSummary, PlannerCache, SearchFilter, SearchResult } from "./types";
import "./styles.css";

type LoadState = "idle" | "loading" | "ready" | "error";

function SidebarApp() {
  const [auth, setAuth] = useState<AuthStatus | undefined>();
  const [summary, setSummary] = useState<CacheSummary>({ taskCount: 0, eventCount: 0 });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | undefined>();

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

  return (
    <main className="app-shell">
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

          <section className="result-list" aria-label="Results">
            {results.map((result) => (
              <article className="result-card" key={`${result.kind}:${result.id}`}>
                <div>
                  <span className={`badge ${result.kind}`}>{result.kind}</span>
                  <h2>{result.title}</h2>
                  <p>{result.subtitle}</p>
                  <p className="meta">{formatResultDate(result)}</p>
                  {result.snippet ? <p className="snippet">{result.snippet}</p> : null}
                </div>
                {result.sourceUrl ? (
                  <a href={result.sourceUrl} target="_blank" rel="noreferrer">Open</a>
                ) : null}
              </article>
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SidebarApp />
  </React.StrictMode>
);
