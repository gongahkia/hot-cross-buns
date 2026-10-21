import { addDays, addMinutes, format, startOfDay, startOfWeek } from "date-fns";
import type { CalendarEvent } from "./vendor/components/calendar-types";

export type Section = "calendar" | "tasks" | "notes" | "settings";
export type Selection = { kind: "event" | "task" | "note"; id: string } | null;
export type Task = {
  id: string; title: string; list: string; minutes: number; priority: "High" | "Medium" | "Low";
  due: string; notes: string; completed?: boolean; parentId?: string; tags: string[];
};
export type Note = { id: string; title: string; body: string; list: string; tags: string[]; updated: string };
export type PlanEvent = CalendarEvent & { taskId?: string; guests?: string[]; meeting?: string };
export type Proposal = { taskId: string; start: Date; end: Date };
export const calendars = [
  { id: "work", name: "Work", color: "blue", css: "#32a5e5" },
  { id: "personal", name: "Personal", color: "orange", css: "#fe7132" },
  { id: "focus", name: "Task blocks", color: "purple", css: "#9950ff" }
] as const;
export const lists = ["Inbox", "Product launch", "Personal"];
export const TODAY = startOfDay(new Date());
export const WEEK = startOfWeek(TODAY, { weekStartsOn: 1 });
export const dayKey = (date: Date) => format(date, "yyyy-MM-dd");
export const timeLabel = (date: Date) => format(date, "h:mm a").replace(":00", "");
export const dateTimeValue = (date: Date) => format(date, "yyyy-MM-dd'T'HH:mm");
export const initialTasks: Task[] = [
  { id: "launch", title: "Shape the launch story", list: "Product launch", minutes: 60, priority: "High", due: dayKey(TODAY), tags: ["Launch", "Deep work"], notes: "## A clear story\n\nMake the first five minutes feel effortless.\n\n- [ ] Refine the opening\n- [ ] Add the customer example\n- [ ] Share a draft with the team\n\nKeep the [launch brief](https://example.com) close by." },
  { id: "research", title: "Pull together customer feedback", list: "Product launch", minutes: 30, priority: "Medium", due: dayKey(TODAY), tags: ["Research"], notes: "Look for the three most consistent themes across the interviews." },
  { id: "copy", title: "Tighten the landing page copy", list: "Product launch", minutes: 45, priority: "Medium", due: dayKey(addDays(TODAY, 1)), tags: ["Launch"], notes: "Lead with the outcome. Keep the first paragraph short.", parentId: "launch" },
  { id: "review", title: "Review the weekly priorities", list: "Inbox", minutes: 30, priority: "High", due: dayKey(TODAY), tags: ["Planning"], notes: "What deserves a place on the calendar this week?" },
  { id: "expenses", title: "Send October expenses", list: "Inbox", minutes: 15, priority: "Low", due: dayKey(addDays(TODAY, 2)), tags: ["Admin"], notes: "Receipts are in the finance folder." },
  { id: "read", title: "Read a chapter, away from the screen", list: "Personal", minutes: 30, priority: "Low", due: "", tags: ["Personal"], notes: "A little room to think." },
  { id: "walk", title: "Take a walk before the first meeting", list: "Personal", minutes: 30, priority: "Low", due: dayKey(TODAY), tags: [], notes: "", completed: true },
  { id: "inbox", title: "Clear the capture inbox", list: "Inbox", minutes: 15, priority: "Low", due: dayKey(TODAY), tags: ["Admin"], notes: "", completed: true }
];
export const initialNotes: Note[] = [
  { id: "weekly", title: "A little space to plan", list: "Journal", tags: ["Planning"], updated: "Today", body: "# A little space to plan\n\nGood weeks start with a little room to think. These are the things I want to make space for.\n\n## This week's focus\n\n- **Finish the launch story.** Make the product feel simple, useful, and human.\n- Make time for the customer conversations.\n- Leave a little breathing room between meetings.\n\n> Put the important work on the calendar before the week fills up.\n\n## Before Friday\n\n- [x] Review the weekly priorities\n- [ ] Share the launch draft\n- [ ] Write down what we learned\n\n## Working notes\n\n| Focus | Next step |\n| --- | --- |\n| Product launch | Sharpen the story |\n| Customer research | Find the common threads |\n\n---\n\nSmall steps, a clear head, a good week." },
  { id: "brief", title: "Product launch · the brief", list: "Projects", tags: ["Launch"], updated: "Yesterday", body: "# Product launch\n\n## The idea\n\nA calmer way to bring tasks, time, and thinking together.\n\n## Success looks like\n\n1. A clear first impression\n2. Useful defaults\n3. Less time moving between tools\n\n## Questions for the team\n\n- What can we simplify?\n- Where does the story need a real example?" },
  { id: "research-notes", title: "Conversations worth remembering", list: "Projects", tags: ["Research"], updated: "Monday", body: "# Conversations worth remembering\n\nThree themes from this week's interviews:\n\n- People want to **see the whole day**, not just their meetings.\n- Planning needs to feel lighter than doing the work.\n- Context belongs next to the task.\n\n## Next conversation\n\nAsk what a good Friday feels like." }
];

