const GUEST_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const GOOGLE_TIMED_INSTANCE_SUFFIX = /_\d{8}T\d{6}Z$/;
const GOOGLE_ALL_DAY_INSTANCE_SUFFIX = /_\d{8}$/;
const ATTENDEE_RESPONSE_STATUSES = new Set(["needsAction", "declined", "tentative", "accepted"]);

export interface NormalizedCalendarReminder {
  method: "popup" | "email";
  minutes: number;
}

export interface NormalizedCalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  self?: boolean;
  resource?: boolean;
}

export function isPlausibleGuestEmail(candidate: string): boolean {
  return GUEST_EMAIL_PATTERN.test(candidate.trim());
}

export function normalizeGuestEmails(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values ?? []) {
    const email = value.trim().toLowerCase();

    if (!isPlausibleGuestEmail(email) || seen.has(email)) {
      continue;
    }

    seen.add(email);
    normalized.push(email);
  }

  return normalized;
}

export function normalizeReminderMinutes(values: readonly number[] | undefined): number[] {
  const seen = new Set<number>();
  const normalized: number[] = [];

  for (const value of values ?? []) {
    if (!Number.isInteger(value) || value < 0 || value > 28 * 24 * 60 || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized.sort((left, right) => left - right);
}

export function normalizeCalendarReminders(
  values: readonly NormalizedCalendarReminder[] | undefined
): NormalizedCalendarReminder[] {
  const seen = new Set<string>();
  const normalized: NormalizedCalendarReminder[] = [];

  for (const value of values ?? []) {
    const method = value.method === "email" ? "email" : value.method === "popup" ? "popup" : null;
    const minutes = value.minutes;
    const key = `${method}:${minutes}`;

    if (
      method === null ||
      !Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > 28 * 24 * 60 ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    normalized.push({ method, minutes });
  }

  return normalized.sort((left, right) => left.minutes - right.minutes || left.method.localeCompare(right.method));
}

export function normalizeCalendarAttendees(
  values: readonly NormalizedCalendarAttendee[] | undefined
): NormalizedCalendarAttendee[] {
  const seen = new Set<string>();
  const normalized: NormalizedCalendarAttendee[] = [];

  for (const value of values ?? []) {
    const email = value.email.trim().toLowerCase();

    if (!isPlausibleGuestEmail(email) || seen.has(email)) {
      continue;
    }

    seen.add(email);
    normalized.push({
      email,
      ...(value.displayName?.trim() ? { displayName: value.displayName.trim().slice(0, 500) } : {}),
      ...(value.responseStatus && ATTENDEE_RESPONSE_STATUSES.has(value.responseStatus)
        ? { responseStatus: value.responseStatus }
        : {}),
      ...(value.self === undefined ? {} : { self: value.self }),
      ...(value.resource === undefined ? {} : { resource: value.resource })
    });
  }

  return normalized;
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function startOfUtcDayIso(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;

  return startOfUtcDay(date).toISOString();
}

export function addUtcDays(value: string | Date, days: number): Date {
  const date = typeof value === "string" ? new Date(value) : new Date(value.getTime());

  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function addUtcDaysIso(value: string | Date, days: number): string {
  return addUtcDays(value, days).toISOString();
}

export function dateInputValue(value: string): string {
  const parsed = new Date(value);

  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

export function dateTimeLocalInputValue(value: string): string {
  const parsed = new Date(value);

  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 16);
}

export function dateInputToIso(value: string): string {
  return `${value}T00:00:00.000Z`;
}

export function dateTimeLocalInputToIso(value: string): string {
  const parsed = new Date(`${value}:00.000Z`);

  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

export function isGoogleCalendarEventInstanceId(id: string): boolean {
  return GOOGLE_TIMED_INSTANCE_SUFFIX.test(id) || GOOGLE_ALL_DAY_INSTANCE_SUFFIX.test(id);
}

export function googleCalendarSeriesId(id: string): string {
  if (!isGoogleCalendarEventInstanceId(id)) {
    return id;
  }

  return id.replace(GOOGLE_TIMED_INSTANCE_SUFFIX, "").replace(GOOGLE_ALL_DAY_INSTANCE_SUFFIX, "");
}
