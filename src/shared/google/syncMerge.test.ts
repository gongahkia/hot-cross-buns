import { describe, expect, it } from "vitest";
import { withHcbTaskMetadata } from "../core/hcbTaskMetadata";
import {
  changedSyncFields, googleBodyFromSyncFields, googlePatchFromSyncFields, googleSyncFields,
  mergeGoogleVersions, mergeSyncFields, syncValuesEqual, type GoogleSyncBaseline
} from "./syncMerge";

const event = {
  summary: "Draft", start: { dateTime: "2026-10-29T09:00:00+08:00", timeZone: "Asia/Singapore" },
  end: { dateTime: "2026-10-29T10:00:00+08:00", timeZone: "Asia/Singapore" }
};
const baseline = (overrides: Partial<GoogleSyncBaseline> = {}): GoogleSyncBaseline => ({
  remoteId: "remote", collectionId: "primary", etag: "v1", fields: googleSyncFields("event", event),
  deleted: false, recurring: false, ...overrides
});

describe("three-way Google merging", () => {
  it("combines independent changes and sends only the outstanding local field", () => {
    const base = googleSyncFields("event", event);
    const local = { ...base, description: "Local details" };
    const remote = { ...base, summary: "Phone title" };
    const merged = mergeSyncFields(base, local, remote);
    expect(merged.conflicts).toEqual([]);
    expect(merged.fields).toMatchObject({ summary: "Phone title", description: "Local details" });
    expect(googlePatchFromSyncFields("event", remote, merged.fields)).toEqual({ description: "Local details" });
  });

  it("keeps overlapping values for review without losing either input", () => {
    const base = { title: "Draft", notes: "" }, local = { ...base, title: "Local" }, remote = { ...base, title: "Phone" };
    const result = mergeSyncFields(base, local, remote);
    expect(result.conflicts).toEqual(["title"]);
    expect(result.fields.title).toBe("Local");
    expect(remote.title).toBe("Phone");
    expect(base.title).toBe("Draft");
  });

  it("recognizes identical edits as convergence and emits no patch", () => {
    const base = googleSyncFields("taskList", { title: "Before" });
    const result = mergeSyncFields(base, { title: "After" }, { title: "After" });
    expect(result.conflicts).toEqual([]);
    expect(googlePatchFromSyncFields("taskList", { title: "After" }, result.fields)).toEqual({});
  });

  it("merges user notes independently from HCB task planning metadata", () => {
    const baseBody = { title: "Task", notes: withHcbTaskMetadata("Notes", { priority: "low" }) };
    const base = googleSyncFields("task", baseBody);
    const local = googleSyncFields("task", { ...baseBody, notes: withHcbTaskMetadata("Notes", { priority: "high" }) });
    const remote = googleSyncFields("task", { ...baseBody, notes: withHcbTaskMetadata("Phone notes", { priority: "low" }) });
    const result = mergeSyncFields(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(googlePatchFromSyncFields("task", remote, result.fields)).toEqual({
      notes: withHcbTaskMetadata("Phone notes", { priority: "high" })
    });
  });

  it("treats a removed task metadata footer as clearing its values", () => {
    const base = googleSyncFields("task", { notes: withHcbTaskMetadata("Notes", { priority: "high", tags: ["work"] }) });
    const remote = googleSyncFields("task", { notes: "Notes" });
    expect(changedSyncFields(base, remote)).toEqual(["priority", "tags"]);
    expect(mergeSyncFields(base, { ...base, title: "Local title" }, remote).fields).toMatchObject({
      priority: "none", tags: [], title: "Local title"
    });
  });

  it("compares Task due dates as dates, not timestamp formatting", () => {
    expect(googleSyncFields("task", { due: "2026-10-29" }).due).toBe("2026-10-29");
    expect(googlePatchFromSyncFields("task", googleSyncFields("task", { due: "2026-10-29T00:00:00Z" }),
      googleSyncFields("task", { due: "2026-10-29" }))).toEqual({});
  });

  it("clears optional Task dates with null", () => {
    expect(googlePatchFromSyncFields("task", googleSyncFields("task", { due: "2026-10-29" }),
      googleSyncFields("task", {}))).toEqual({ due: null });
  });

  it("groups both Calendar boundaries to prevent an invalid mixed interval", () => {
    const base = googleSyncFields("event", event);
    const local = googleSyncFields("event", { ...event, start: { ...event.start, dateTime: "2026-10-29T08:00:00+08:00" } });
    const remote = googleSyncFields("event", { ...event, end: { ...event.end, dateTime: "2026-10-29T11:00:00+08:00" } });
    expect(mergeSyncFields(base, local, remote).conflicts).toEqual(["time"]);
    expect(Object.keys(googlePatchFromSyncFields("event", base, local)).sort()).toEqual(["end", "start"]);
  });

  it("normalizes equivalent instants while preserving all-day and timezone distinctions", () => {
    const base = googleSyncFields("event", event);
    expect(googleSyncFields("event", { ...event, start: { ...event.start, dateTime: "2026-10-29T01:00:00.000Z" } })).toEqual(base);
    expect(googleSyncFields("event", { ...event, start: { date: "2026-10-29" } })).not.toEqual(base);
    expect(googleSyncFields("event", { ...event, start: { ...event.start, timeZone: "UTC" } })).not.toEqual(base);
  });

  it("treats reminders and attendee arrays as complete values", () => {
    const base = googleSyncFields("event", { ...event, attendees: [{ email: "a@example.com" }] });
    const local = { ...base, attendees: [{ email: "a@example.com" }, { email: "b@example.com" }] };
    const remote = { ...base, attendees: [{ email: "a@example.com", responseStatus: "accepted" }] };
    expect(mergeSyncFields(base, local, remote).conflicts).toEqual(["attendees"]);
    const reminders = { ...base, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] } };
    expect(googlePatchFromSyncFields("event", base, reminders)).toEqual({ reminders: reminders.reminders });
  });

  it("emits explicit Calendar clears without overwriting other fields", () => {
    const base = googleSyncFields("event", { ...event, location: "Office", colorId: "3", attendees: [{ email: "a@example.com" }] });
    expect(googlePatchFromSyncFields("event", base, googleSyncFields("event", event))).toEqual({
      attendees: [], colorId: null, location: ""
    });
  });

  it("preserves unmanaged attachments and ignores provider-only attachment properties", () => {
    const base = googleSyncFields("event", { ...event, attachments: [{ fileUrl: "https://example.com/file", fileId: "id", iconLink: "icon" }] });
    expect(googleSyncFields("event", event, base).attachments).toEqual(base.attachments);
    expect(googleSyncFields("event", { ...event, attachments: [{ fileUrl: "https://example.com/file", title: "https://example.com/file" }] })).toEqual(base);
    expect(googlePatchFromSyncFields("event", base, googleSyncFields("event", { ...event, attachments: [] }))).toEqual({ attachments: [] });
  });

  it.each([
    ["deletion", { deleted: true }], ["location", { collectionId: "other" }],
    ["location", { remoteId: "other" }], ["structure", { structure: { parent: "other" } }],
    ["recurrence", { recurring: true, etag: "v2" }]
  ] as const)("keeps %s changes for explicit review", (reason, change) => {
    const base = baseline();
    expect(mergeGoogleVersions(base, { ...base.fields, summary: "Local" }, baseline(change)).conflicts).toContain(reason);
  });

  it("does not reject an unchanged remote recurring series", () => {
    const base = baseline({ recurring: true });
    expect(mergeGoogleVersions(base, { ...base.fields, summary: "Local" }, base).conflicts).toEqual([]);
  });

  it("ignores object key order without ignoring array order", () => {
    expect(syncValuesEqual({ a: 1, b: { c: null } }, { b: { c: null }, a: 1 })).toBe(true);
    expect(syncValuesEqual([1, 2], [2, 1])).toBe(false);
    expect(syncValuesEqual({}, { a: null })).toBe(false);
    expect(syncValuesEqual({ a: 1 }, null)).toBe(false);
  });

  it("preserves unknown attendee properties when another field changes", () => {
    const fields = googleSyncFields("event", { ...event, attendees: [{ email: "a@example.com", additionalGuests: 3, resource: true }] });
    expect(googleBodyFromSyncFields("event", fields).attendees).toEqual([{ email: "a@example.com", additionalGuests: 3, resource: true }]);
    expect(googlePatchFromSyncFields("event", fields, { ...fields, summary: "New" })).toEqual({ summary: "New" });
  });
});