function at(day: number, hour: number, minute = 0): Date {
  const result = addDays(WEEK, day); result.setHours(hour, minute, 0, 0); return result;
}
export function seedEvents(): PlanEvent[] {
  const records: PlanEvent[] = [];
  for (let week = -1; week <= 1; week++) {
    for (let day = 0; day < 5; day++) records.push({ id: `standup-${week}-${day}`, title: "Team standup", start: at(week * 7 + day, 9, 30), end: at(week * 7 + day, 10), calendarId: "work", color: "blue", recurrence: "Every weekday", guests: ["Alex Morgan", "Jamie Chen", "Sam Rivera"], description: "A quick check-in. What's moving, what's blocked, and where can we help?", meeting: "meet.example.test/team" });
    for (const [day, title, hour, minute, duration, color, calendarId] of [
      [0, "A slow start, a clear plan", 10, 30, 60, "purple", "focus"],
      [0, "Coffee with Jamie", 14, 0, 45, "orange", "personal"],
      [1, "Customer conversations", 11, 0, 60, "green", "work"],
      [1, "Make something good", 14, 0, 90, "purple", "focus"],
      [2, "Design review", 13, 30, 60, "blue", "work"],
      [2, "Launch check-in", 14, 0, 30, "green", "work"],
      [2, "A little room to think", 15, 30, 60, "purple", "focus"],
      [3, "Customer conversations", 10, 30, 60, "green", "work"],
      [3, "Lunch with a friend", 12, 30, 60, "orange", "personal"],
      [3, "Write, then refine", 15, 0, 90, "purple", "focus"],
      [4, "Friday wrap-up", 11, 0, 45, "blue", "work"],
      [4, "An early finish", 15, 0, 60, "orange", "personal"]
    ] as const) {
      const start = at(week * 7 + day, hour, minute);
      records.push({ id: `${title}-${week}`, title, start, end: addMinutes(start, duration), calendarId, color, description: title === "Design review" ? "## Make the important things clear\n\nReview the next iteration together.\n\n- Walk through the happy path\n- Look at the small details\n- Agree on the next step" : "A little time set aside for the things that matter.", guests: calendarId === "work" ? ["Alex Morgan", "Jamie Chen"] : [], meeting: calendarId === "work" ? "meet.example.test/design-review" : undefined, location: calendarId === "personal" ? "Out and about" : "Studio / online" });
    }
  }
  records.push({ id: "launch-week", title: "Launch week", start: at(0, 0), end: at(4, 0), isAllDay: true, calendarId: "work", color: "yellow", description: "Make something worth sharing." });
  return records;
}

/** Demo-only planner over the sample events, with a lunch break and 15-minute slots. */
export function suggestSlots(tasks: Task[], events: PlanEvent[], date: Date): Proposal[] {
  const occupied = events.filter(e => !e.isAllDay).map(e => [e.start.getTime(), e.end.getTime()]);
  const result: Proposal[] = [];
  for (const task of tasks.filter(t => !t.completed && !events.some(e => e.taskId === t.id)).slice(0, 3)) {
    for (let minute = 9 * 60; minute + task.minutes <= 17 * 60; minute += 15) {
      if (minute < 13 * 60 && minute + task.minutes > 12 * 60) continue;
      const start = startOfDay(date); start.setMinutes(minute);
      const end = addMinutes(start, task.minutes);
      if (occupied.some(([a, b]) => start.getTime() < b && end.getTime() > a)) continue;
      occupied.push([start.getTime(), end.getTime()]); result.push({ taskId: task.id, start, end }); break;
    }
  }
  return result;
}
