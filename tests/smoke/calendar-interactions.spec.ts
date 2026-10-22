import { expect, type Locator, type Page } from "@playwright/test";
import { test, planner, capture } from "./planner";
import { chooseCalendarView } from "./calendarActions";

test.setTimeout(60_000);

async function date(page: Page, day = "2027-01-12") {
  await page.getByRole("button", { name: "Choose calendar date" }).click();
  await page.getByLabel("Go to date", { exact: true }).fill(day);
  await page.getByRole("button", { name: "Done", exact: true }).click();
}

async function seed(page: Page, entries: Array<Record<string, unknown>>) {
  return page.evaluate(async (items) => {
    const ids: string[] = [];
    for (const item of items) {
      const result = await window.hcb!.calendar.create({ calendarId: "primary", ...item });
      if (!result.ok) throw new Error(result.error.message);
      ids.push(result.data.id);
    }
    window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    return ids;
  }, entries);
}

async function record(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const result = await window.hcb!.calendar.get({ id });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }, id);
}

async function drag(page: Page, from: Locator, to: Locator, release = true) {
  // A settled viewport refresh can replace a segment during Playwright's scroll check.
  // Retry preparation only; never repeat the gesture or its write.
  await expect(async () => { await from.scrollIntoViewIfNeeded(); await expect(from).toBeVisible(); }).toPass({ timeout: 5000 });
  const a = await from.boundingBox(), b = await to.boundingBox();
  expect(a).not.toBeNull(); expect(b).not.toBeNull();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + Math.min(50, b!.height / 2), { steps: 12 });
  if (release) await page.mouse.up();
}

test("Month moves timed events, previews without writing, supports cancellation and persists after reload", async () => {
  await planner(async (page) => {
    const [id] = await seed(page, [{ title: "Monthly planning", startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T10:30:00Z" }]);
    await chooseCalendarView(page, "month"); await date(page);
    const chip = page.locator('.calendar-month .calendar-event-chip').filter({ hasText: "Monthly planning" });
    const target = page.locator('[data-calendar-date="2027-01-14"]');
    await drag(page, chip, target, false);
    await expect(page.locator("[data-calendar-gesture-preview]")).toContainText("2027-01-14");
    expect((await record(page, id)).startsAt).toBe("2027-01-12T09:00:00Z");
    await page.keyboard.press("Escape"); await page.mouse.up();
    await expect(page.getByTestId("inspector-shell")).toHaveCount(0);
    await expect(page.locator("[data-calendar-gesture-preview]")).toHaveCount(0);
    expect((await record(page, id)).startsAt).toBe("2027-01-12T09:00:00Z");
    await drag(page, chip, target);
    await expect.poll(async () => (await record(page, id)).startsAt).toBe("2027-01-14T09:00:00.000Z");
    expect((await record(page, id)).endsAt).toBe("2027-01-14T10:30:00.000Z");
    await page.reload();
    await expect(page.locator('[data-calendar-date="2027-01-14"]')).toBeVisible();
    expect((await record(page, id)).startsAt).toBe("2027-01-14T09:00:00.000Z");
    await capture(page, "month-event-moved");
  });
});

test("Month resizes both ends of all-day spans, retaining exclusive end dates", async () => {
  await planner(async (page) => {
    const [id] = await seed(page, [{ title: "Conference", allDay: true, startsAt: "2027-01-12T00:00:00Z", endsAt: "2027-01-15T00:00:00Z" }]);
    await chooseCalendarView(page, "month"); await date(page);
    await drag(page, page.getByRole("button", { name: "Resize Conference end", exact: true }), page.locator('[data-calendar-date="2027-01-16"]'));
    await expect.poll(async () => (await record(page, id)).endsAt).toBe("2027-01-17T00:00:00.000Z");
    await drag(page, page.getByRole("button", { name: "Resize Conference start", exact: true }), page.locator('[data-calendar-date="2027-01-11"]'));
    await expect.poll(async () => (await record(page, id)).startsAt).toBe("2027-01-11T00:00:00.000Z");
    expect((await record(page, id)).allDay).toBe(true);
  });
});

test("Month asks for recurring scope and cancels without changing the series", async () => {
  await planner(async (page) => {
    const [id] = await seed(page, [{ title: "Weekly review", startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T10:00:00Z", recurrence: { frequency: "weekly", interval: 1 } }]);
    await chooseCalendarView(page, "month"); await date(page);
    const chip = page.locator('.calendar-month .calendar-event-chip').filter({ hasText: "Weekly review" }).first();
    await drag(page, chip, page.locator('[data-calendar-date="2027-01-13"]'));
    const scope = page.getByRole("dialog", { name: "Save recurring event" });
    await expect(scope).toBeVisible();
    await scope.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await record(page, id)).startsAt).toBe("2027-01-12T09:00:00Z");
    await drag(page, chip, page.locator('[data-calendar-date="2027-01-13"]'));
    await scope.getByRole("button", { name: "This occurrence", exact: true }).click();
    await expect(scope).toBeHidden();
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.hcb!.calendar.listEvents({ start: "2027-01-13T00:00:00Z", end: "2027-01-14T00:00:00Z" });
      return result.ok && result.data.items.some((item) => item.title === "Weekly review" && item.startsAt.startsWith("2027-01-13T09:00"));
    })).toBe(true);
    expect((await record(page, id)).startsAt).toBe("2027-01-12T09:00:00Z");
  });
});


test("Month keyboard move and resize use the same persisted mutation path", async () => {
  await planner(async (page) => {
    const [id] = await seed(page, [{ title: "Keyboard trip", allDay: true, startsAt: "2027-01-12T00:00:00Z", endsAt: "2027-01-14T00:00:00Z" }]);
    await chooseCalendarView(page, "month"); await date(page);
    const chip = page.locator('.calendar-month .calendar-event-chip').filter({ hasText: "Keyboard trip" });
    await chip.focus(); await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await record(page, id)).startsAt).toBe("2027-01-13T00:00:00.000Z");
    await page.getByRole("button", { name: "Resize Keyboard trip end", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await record(page, id)).endsAt).toBe("2027-01-16T00:00:00.000Z");
  });
});

