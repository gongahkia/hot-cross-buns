import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PagedVirtualList, sparseRowGeometry } from "./PagedVirtualList";
import { usePagedCollection } from "../hooks/usePagedCollection";

afterEach(cleanup);

describe("Paged virtual collections", () => {
  it("computes distant positions from sparse measured heights", () => {
    const heights = new Map([[0, 100], [999_999, 80]]);
    const geometry = sparseRowGeometry(1_000_000, 64, heights);
    expect(geometry.offset(1)).toBe(100);
    expect(geometry.offset(500_000)).toBe(500_000 * 64 + 36);
    expect(geometry.indexAt(geometry.offset(999_999))).toBe(999_999);
    expect(geometry.total).toBe(64_000_052);
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
