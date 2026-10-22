import { expect, type Page } from "@playwright/test";

export const populatedDay = "2026-10-22";
export const populatedNow = `${populatedDay}T15:49:00Z`;

/** Real IPC writes into planner()'s disposable local account, never a Google account. */
export async function seedPopulatedPlanner(page: Page) {
  await page.clock.setFixedTime(new Date(populatedNow));
  return page.evaluate(async (anchor) => {
    const api = window.hcb!;
    const unwrap = (result: any): any => { if (!result.ok) throw new Error(result.error.message); return result.data; };
    const stamp = (offset: number, minutes = 0) => new Date(Date.parse(`${anchor}T00:00:00Z`) + offset * 86400000 + minutes * 60000).toISOString();
    const counts = { events: 0, birthdays: 0, tasks: 0, notes: 0, taskLists: 6 };
    const ids = { event: "", birthday: "", task: "", note: "", completedEvent: "" };
    const meetings = [
      { title: "Team standup", start: 540, duration: 30, color: "11" },
      { title: "Architecture review", start: 600, duration: 90, color: "7" },
      { title: "Lunch with Sarah", start: 750, duration: 60, color: "3" },
      { title: "Design critique — accessibility, keyboard navigation and launch readiness", start: 840, duration: 90, color: "5" },
      { title: "Gym", start: 1080, duration: 90, color: "10" }
    ];
    for (let day = -35; day < 55; day++) {
      for (const [index, meeting] of meetings.entries()) {
        const event = unwrap(await api.calendar.create({ calendarId: "primary", title: day === 0 && index === 1 ? "Beacon architecture review" : meeting.title, startsAt: stamp(day, meeting.start), endsAt: stamp(day, meeting.start + meeting.duration), allDay: false, colorId: meeting.color, notes: "Decisions, agenda and follow-ups for the launch.\n".repeat(5) }));
        counts.events++;
        if (day === 0 && index === 1) ids.event = event.id;
        if (day <= 0 && index === 0) { unwrap(await api.calendar.complete({ id: event.id, scope: "occurrence" })); if (day === 0) ids.completedEvent = event.id; }
      }
      if (day % 3 === 0) {
        unwrap(await api.calendar.create({ calendarId: "primary", title: "Recruiter call (overlapping)", startsAt: stamp(day, 630), endsAt: stamp(day, 645), allDay: false, colorId: "6" })); counts.events++;
      }
      if (day % 7 === 0) {
        unwrap(await api.calendar.create({ calendarId: "primary", title: "Weekend in Hudson Valley", startsAt: stamp(day), endsAt: stamp(day + 3), allDay: true, colorId: "6", location: "Hudson, NY" })); counts.events++;
      }
    }
    for (let index = 0; index < 24; index++) {
      const birthday = unwrap(await api.calendar.create({ calendarId: "primary", title: index === 0 ? "Avery's birthday" : `${["Jordan", "Sam", "Morgan", "Riley"][index % 4]}'s birthday ${index}`, startsAt: stamp(index * 3), endsAt: stamp(index * 3 + 1), allDay: true, hcbKind: "birthday", colorId: "3", recurrence: { frequency: "yearly", interval: 1 } }));
      counts.birthdays++; if (index === 0) ids.birthday = birthday.id;
    }
    const listNames = ["Inbox", "Work", "Personal", "Family", "Side projects", "Travel"];
    const sorts: Record<string, string> = {};
    for (const [listIndex, title] of listNames.entries()) {
      const listId = listIndex === 0 ? "inbox" : unwrap(await api.tasks.createTaskList({ title })).id;
      sorts[listId] = "title";
      let parentId = "";
      for (let index = 0; index < 100; index++) {
        const task = unwrap(await api.tasks.create({ listId, title: listIndex === 0 && index === 0 ? "Beacon launch checklist" : `${title} ${String(index).padStart(3, "0")} — ${["Review proposal", "Plan next sprint", "Book appointment", "Follow up with team"][index % 4]}`, notes: "Acceptance criteria and next steps.\n".repeat(index % 9 === 0 ? 60 : 2), dueDate: index % 10 === 1 ? stamp((index + listIndex * 7) % 90 - 35).slice(0, 10) : null, priority: ["none", "low", "medium", "high"][index % 4], ...(index > 0 && index < 4 ? { parentId } : {}) }));
        if (index === 0) parentId = task.id;
        if (index % 5 === 4) unwrap(await api.tasks.complete({ id: task.id }));
        counts.tasks++; if (listIndex === 0 && index === 0) ids.task = task.id;
      }
    }
    for (let index = 0; index < 240; index++) {
      const note = unwrap(await api.notes.create({ title: index === 0 ? "Beacon launch brief" : `${["Meeting notes", "Project journal", "Travel plans", "Reading list"][index % 4]} ${String(index).padStart(3, "0")}`, body: `# Launch notes\n\n## Decisions\n\n- [ ] Confirm owners\n- [x] Review timeline\n\n${"Write clearly, make time for reviews, and keep the next step visible.\n\n".repeat(index % 8 === 0 ? 160 : 8)}` }));
      counts.notes++; if (index === 0) ids.note = note.id;
    }
    unwrap(await api.settings.update({ taskListSorts: sorts }));
    // Assert the real store received every mixed entity (not just an in-memory mock).
    const tasks = unwrap(await api.tasks.list({ status: "all", limit: 1000 }));
    const notes = unwrap(await api.notes.list({ limit: 1000 }));
    const events = unwrap(await api.calendar.listEvents({ start: stamp(-36), end: stamp(80), limit: 1000 }));
    if (tasks.items.length !== counts.tasks || notes.items.length !== counts.notes || events.items.length !== counts.events + counts.birthdays) throw new Error(`Incomplete fixture: ${JSON.stringify({ counts, tasks: tasks.items.length, notes: notes.items.length, events: events.items.length })}`);
    window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    return { counts, ids };
  }, populatedDay);
}

export async function goToPopulatedDay(page: Page) {
  await page.getByRole("button", { name: "Choose calendar date" }).click();
  await page.getByRole("textbox", { name: "Go to date", exact: true }).fill(populatedDay);
  await page.keyboard.press("Tab"); await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Choose calendar date" })).toContainText("October 2026");
}
