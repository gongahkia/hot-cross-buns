import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PagedVirtualList, sparseRowGeometry } from "./PagedVirtualList";
import { usePagedCollection } from "../hooks/usePagedCollection";

afterEach(cleanup);

describe("Paged virtual collections", () => {
  it("measures a visible row batch with one shared observer", async () => {
    const OriginalObserver = globalThis.ResizeObserver;
    const observations: Array<{ callback: ResizeObserverCallback; elements: Set<Element> }> = [];
    vi.stubGlobal("ResizeObserver", class {
      observation: typeof observations[number];
      constructor(callback: ResizeObserverCallback) { this.observation = { callback, elements: new Set() }; observations.push(this.observation); }
      observe(element: Element): void { this.observation.elements.add(element); }
      unobserve(element: Element): void { this.observation.elements.delete(element); }
      disconnect(): void { this.observation.elements.clear(); }
    });
    try {
      function Surface(): JSX.Element {
        const collection = usePagedCollection<number>("measured", async () => ({ items: [0, 1, 2], page: { limit: 100, totalKnown: 3 } }));
        return <PagedVirtualList ariaLabel="Measured rows" collection={collection} renderRow={(item) => <button>Row {item}</button>} />;
      }
      const view = render(<Surface />);
      await screen.findByRole("button", { name: "Row 2" });
      const rows = observations.filter(({ elements }) => [...elements].some((element) => element.hasAttribute("data-virtual-index")));
      expect(rows).toHaveLength(1);
      const observer = rows[0];
      expect(observer.elements.size).toBe(3);
      await act(async () => observer.callback([...observer.elements].map((element, index) => ({ target: element, borderBoxSize: [{ blockSize: [100, 80, 90][index] }] })) as unknown as ResizeObserverEntry[], {} as ResizeObserver));
      expect(screen.getByRole("button", { name: "Row 2" }).closest("[data-virtual-index]")).toHaveStyle({ transform: "translateY(180px)" });
      expect(screen.getByRole("list", { name: "Measured rows" }).firstElementChild).toHaveStyle({ height: "270px" });
      view.unmount();
      expect(observer.elements.size).toBe(0);
    } finally { vi.stubGlobal("ResizeObserver", OriginalObserver); }
  });

  it("computes distant positions from sparse measured heights", () => {
    const heights = new Map([[0, 100], [999_999, 80]]);
    const geometry = sparseRowGeometry(1_000_000, 64, heights);
    expect(geometry.offset(1)).toBe(100);
    expect(geometry.offset(500_000)).toBe(500_000 * 64 + 36);
    expect(geometry.indexAt(geometry.offset(999_999))).toBe(999_999);
    expect(geometry.total).toBe(64_000_052);
  });

  it("revalidates an empty list when its first item arrives", async () => {
    function Surface({ revision }: { revision: number }): JSX.Element {
      const collection = usePagedCollection<number>(String(revision), async () => ({ items: revision ? [42] : [], page: { limit: 100, totalKnown: revision ? 1 : 0 } }));
      return <PagedVirtualList ariaLabel="Destination" collection={collection} emptyState={<p>Empty list</p>} renderRow={(item) => <button>Item {item}</button>} />;
    }
    const view = render(<Surface revision={0} />);
    await screen.findByText("Empty list");
    view.rerender(<Surface revision={1} />);
    await screen.findByRole("button", { name: "Item 42" });
  });

  it("loads distant rows on demand, supports keyboard focus, and evicts old pages", async () => {
    const read = vi.fn(async (offset: number, limit: number) => ({ items: Array.from({ length: Math.min(limit, 10_000 - offset) }, (_, index) => offset + index), page: { limit, totalKnown: 10_000 } }));
    function Surface(): JSX.Element {
      const collection = usePagedCollection<number>("tasks", read);
      return <PagedVirtualList ariaLabel="Paged tasks" collection={collection} renderRow={(item) => <button>Task {item}</button>} />;
    }
    render(<Surface />);
    await screen.findByRole("button", { name: /^Task 0$/ });
    const viewport = screen.getByRole("list", { name: "Paged tasks" });
    Object.defineProperty(viewport, "clientHeight", { value: 600 });
    fireEvent.keyDown(viewport, { key: "End" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Task 9999" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Task 0" })).toHaveFocus());
    for (let page = 1; page < 20; page += 1) {
      await act(async () => { fireEvent.scroll(viewport, { target: { scrollTop: page * 100 * 64 } }); await Promise.resolve(); });
    }
    expect(Number(viewport.dataset.loadedCount)).toBeLessThanOrEqual(600);
    expect(screen.getAllByRole("button").length).toBeLessThan(40);
    expect(read.mock.calls.some(([offset]) => offset === 9900)).toBe(true);
    expect(read.mock.calls.length).toBeLessThan(50);
  });
});

it("bounds reads across rapid filter changes and releases disabled columns", async () => {
  const pending: Array<{ query: string; finish: (value: any) => void }> = [];
  let concurrent = 0, maximum = 0;
  const read = vi.fn((query: string, offset: number, limit: number) => {
    concurrent += 1; maximum = Math.max(maximum, concurrent);
    return new Promise<any>((resolve) => pending.push({ query, finish: (value) => { concurrent -= 1; resolve(value); } }));
  });
  function Surface({ query, enabled }: { query: string; enabled: boolean }): JSX.Element {
    const collection = usePagedCollection<number>(query, (offset, limit) => read(query, offset, limit), 100, enabled);
    return <><button onClick={() => collection.ensure(0, 350)}>Read window</button><output data-testid="cached">{collection.loadedCount}</output></>;
  }
  const view = render(<Surface query="A" enabled />);
  await act(async () => { pending[0].finish({ items: [1], page: { limit: 100, totalKnown: 400 } }); await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: "Read window" }));
  expect(read).toHaveBeenCalledTimes(3);
  view.rerender(<Surface query="B" enabled />);
  view.rerender(<Surface query="C" enabled />);
  expect(read).toHaveBeenCalledTimes(3);
  await act(async () => {
    pending[1].finish({ items: [1], page: { limit: 100, totalKnown: 400 } });
    pending[2].finish({ items: [2], page: { limit: 100, totalKnown: 400 } });
    await Promise.resolve();
  });
  expect(read.mock.calls.slice(3).every(([query]) => query === "C")).toBe(true);
  expect(maximum).toBe(2);
  expect(screen.getByTestId("cached")).toHaveTextContent("1");
  view.rerender(<Surface query="C" enabled={false} />);
  await act(async () => {
    for (const request of pending.slice(3)) request.finish({ items: [3], page: { limit: 100, totalKnown: 400 } });
    await Promise.resolve();
  });
  expect(screen.getByTestId("cached")).toHaveTextContent("0");
  expect(maximum).toBe(2);
});