test("a Month gesture on a later occurrence shifts the whole series without losing its beginning", async () => {
  await planner(async (page) => {
    const [id] = await seed(page, [{ title: "Series shift", startsAt: "2027-01-05T09:00:00Z", endsAt: "2027-01-05T10:00:00Z", recurrenceLines: ["RRULE:FREQ=WEEKLY;COUNT=5"] }]);
    await chooseCalendarView(page, "month"); await date(page);
    const chip = page.locator('.calendar-month .calendar-event-chip').filter({ hasText: "Series shift" }).nth(1);
    await drag(page, chip, page.locator('[data-calendar-date="2027-01-13"]'));
    await page.getByRole("dialog", { name: "Save recurring event" }).getByRole("button", { name: "Entire series" }).click();
    await expect.poll(async () => (await record(page, id)).startsAt).toBe("2027-01-06T09:00:00.000Z");
    expect((await record(page, id)).recurrenceLines).toEqual(["RRULE:FREQ=WEEKLY;COUNT=5"]);
  });
});

test("Month reports a failed gesture instead of treating the preview as saved", async () => {
  await planner(async (page) => {
    const [id] = await seed(page, [{ title: "Removed elsewhere", startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T10:00:00Z" }]);
    await chooseCalendarView(page, "month"); await date(page);
    const chip = page.locator('.calendar-month .calendar-event-chip').filter({ hasText: "Removed elsewhere" });
    await drag(page, chip, page.locator('[data-calendar-date="2027-01-14"]'), false);
    await page.evaluate(async (id) => { await window.hcb!.calendar.delete({ id }); }, id);
    await page.mouse.up();
    await expect(page.getByText("Calendar interaction not saved", { exact: true })).toBeVisible();
    await expect(page.getByText("Calendar event no longer exists", { exact: true })).toBeVisible();
    await expect(page.locator("[data-calendar-gesture-preview]")).toHaveCount(0);
  });
});

async function timelinePoint(page: Page, day: string, minutes: number) {
  const column = page.locator(`[data-calendar-day-events][data-calendar-date="${day}"]`);
  const rect = await column.boundingBox(); expect(rect).not.toBeNull();
  return { x: rect!.x + rect!.width / 2, y: rect!.y + rect!.height * minutes / 1440 };
}

async function dragToTime(page: Page, from: Locator, day: string, minutes: number) {
  // A settled viewport refresh can replace a segment during Playwright's scroll check.
  // Retry preparation only; never repeat the gesture or its write.
  await expect(async () => { await from.scrollIntoViewIfNeeded(); await expect(from).toBeVisible(); }).toPass({ timeout: 5000 });
  const a = (await from.boundingBox())!, b = await timelinePoint(page, day, minutes);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
}

test("timeline resizes both ends and moves between days while retaining duration", async () => {
  await planner(async page => {
    const [id] = await seed(page, [{ title: "Timeline planning", startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T10:00:00Z" }]);
    await chooseCalendarView(page, "week"); await date(page);
    await dragToTime(page, page.getByRole("button", { name: "Resize Timeline planning start", exact: true }), "2027-01-12", 8 * 60 + 30);
    await expect.poll(async () => (await record(page, id)).startsAt).toBe("2027-01-12T08:30:00.000Z");
    await dragToTime(page, page.getByRole("button", { name: "Resize Timeline planning end", exact: true }), "2027-01-12", 10 * 60 + 30);
    await expect.poll(async () => (await record(page, id)).endsAt).toBe("2027-01-12T10:30:00.000Z");
    const chip = page.locator('.calendar-timeline .calendar-event-chip').filter({ hasText: "Timeline planning" });
    await dragToTime(page, chip, "2027-01-13", 9 * 60 + 30);
    await expect.poll(async () => (await record(page, id)).startsAt).toBe("2027-01-13T08:30:00.000Z");
    expect((await record(page, id)).endsAt).toBe("2027-01-13T10:30:00.000Z");
    await capture(page, "timeline-event-resized");
  });
});

test("timeline all-day spans resize both ends and keep their date-only meaning", async () => {
  await planner(async page => {
    const [id] = await seed(page, [{ title: "Timeline trip", allDay: true, startsAt: "2027-01-12T00:00:00Z", endsAt: "2027-01-14T00:00:00Z" }]);
    await chooseCalendarView(page, "week"); await date(page);
    await drag(page, page.getByRole("button", { name: "Resize Timeline trip end", exact: true }), page.locator('[data-calendar-all-day-date="2027-01-14"]'));
    await expect.poll(async () => (await record(page, id)).endsAt).toBe("2027-01-15T00:00:00.000Z");
    await drag(page, page.getByRole("button", { name: "Resize Timeline trip start", exact: true }), page.locator('[data-calendar-all-day-date="2027-01-11"]'));
    await expect.poll(async () => (await record(page, id)).startsAt).toBe("2027-01-11T00:00:00.000Z");
    expect((await record(page, id)).allDay).toBe(true);
  });
});

test("timeline edge dragging scrolls and navigates without saving until release; blur cancels", async () => {
  await planner(async page => {
    const [id] = await seed(page, [{ title: "Edge session", startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T10:00:00Z" }]);
    await chooseCalendarView(page, "week"); await date(page);
    const chip = page.locator('.calendar-timeline .calendar-event-chip').filter({ hasText: "Edge session" });
    await chip.scrollIntoViewIfNeeded();
    const a = (await chip.boundingBox())!, scroll = page.locator('[data-calendar-timeline-scroll]'), b = (await scroll.boundingBox())!;
    const oldTop = await scroll.evaluate(el => el.scrollTop);
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height - 6, { steps: 8 });
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(oldTop + 30);
    await page.mouse.move(b.x + b.width - 4, b.y + b.height / 2, { steps: 8 });
    await expect(page.locator('[data-calendar-day-events][data-calendar-date="2027-01-17"]')).toHaveCount(1);
    expect((await record(page, id)).startsAt).toBe("2027-01-12T09:00:00Z");
    await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await page.mouse.up();
    await expect(page.locator('[data-calendar-gesture-preview]')).toHaveCount(0);
    expect((await record(page, id)).startsAt).toBe("2027-01-12T09:00:00Z");
  });
});

test("moving a scheduled task keeps its block and planned dates synchronized without moving its due date", async () => {
  await planner(async page => {
    const data = await page.evaluate(async () => {
      const task = await window.hcb!.tasks.create({ listId: "inbox", title: "Linked work", dueDate: "2027-01-20", durationMinutes: 60 });
      if (!task.ok) throw new Error(task.error.message);
      const block = await window.hcb!.calendar.scheduleTaskBlock({ taskId: task.data.id, calendarId: "primary", startsAt: "2027-01-12T09:00:00Z", durationMinutes: 60 });
      if (!block.ok) throw new Error(block.error.message);
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      return { taskId: task.data.id, eventId: block.data.calendarEventId, blockId: block.data.id };
    });
    await chooseCalendarView(page, "week"); await date(page);
    const chip = page.locator('.calendar-timeline .calendar-event-chip').filter({ hasText: "Linked work" });
    await chip.focus(); await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await record(page, data.eventId)).startsAt).toBe("2027-01-12T09:15:00.000Z");
    const state = await page.evaluate(async ({ taskId }) => {
      const task = await window.hcb!.tasks.get({ id: taskId });
      const blocks = await window.hcb!.calendar.listScheduledTaskBlocks({ start: "2027-01-12T00:00:00Z", end: "2027-01-13T00:00:00Z" });
      if (!task.ok || !blocks.ok) throw new Error("Cannot read scheduling state");
      return { task: task.data, blocks: blocks.data.items ?? blocks.data };
    }, data);
    expect(state.task.plannedStart).toBe("2027-01-12T09:15:00.000Z");
    expect(state.task.dueAt.slice(0, 10)).toBe("2027-01-20");
    expect(state.blocks.find((block: { id: string }) => block.id === data.blockId).startsAt).toBe("2027-01-12T09:15:00.000Z");
  });
});

test("horizontal scrolling rolls a bounded week by days, survives reload and resets on date selection", async () => {
  await planner(async page => {
    await chooseCalendarView(page, "week"); await date(page);
    const calendar = page.getByTestId("calendar-view"), scroll = page.locator('[data-calendar-timeline-scroll]');
    await expect(calendar).toHaveAttribute("data-range-start", "2027-01-10T00:00:00.000Z");
    await scroll.hover(); await page.mouse.wheel(160, 0);
    await expect(calendar).toHaveAttribute("data-range-start", "2027-01-11T00:00:00.000Z");
    await expect(page.locator('[data-calendar-day-events]')).toHaveCount(7);
    await page.mouse.wheel(0, 250);
    await expect(calendar).toHaveAttribute("data-range-start", "2027-01-11T00:00:00.000Z");
    await page.reload();
    await expect(calendar).toHaveAttribute("data-range-start", "2027-01-11T00:00:00.000Z");
    await date(page, "2027-01-20");
    await expect(calendar).toHaveAttribute("data-range-start", "2027-01-17T00:00:00.000Z");
    await date(page, "2027-01-27"); await scroll.hover();
    for (let step = 1; step <= 4; step++) {
      await page.mouse.wheel(160, 0);
      await expect(calendar).toHaveAttribute("data-range-start", `2027-01-${24 + step}T00:00:00.000Z`);
      await page.waitForTimeout(140);
    }
    await expect(page.getByRole("button", { name: "Choose calendar date" })).toContainText("February 2027");
  });
});

test("Month scrolls through week windows across month boundaries without growing the DOM", async () => {
  await planner(async page => {
    await page.evaluate(async () => {
      await window.hcb!.settings.update({ monthScrollFutureMonths: 24 });
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await chooseCalendarView(page, "month"); await date(page);
    const calendar = page.getByTestId("calendar-view"), grid = page.getByRole("grid", { name: "Calendar month view" });
    await expect(calendar).toHaveAttribute("data-range-start", "2026-12-27T00:00:00.000Z");
    await grid.evaluate(el => { el.scrollTop = el.scrollHeight; }); await grid.hover();
    for (let step = 1; step <= 6; step++) {
      await page.mouse.wheel(0, 160);
      const start = new Date(Date.parse("2026-12-27T00:00:00Z") + step * 7 * 86400000).toISOString();
      await expect(calendar).toHaveAttribute("data-range-start", start);
      await expect(grid.getByRole("gridcell")).toHaveCount(42);
      await page.waitForTimeout(140); // Separate intentional wheel gestures from momentum coalescing.
    }
    await page.reload();
    await expect(calendar).toHaveAttribute("data-range-start", "2027-02-07T00:00:00.000Z");
    await grid.evaluate(el => { el.scrollTop = 0; }); await grid.hover(); await page.mouse.wheel(0, -160);
    await expect(calendar).toHaveAttribute("data-range-start", "2027-01-31T00:00:00.000Z");
    await capture(page, "month-continuous-window");
  });
});

test("event context menu supports keyboard dismissal, full-text copy, duplication and deletion through the existing services", async () => {
  await planner(async (page, app) => {
    // Reserve room for both records in the responsive Month grid.
    await page.setViewportSize({ width: 1180, height: 1000 });
    const notes = "Full event notes. ".repeat(500);
    const [id] = await seed(page, [{ title: "Context planning", notes, startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T10:00:00Z" }]);
    await chooseCalendarView(page, "month"); await date(page);
    const chip = page.locator('.calendar-month .calendar-event-chip').filter({ hasText: "Context planning" });
    const menu = page.getByRole("menu", { name: "Calendar item actions" });
    await chip.focus(); await page.keyboard.press("Shift+F10");
    await expect(menu).toBeVisible(); await page.keyboard.press("Escape");
    await expect(menu).toBeHidden(); await expect(chip).toBeFocused();
    await chip.click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Copy text" }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(`Context planning\n\n${notes}`);
    await chip.click({ button: "right" });
    await capture(page, "event-context-menu");
    await menu.getByRole("menuitem", { name: "Duplicate event" }).click();
    await expect(page.getByRole("textbox", { name: "Event title", exact: true })).toHaveValue("Context planning (copy)");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    const duplicate = page.locator('.calendar-month .calendar-event-chip').filter({ hasText: "Context planning (copy)" });
    await expect(duplicate).toBeVisible();
    const copies = await page.evaluate(async () => {
      const result = await window.hcb!.calendar.listEvents({ start: "2027-01-12T00:00:00Z", end: "2027-01-13T00:00:00Z" });
      if (!result.ok) throw new Error(result.error.message);
      return result.data.items.filter((event) => event.title === "Context planning (copy)");
    });
    expect(copies).toHaveLength(1);
    expect((await record(page, copies[0].id)).notes).toBe(notes);
    await duplicate.click({ button: "right" }); await menu.getByRole("menuitem", { name: "Delete event", exact: true }).click();
    await expect(duplicate).toHaveCount(0);
    expect((await record(page, id)).title).toBe("Context planning");
    await page.reload(); await expect(duplicate).toHaveCount(0);
  });
});

test("recurring context deletion reviews supported scopes and duplication creates only the selected occurrence", async () => {
  await planner(async page => {
    const [id] = await seed(page, [{ title: "Context series", startsAt: "2027-01-05T09:00:00Z", endsAt: "2027-01-05T10:00:00Z", recurrenceLines: ["RRULE:FREQ=WEEKLY;COUNT=5"] }]);
    await chooseCalendarView(page, "week"); await date(page);
    const chip = page.locator('.calendar-timeline .calendar-event-chip').filter({ hasText: "Context series" });
    const menu = page.getByRole("menu", { name: "Calendar item actions" });
    await chip.click({ button: "right" }); await menu.getByRole("menuitem", { name: "Duplicate this occurrence" }).click();
    await expect(page.getByRole("textbox", { name: "Event title", exact: true })).toHaveValue("Context series (copy)");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    const original = chip.filter({ hasNotText: "(copy)" });
    await original.click({ button: "right" }); await menu.getByRole("menuitem", { name: "Delete event…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete recurring event" });
    await expect(dialog.getByRole("button", { name: "This and future occurrences" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(original).toBeVisible();
    await original.click({ button: "right" }); await menu.getByRole("menuitem", { name: "Delete event…" }).click();
    await dialog.getByRole("button", { name: "This occurrence", exact: true }).click();
    await expect(original).toHaveCount(0);
    expect((await record(page, id)).startsAt).toBe("2027-01-05T09:00:00Z");
    const events = await page.evaluate(async () => {
      const result = await window.hcb!.calendar.listEvents({ start: "2027-01-01T00:00:00Z", end: "2027-02-15T00:00:00Z" });
      if (!result.ok) throw new Error(result.error.message);
      return result.data.items;
    });
    expect(events.filter(event => event.title === "Context series")).toHaveLength(4);
    const copies = events.filter(event => event.title === "Context series (copy)");
    expect(copies).toHaveLength(1); expect(copies[0].startsAt.slice(0, 10)).toBe("2027-01-12");
  });
});

test("context actions work in Agenda and overflow without leaving a stale overflow dialog", async () => {
  await planner(async page => {
    await seed(page, Array.from({ length: 7 }, (_, i) => ({ title: `Overflow action ${i}`, allDay: true, startsAt: "2027-01-12T00:00:00Z", endsAt: "2027-01-13T00:00:00Z" })));
    await chooseCalendarView(page, "month"); await date(page);
    await page.getByRole("button", { name: /Show .* more calendar items/ }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Close overflow items" }) });
    await dialog.getByRole("button", { name: /Overflow action 6/ }).click({ button: "right" });
    await page.getByRole("menu", { name: "Calendar item actions" }).getByRole("menuitem", { name: "Edit event" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Event title", exact: true })).toHaveValue("Overflow action 6");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await chooseCalendarView(page, "agenda");
    await page.getByRole("listitem").filter({ hasText: "Overflow action 0" }).click({ button: "right" });
    await expect(page.getByRole("menu", { name: "Calendar item actions" })).toBeVisible();
  });
});

test("an edge drag commits in the newly visible week and remains undoable", async () => {
  await planner(async page => {
    const [id] = await seed(page, [{ title: "Across weeks", startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T10:00:00Z" }]);
    await chooseCalendarView(page, "week"); await date(page);
    const chip = page.locator('.calendar-timeline .calendar-event-chip').filter({ hasText: "Across weeks" });
    await chip.scrollIntoViewIfNeeded();
    const a = (await chip.boundingBox())!, viewport = (await page.locator('[data-calendar-timeline-scroll]').boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(viewport.x + viewport.width - 4, a.y + a.height / 2, { steps: 8 });
    await expect(page.locator('[data-calendar-day-events][data-calendar-date="2027-01-18"]')).toHaveCount(1);
    const target = await timelinePoint(page, "2027-01-18", 9 * 60 + 30);
    await page.mouse.move(target.x, target.y, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await record(page, id)).startsAt).toBe("2027-01-18T09:00:00.000Z");
    await page.evaluate(async () => { const result = await window.hcb!.undo.undo(); if (!result.ok) throw new Error(result.error.message); window.dispatchEvent(new Event("hcb:core-data-invalidated")); });
    expect((await record(page, id)).startsAt).toBe("2027-01-12T09:00:00Z");
  });
});

test("context menu stays within a narrow window in both themes and honors reduced motion", async () => {
  await planner(async page => {
    await seed(page, [{ title: "A long calendar title that should remain readable without widening the window", startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T10:00:00Z" }]);
    await chooseCalendarView(page, "month"); await date(page);
    await page.setViewportSize({ width: 850, height: 700 });
    const session = await page.context().newCDPSession(page);
    await session.send("Animation.enable"); await session.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(async theme => { await window.hcb!.settings.update({ theme }); window.dispatchEvent(new Event("hcb:core-data-invalidated")); }, theme);
      const chip = page.locator('.calendar-month .calendar-event-chip').filter({ hasText: "A long calendar title" });
      await chip.hover(); await chip.click({ button: "right" });
      const menu = page.getByRole("menu", { name: "Calendar item actions" });
      await expect(menu).toBeVisible();
      await capture(page, `context-menu-narrow-${theme}-slow-motion`);
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(850); expect(box.y + box.height).toBeLessThanOrEqual(700);
      await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown"); await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
      await page.keyboard.press("Escape"); await expect(chip).toBeFocused();
    }
    await session.send("Animation.setPlaybackRate", { playbackRate: 1 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator('.calendar-month .calendar-event-chip').filter({ hasText: "A long calendar title" }).click({ button: "right" });
    await expect(page.getByRole("menu", { name: "Calendar item actions" })).toHaveCSS("animation-name", "none");
    await session.detach();
  });
});

test("short appointments retain a pointer move target between their resize handles", async () => {
  await planner(async page => {
    const [id] = await seed(page, [{ title: "Short check-in", startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T09:15:00Z" }]);
    await chooseCalendarView(page, "week"); await date(page);
    const chip = page.locator('.calendar-timeline .calendar-event-chip').filter({ hasText: "Short check-in" });
    await dragToTime(page, chip, "2027-01-13", 9 * 60 + 15);
    await expect.poll(async () => (await record(page, id)).startsAt.slice(0, 10)).toBe("2027-01-13");
    const saved = await record(page, id);
    expect(Date.parse(saved.endsAt) - Date.parse(saved.startsAt)).toBe(15 * 60000);
  });
});

test("a gesture can move this and future occurrences while preserving earlier appointments", async () => {
  await planner(async page => {
    await seed(page, [{ title: "Future review", startsAt: "2027-01-05T09:00:00Z", endsAt: "2027-01-05T10:00:00Z", recurrenceLines: ["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=5"] }]);
    await chooseCalendarView(page, "month"); await date(page);
    await drag(page, page.locator('.calendar-month .calendar-event-chip').filter({ hasText: "Future review" }).nth(1), page.locator('[data-calendar-date="2027-01-13"]'));
    await page.getByRole("dialog", { name: "Save recurring event" }).getByRole("button", { name: "This and future occurrences" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.hcb!.calendar.listEvents({ start: "2027-01-01T00:00:00Z", end: "2027-02-15T00:00:00Z" });
      if (!result.ok) throw new Error(result.error.message);
      return result.data.items.filter(event => event.title === "Future review").map(event => event.startsAt.slice(0, 10)).sort();
    })).toEqual(["2027-01-05", "2027-01-13", "2027-01-20", "2027-01-27", "2027-02-03"]);
  });
});

test("a series gesture requiring complex rule review fails visibly without modifying the event", async () => {
  await planner(async page => {
    const [id] = await seed(page, [{ title: "Complex monthly review", startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T10:00:00Z", recurrenceLines: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=12"] }]);
    await chooseCalendarView(page, "month"); await date(page);
    await drag(page, page.locator('.calendar-month .calendar-event-chip').filter({ hasText: "Complex monthly review" }), page.locator('[data-calendar-date="2027-01-13"]'));
    await page.getByRole("dialog", { name: "Save recurring event" }).getByRole("button", { name: "Entire series" }).click();
    await expect(page.getByText("Calendar interaction not saved", { exact: true })).toBeVisible();
    await expect(page.getByText(/This repeat rule needs review before moving the series/)).toBeVisible();
    expect((await record(page, id)).startsAt).toBe("2027-01-12T09:00:00Z");
    expect((await record(page, id)).recurrenceLines).toEqual(["RRULE:FREQ=MONTHLY;BYMONTHDAY=12"]);
  });
});
