import { expect, test, type Locator, type Page } from "@playwright/test";
import { planner, capture } from "./planner";
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
  await from.scrollIntoViewIfNeeded();
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
  await from.scrollIntoViewIfNeeded();
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
