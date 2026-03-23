import { describe, expect, it } from 'vitest';
import { parseTaskInput, extractTags, extractPriority, extractDuration, extractDates } from '$lib/services/nlp-parse';

// fixed ref date: 2026-03-24 (tuesday)
const REF = new Date(2026, 2, 24); // month is 0-indexed

describe('parseTaskInput', () => {
  // -- basic title -----------------------------------------------------------
  it('plain title only', () => {
    const r = parseTaskInput('Buy milk', REF);
    expect(r.title).toBe('Buy milk');
    expect(r.tags).toEqual([]);
    expect(r.dueDate).toBeUndefined();
    expect(r.priority).toBeUndefined();
    expect(r.estimatedMinutes).toBeUndefined();
  });

  // -- dates -----------------------------------------------------------------
  it('tomorrow', () => {
    const r = parseTaskInput('Buy milk tomorrow', REF);
    expect(r.title).toBe('Buy milk');
    expect(r.dueDate).toBe('2026-03-25');
  });

  it('tmr shorthand', () => {
    const r = parseTaskInput('Buy milk tmr', REF);
    expect(r.title).toBe('Buy milk');
    expect(r.dueDate).toBe('2026-03-25');
  });

  it('tmrw shorthand', () => {
    const r = parseTaskInput('Buy milk tmrw', REF);
    expect(r.title).toBe('Buy milk');
    expect(r.dueDate).toBe('2026-03-25');
  });

  it('today', () => {
    const r = parseTaskInput('Do laundry today', REF);
    expect(r.title).toBe('Do laundry');
    expect(r.dueDate).toBe('2026-03-24');
  });

  it('yesterday', () => {
    const r = parseTaskInput('Missed call yesterday', REF);
    expect(r.title).toBe('Missed call');
    expect(r.dueDate).toBe('2026-03-23');
  });

  it('weekday name (next occurrence)', () => {
    // ref is tuesday, so friday = +3 days
    const r = parseTaskInput('Submit report friday', REF);
    expect(r.title).toBe('Submit report');
    expect(r.dueDate).toBe('2026-03-27');
  });

  it('next monday', () => {
    // ref is tuesday, next monday = +6 days
    const r = parseTaskInput('Standup next monday', REF);
    expect(r.title).toBe('Standup');
    expect(r.dueDate).toBe('2026-03-30');
  });

  it('next week', () => {
    const r = parseTaskInput('Plan next week', REF);
    expect(r.title).toBe('Plan');
    expect(r.dueDate).toBe('2026-03-30'); // next monday
  });

  it('next month', () => {
    const r = parseTaskInput('Review next month', REF);
    expect(r.title).toBe('Review');
    expect(r.dueDate).toBe('2026-04-01');
  });

  it('in N days', () => {
    const r = parseTaskInput('Follow up in 3 days', REF);
    expect(r.title).toBe('Follow up');
    expect(r.dueDate).toBe('2026-03-27');
  });

  it('in N weeks', () => {
    const r = parseTaskInput('Check in 2 weeks', REF);
    expect(r.title).toBe('Check');
    expect(r.dueDate).toBe('2026-04-07');
  });

  it('in 1 month', () => {
    const r = parseTaskInput('Renew in 1 month', REF);
    expect(r.title).toBe('Renew');
    expect(r.dueDate).toBe('2026-04-24');
  });

  it('absolute: mar 25', () => {
    const r = parseTaskInput('Dentist mar 25', REF);
    expect(r.title).toBe('Dentist');
    expect(r.dueDate).toBe('2026-03-25');
  });

  it('absolute: march 25', () => {
    const r = parseTaskInput('Dentist march 25', REF);
    expect(r.title).toBe('Dentist');
    expect(r.dueDate).toBe('2026-03-25');
  });

  it('absolute: 3/25', () => {
    const r = parseTaskInput('Dentist 3/25', REF);
    expect(r.title).toBe('Dentist');
    expect(r.dueDate).toBe('2026-03-25');
  });

  it('absolute: 03/25', () => {
    const r = parseTaskInput('Dentist 03/25', REF);
    expect(r.title).toBe('Dentist');
    expect(r.dueDate).toBe('2026-03-25');
  });

  it('absolute: 2026-03-25 (ISO)', () => {
    const r = parseTaskInput('Dentist 2026-03-25', REF);
    expect(r.title).toBe('Dentist');
    expect(r.dueDate).toBe('2026-03-25');
  });

  it('absolute: 25 mar (day before month)', () => {
    const r = parseTaskInput('Dentist 25 mar', REF);
    expect(r.title).toBe('Dentist');
    expect(r.dueDate).toBe('2026-03-25');
  });

  it('absolute: 25 march', () => {
    const r = parseTaskInput('Dentist 25 march', REF);
    expect(r.title).toBe('Dentist');
    expect(r.dueDate).toBe('2026-03-25');
  });

  // -- date ranges -----------------------------------------------------------
  it('date range: mon-fri', () => {
    const r = parseTaskInput('Conference mon-fri', REF);
    expect(r.title).toBe('Conference');
    expect(r.startDate).toBeDefined();
    expect(r.dueDate).toBeDefined();
    // mon = 2026-03-30, fri = 2026-03-27
    // but since start must be <= due, fri gets pushed
    expect(r.startDate).toBe('2026-03-30');
    expect(r.dueDate).toBe('2026-04-03');
  });

  it('date range: mon to fri', () => {
    const r = parseTaskInput('Sprint mon to fri', REF);
    expect(r.startDate).toBeDefined();
    expect(r.dueDate).toBeDefined();
  });

  it('date range: mar 25-28', () => {
    const r = parseTaskInput('Trip mar 25-28', REF);
    expect(r.title).toBe('Trip');
    expect(r.startDate).toBe('2026-03-25');
    expect(r.dueDate).toBe('2026-03-28');
  });

  it('date range: mar 25 to mar 28', () => {
    const r = parseTaskInput('Trip mar 25 to mar 28', REF);
    expect(r.title).toBe('Trip');
    expect(r.startDate).toBe('2026-03-25');
    expect(r.dueDate).toBe('2026-03-28');
  });

  // -- priority ---------------------------------------------------------------
  it('!high -> 3', () => {
    const r = parseTaskInput('Fix bug !high', REF);
    expect(r.title).toBe('Fix bug');
    expect(r.priority).toBe(3);
  });

  it('!med -> 2', () => {
    const r = parseTaskInput('Fix bug !med', REF);
    expect(r.title).toBe('Fix bug');
    expect(r.priority).toBe(2);
  });

  it('!medium -> 2', () => {
    const r = parseTaskInput('Fix bug !medium', REF);
    expect(r.title).toBe('Fix bug');
    expect(r.priority).toBe(2);
  });

  it('!low -> 1', () => {
    const r = parseTaskInput('Fix bug !low', REF);
    expect(r.title).toBe('Fix bug');
    expect(r.priority).toBe(1);
  });

  it('!none -> 0', () => {
    const r = parseTaskInput('Fix bug !none', REF);
    expect(r.title).toBe('Fix bug');
    expect(r.priority).toBe(0);
  });

  it('!3 -> 3', () => {
    const r = parseTaskInput('Fix bug !3', REF);
    expect(r.title).toBe('Fix bug');
    expect(r.priority).toBe(3);
  });

  it('p2 -> 2', () => {
    const r = parseTaskInput('Fix bug p2', REF);
    expect(r.title).toBe('Fix bug');
    expect(r.priority).toBe(2);
  });

  it('p0 -> 0', () => {
    const r = parseTaskInput('Fix bug p0', REF);
    expect(r.title).toBe('Fix bug');
    expect(r.priority).toBe(0);
  });

  // -- tags -------------------------------------------------------------------
  it('single tag', () => {
    const r = parseTaskInput('Review PR #work', REF);
    expect(r.title).toBe('Review PR');
    expect(r.tags).toEqual(['work']);
  });

  it('multiple tags', () => {
    const r = parseTaskInput('Review PR #work #urgent', REF);
    expect(r.title).toBe('Review PR');
    expect(r.tags).toEqual(['work', 'urgent']);
  });

  it('tag with hyphens', () => {
    const r = parseTaskInput('Task #my-tag', REF);
    expect(r.tags).toEqual(['my-tag']);
  });

  it('tag with spaces (quoted)', () => {
    const r = parseTaskInput('Task #"tag with spaces"', REF);
    expect(r.tags).toEqual(['tag with spaces']);
  });

  // -- duration ---------------------------------------------------------------
  it('30m -> 30', () => {
    const r = parseTaskInput('Meeting 30m', REF);
    expect(r.title).toBe('Meeting');
    expect(r.estimatedMinutes).toBe(30);
  });

  it('30min -> 30', () => {
    const r = parseTaskInput('Meeting 30min', REF);
    expect(r.title).toBe('Meeting');
    expect(r.estimatedMinutes).toBe(30);
  });

  it('30mins -> 30', () => {
    const r = parseTaskInput('Meeting 30mins', REF);
    expect(r.title).toBe('Meeting');
    expect(r.estimatedMinutes).toBe(30);
  });

  it('1h -> 60', () => {
    const r = parseTaskInput('Meeting 1h', REF);
    expect(r.title).toBe('Meeting');
    expect(r.estimatedMinutes).toBe(60);
  });

  it('1hr -> 60', () => {
    const r = parseTaskInput('Meeting 1hr', REF);
    expect(r.title).toBe('Meeting');
    expect(r.estimatedMinutes).toBe(60);
  });

  it('1hour -> 60', () => {
    const r = parseTaskInput('Meeting 1hour', REF);
    expect(r.title).toBe('Meeting');
    expect(r.estimatedMinutes).toBe(60);
  });

  it('2h30m -> 150', () => {
    const r = parseTaskInput('Workshop 2h30m', REF);
    expect(r.title).toBe('Workshop');
    expect(r.estimatedMinutes).toBe(150);
  });

  it('2.5h -> 150', () => {
    const r = parseTaskInput('Workshop 2.5h', REF);
    expect(r.title).toBe('Workshop');
    expect(r.estimatedMinutes).toBe(150);
  });

  it('45min -> 45', () => {
    const r = parseTaskInput('Call 45min', REF);
    expect(r.title).toBe('Call');
    expect(r.estimatedMinutes).toBe(45);
  });

  // -- combined ---------------------------------------------------------------
  it('all fields combined', () => {
    const r = parseTaskInput('Buy milk tomorrow #groceries !high 30m', REF);
    expect(r.title).toBe('Buy milk');
    expect(r.dueDate).toBe('2026-03-25');
    expect(r.priority).toBe(3);
    expect(r.tags).toEqual(['groceries']);
    expect(r.estimatedMinutes).toBe(30);
  });

  it('multiple tags + date + priority', () => {
    const r = parseTaskInput('Deploy app friday #work #devops !med 2h', REF);
    expect(r.title).toBe('Deploy app');
    expect(r.dueDate).toBe('2026-03-27');
    expect(r.priority).toBe(2);
    expect(r.tags).toEqual(['work', 'devops']);
    expect(r.estimatedMinutes).toBe(120);
  });

  // -- edge cases: never throws -----------------------------------------------
  it('empty string', () => {
    expect(() => parseTaskInput('')).not.toThrow();
    const r = parseTaskInput('');
    expect(r.title).toBe('');
    expect(r.tags).toEqual([]);
  });

  it('null-ish input', () => {
    expect(() => parseTaskInput(null as any)).not.toThrow();
    expect(() => parseTaskInput(undefined as any)).not.toThrow();
  });

  it('only special tokens', () => {
    const r = parseTaskInput('#work !high 30m tomorrow', REF);
    expect(r.tags).toEqual(['work']);
    expect(r.priority).toBe(3);
    expect(r.estimatedMinutes).toBe(30);
    // title falls back to original input when cleaned title is empty
    expect(r.title.length).toBeGreaterThan(0);
  });

  it('unicode input', () => {
    expect(() => parseTaskInput('Buy milk and eggs for dinner tonight')).not.toThrow();
    expect(() => parseTaskInput('Acheter du lait demain')).not.toThrow();
  });

  it('emoji input', () => {
    const r = parseTaskInput('Buy groceries tomorrow', REF);
    expect(r).toBeDefined();
    expect(r.tags).toEqual([]);
  });

  it('very long input', () => {
    const long = 'A'.repeat(10000) + ' tomorrow #work !high 30m';
    expect(() => parseTaskInput(long, REF)).not.toThrow();
    const r = parseTaskInput(long, REF);
    expect(r.dueDate).toBe('2026-03-25');
    expect(r.priority).toBe(3);
    expect(r.tags).toEqual(['work']);
    expect(r.estimatedMinutes).toBe(30);
  });

  it('garbage input', () => {
    expect(() => parseTaskInput('!@#$%^&*()')).not.toThrow();
    expect(() => parseTaskInput('   ')).not.toThrow();
    expect(() => parseTaskInput('\t\n\r')).not.toThrow();
  });

  it('number as input', () => {
    expect(() => parseTaskInput(42 as any)).not.toThrow();
  });
});

