import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("http://127.0.0.1:4174");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.hcb))).toBe(true);
}
async function call(page: Page, domain: string, action: string, payload: any = {}) {
  return page.evaluate(async ({domain, action, payload}) => {
    const result = await (window.hcb as any)[domain][action](payload);
    if (!result.ok) throw new Error(`${domain}.${action}: ${result.error.message}`);
    return result.data;
  }, {domain, action, payload});
}
async function reopen(page: Page) {
  await page.reload();
  await expect(page.getByTestId("app-shell")).toBeVisible();
}

test("the shipped SQLite WASM passes SQL compatibility in its worker", async ({page}) => {
  await ready(page);
  const report = await call(page, "__testing", "compatibility");
  expect(report.checks).toEqual(expect.arrayContaining([
    "FTS5 and triggers", "positional and named SQL bindings", "foreign keys enforced", "JSON expressions",
    "nested transactions/savepoints", "outer transaction rollback", "statement cleanup and reuse",
    "explicit statement finalization", "export/reopen preserves FTS5", "reopened database remains writable",
    "current workspace reopens without snapshot churn", "domain full-text search after snapshot reopen"
  ]));
  await test.info().attach("sqlite-compatibility", {body: JSON.stringify(report, null, 2), contentType: "application/json"});
});

test("local onboarding and task, note, event, settings, lists, subtasks, tags and FTS survive reopening", async ({page}) => {
  await ready(page);
  const dialog = page.getByRole("dialog", {name: "Hot Cross Buns", exact: true});
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", {name: "Get started", exact: true}).click();
  for (let i = 0; i < 3; i++) await dialog.getByRole("button", {name: "Continue", exact: true}).click();
  await dialog.getByRole("button", {name: "Finish setup", exact: true}).click();
  await expect(dialog).toBeHidden();
  const list = await call(page, "tasks", "createTaskList", {title: "Browser projects"});
  const noteList = await call(page, "notes", "createNoteList", {title: "Browser research"});
  const task = await call(page, "tasks", "create", {listId: list.id, title: "Marmalade durable task", tags: ["browser"]});
  const child = await call(page, "tasks", "create", {listId: list.id, parentId: task.id, title: "Marmalade subtask"});
  const note = await call(page, "notes", "create", {listId: noteList.id, title: "Marmalade durable note", body: "Full text persistence evidence"});
  const event = await call(page, "calendar", "create", {calendarId: "primary", title: "Marmalade durable event", startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T10:00:00Z", recurrenceLines: ["RRULE:FREQ=WEEKLY;COUNT=3"]});
  await call(page, "tasks", "update", {id: task.id, title: "Marmalade edited task"});
  await call(page, "notes", "update", {id: note.id, body: "Edited full text kumquat"});
  await call(page, "calendar", "update", {id: event.id, title: "Marmalade edited event", scope: "series"});
  await call(page, "settings", "update", {defaultTimeZone: "Asia/Singapore", theme: "dark"});
  await reopen(page);
  expect(await call(page, "tasks", "get", {id: task.id})).toMatchObject({title: "Marmalade edited task", listId: list.id, tags: ["browser"]});
  expect(await call(page, "tasks", "get", {id: child.id})).toMatchObject({parentId: task.id});
  expect(await call(page, "notes", "get", {id: note.id})).toMatchObject({body: "Edited full text kumquat", listId: noteList.id});
  expect(await call(page, "calendar", "get", {id: event.id})).toMatchObject({title: "Marmalade edited event"});
  expect(await call(page, "settings", "get")).toMatchObject({onboardingStatus: "completed", defaultTimeZone: "Asia/Singapore", theme: "dark"});
  const search = await call(page, "search", "query", {query: "kumquat"});
  expect(search.items.map((item: any) => item.id)).toContain(note.id);
  const events = await call(page, "calendar", "listEvents", {start: "2027-01-01T00:00:00Z", end: "2027-02-01T00:00:00Z"});
  expect(events.items.filter((item: any) => item.title === "Marmalade edited event")).toHaveLength(3);
  const metrics = await call(page, "diagnostics", "storage");
  await test.info().attach("storage-cost", {body: JSON.stringify(metrics, null, 2), contentType: "application/json"});
});

test("completion, undo, redo and scheduled task blocks persist as one domain operation", async ({page}) => {
  await ready(page);
  const task = await call(page, "tasks", "create", {listId: "inbox", title: "Scheduled durable task"});
  const block = await call(page, "calendar", "scheduleTaskBlock", {taskId: task.id, calendarId: "primary", startsAt: "2027-01-12T09:00:00Z", durationMinutes: 45});
  await call(page, "tasks", "complete", {id: task.id});
  await reopen(page);
  expect(await call(page, "tasks", "get", {id: task.id})).toMatchObject({status: "completed"});
  expect(await call(page, "calendar", "get", {id: block.calendarEventId})).toMatchObject({scheduledTaskId: task.id, completed: true});
  await call(page, "undo", "undo");
  expect(await call(page, "tasks", "get", {id: task.id})).toMatchObject({status: "active"});
  await reopen(page);
  await call(page, "undo", "redo");
  expect(await call(page, "tasks", "get", {id: task.id})).toMatchObject({status: "completed"});
});

test("failed durable commit restores memory, associated records, undo and the previous IndexedDB snapshot", async ({page}) => {
  await ready(page);
  const task = await call(page, "tasks", "create", {listId: "inbox", title: "Previous durable title"});
  const undoBefore = await call(page, "undo", "status");
  await call(page, "__testing", "failNextPersistence");
  const failed = await page.evaluate(id => window.hcb!.tasks.update({id, title: "Must never be acknowledged"}), task.id);
  expect(failed.ok).toBe(false);
  expect(await call(page, "tasks", "get", {id: task.id})).toMatchObject({title: "Previous durable title"});
  expect(await call(page, "undo", "status")).toEqual(undoBefore);
  await reopen(page);
  expect(await call(page, "tasks", "get", {id: task.id})).toMatchObject({title: "Previous durable title"});
  await call(page, "__testing", "failNextPersistence");
  const failedBlock = await page.evaluate(id => window.hcb!.calendar.scheduleTaskBlock({taskId: id, calendarId: "primary", startsAt: "2027-01-12T09:00:00Z", durationMinutes: 45}), task.id);
  expect(failedBlock.ok).toBe(false);
  expect((await call(page, "calendar", "listEvents", {start: "2027-01-01T00:00:00Z", end: "2027-02-01T00:00:00Z"})).items).toHaveLength(0);
  expect(await call(page, "undo", "status")).toEqual(undoBefore);
  await reopen(page);
  expect((await call(page, "calendar", "listEvents", {start: "2027-01-01T00:00:00Z", end: "2027-02-01T00:00:00Z"})).items).toHaveLength(0);
  // A replaced connection must leave the prepared-statement cache usable.
  await call(page, "tasks", "update", {id: task.id, title: "Subsequent durable change"});
  await reopen(page);
  expect(await call(page, "tasks", "get", {id: task.id})).toMatchObject({title: "Subsequent durable change"});
});

test("separate browser contexts have independent durable workspaces", async ({browser}) => {
  const a = await browser.newContext(), b = await browser.newContext();
  try {
    const first = await a.newPage(), second = await b.newPage();
    await ready(first); await ready(second);
    await call(first, "tasks", "create", {listId: "inbox", title: "Context isolation sentinel"});
    await reopen(first); await reopen(second);
    expect((await call(first, "search", "query", {query: "sentinel"})).items).toHaveLength(1);
    expect((await call(second, "search", "query", {query: "sentinel"})).items).toHaveLength(0);
  } finally { await a.close(); await b.close(); }
});

test("two tabs serialize writes without replacing newer durable snapshots", async ({context, page}) => {
  await ready(page);
  const second = await context.newPage();
  await ready(second);
  await Promise.all([
    call(page, "tasks", "create", {listId: "inbox", title: "Concurrent first sentinel"}),
    call(second, "tasks", "create", {listId: "inbox", title: "Concurrent second sentinel"})
  ]);
  await reopen(page); await reopen(second);
  for (const tab of [page, second]) expect((await call(tab, "search", "query", {query: "sentinel"})).items).toHaveLength(2);
});

test("unavailable Google operations report actionable errors without connecting or interrupting durable local work", async ({page}) => {
  await ready(page);
  const status = await call(page, "google", "status");
  expect(status.available).toBe(false);
  expect(status.accounts).toEqual([]);
  expect(status.account).toBeNull();
  for (const [namespace, action, payload] of [
    ["google", "beginOAuth", {}],
    ["google", "saveOAuthClient", {clientId: "browser-test.apps.googleusercontent.com"}],
    ["sync", "runNow", {}]
  ] as const) {
    const result = await page.evaluate(({namespace, action, payload}) => (window.hcb as any)[namespace][action](payload), {namespace, action, payload});
    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/not available.*browser/i);
    expect(result.error.message).toMatch(/local/i);
  }
  const task = await call(page, "tasks", "create", {listId: "inbox", title: "Google-free durable work"});
  await reopen(page);
  expect(await call(page, "tasks", "get", {id: task.id})).toMatchObject({title: "Google-free durable work"});
  expect(await call(page, "google", "status")).toMatchObject({available: false, accounts: [], account: null});
});
