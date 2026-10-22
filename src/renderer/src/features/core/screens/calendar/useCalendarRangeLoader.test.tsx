import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useCalendarRangeLoader } from "./useCalendarRangeLoader";

it("keeps only the latest viewport behind one in-flight load", async () => {
  let finish: (value: boolean) => void = () => {};
  const load = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const range = (day: number) => ({ start: `2027-01-${day}T00:00:00Z`, end: `2027-01-${day + 1}T00:00:00Z` });
  const hook = renderHook(({ day }) => useCalendarRangeLoader(range(day), true, 0, load), { initialProps: { day: 10 } });
  expect(hook.result.current.loading).toBe(true);
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  for (let day = 11; day <= 20; day++) hook.rerender({ day });
  await act(() => new Promise(resolve => setTimeout(resolve, 110)));
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  expect(hook.result.current.loading).toBe(true);
  expect(load).toHaveBeenLastCalledWith(range(20));
  await act(async () => finish(true));
  expect(hook.result.current.error).toBeUndefined();
  expect(hook.result.current.loading).toBe(false);
});

it("retries a superseded cache generation and reports an actual failure", async () => {
  const load = vi.fn().mockResolvedValue(false);
  const hook = renderHook(() => useCalendarRangeLoader({ start: "start", end: "end" }, true, 0, load));
  await waitFor(() => expect(hook.result.current.error).toBe("Calendar range could not be loaded."));
  expect(load).toHaveBeenCalledTimes(2);
  expect(hook.result.current.loading).toBe(false);
  load.mockResolvedValue(true);
  act(() => hook.result.current.retry());
  await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
  expect(hook.result.current.error).toBeUndefined();
});