// -- unit tests for individual extractors ------------------------------------

describe('extractTags', () => {
  it('extracts simple tags', () => {
    const r = extractTags('task #foo #bar');
    expect(r.tags).toEqual(['foo', 'bar']);
    expect(r.remaining.trim()).toBe('task');
  });

  it('extracts quoted tags', () => {
    const r = extractTags('task #"my tag"');
    expect(r.tags).toEqual(['my tag']);
  });

  it('handles no tags', () => {
    const r = extractTags('no tags here');
    expect(r.tags).toEqual([]);
    expect(r.remaining).toBe('no tags here');
  });
});

describe('extractPriority', () => {
  it('!high', () => {
    expect(extractPriority('task !high').priority).toBe(3);
  });
  it('p1', () => {
    expect(extractPriority('task p1').priority).toBe(1);
  });
  it('no priority', () => {
    expect(extractPriority('task').priority).toBeUndefined();
  });
});

describe('extractDuration', () => {
  it('compound 1h30m', () => {
    expect(extractDuration('task 1h30m').minutes).toBe(90);
  });
  it('decimal 1.5h', () => {
    expect(extractDuration('task 1.5h').minutes).toBe(90);
  });
  it('plain minutes', () => {
    expect(extractDuration('task 45min').minutes).toBe(45);
  });
  it('no duration', () => {
    expect(extractDuration('task').minutes).toBeUndefined();
  });
});

describe('extractDates', () => {
  it('today', () => {
    const r = extractDates('task today', REF);
    expect(r.dueDate).toBe('2026-03-24');
  });
  it('no date', () => {
    const r = extractDates('plain task', REF);
    expect(r.dueDate).toBeUndefined();
    expect(r.startDate).toBeUndefined();
  });
});
