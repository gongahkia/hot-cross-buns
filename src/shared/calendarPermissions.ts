/** CalendarList.accessRole belongs to the signed-in account, not the organizer. */
export function calendarCanWrite(calendar: { accountId?: string; accessRole?: string | null }): boolean {
  return calendar.accountId === "local" || ["owner", "writer", "writerWithoutPrivateAccess"].includes(calendar.accessRole ?? "");
}

export function calendarWriteRestriction(calendar: { accessRole?: string | null }): string {
  return calendar.accessRole
    ? "This calendar is read-only. Choose a writable calendar to create or copy an event."
    : "Calendar permissions have not loaded. Sync to check access before editing.";
}
