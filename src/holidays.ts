import { validDate, type TodoDocument, type TodoItem } from './todoText.ts';

export type PublicHoliday = { date: string; name: string };
export type HolidayYear = { holidays: PublicHoliday[]; source: string };

function cleanHolidays(entries: PublicHoliday[], year: number) {
  const seen = new Set<string>();
  return entries.filter(entry => {
    if (!validDate(entry.date) || !entry.date.startsWith(`${year}-`) || !entry.name.trim()) return false;
    const key = `${entry.date}\0${entry.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export function parseSingaporeHolidays(payload: unknown, year: number): PublicHoliday[] {
  if (!payload || typeof payload !== 'object' || !('result' in payload)) throw new Error('Invalid Singapore holiday data');
  const result = (payload as { result?: { records?: unknown } }).result;
  if (!Array.isArray(result?.records)) throw new Error('Invalid Singapore holiday data');
  return cleanHolidays(result.records.filter((row): row is { date: string; holiday: string } =>
    !!row && typeof row.date === 'string' && typeof row.holiday === 'string')
    .map(row => ({ date: row.date, name: row.holiday.trim() })), year);
}

export function parseNagerHolidays(payload: unknown, year: number): PublicHoliday[] {
  if (!Array.isArray(payload)) throw new Error('Invalid public holiday data');
  const allUKNations = ['GB-ENG', 'GB-NIR', 'GB-SCT', 'GB-WLS'];
  return cleanHolidays(payload.filter((row): row is { date: string; name: string } =>
    !!row && typeof row.date === 'string' && typeof row.name === 'string' && Array.isArray(row.holidayTypes) && row.holidayTypes.includes('Public') &&
    (row.nationalHoliday === true || (row.countryCode === 'GB' && allUKNations.every(code => row.subdivisionCodes?.includes(code)))))
    .map(row => ({ date: row.date, name: row.name.trim() })), year);
}

export async function fetchHolidayYear(country: string, year: number, signal?: AbortSignal): Promise<HolidayYear> {
  if (!/^[A-Z]{2}$/.test(country) || !Number.isInteger(year) || year < 1900 || year > 2100) throw new Error('Invalid holiday country or year');
  if (country === 'SG') {
    const response = await fetch('https://data.gov.sg/api/action/datastore_search?resource_id=d_8ef23381f9417e4d4254ee8b4dcdb176&limit=1000', { signal });
    if (!response.ok) throw new Error(`Singapore holidays could not load (${response.status})`);
    const holidays = parseSingaporeHolidays(await response.json(), year);
    if (holidays.length) return { holidays, source: 'Singapore Ministry of Manpower' };
    // The official dataset currently covers 2020–2027. Avoid a partial fallback
    // that silently misses observed holidays for an unsupported year.
    throw new Error(`Singapore public holidays for ${year} are not available from the official source yet`);
  }
  const response = await fetch(`https://nagerholidays.com/api/v4/Holidays/${country}/${year}`, { signal });
  if (!response.ok) throw new Error(`Public holidays could not load (${response.status})`);
  return { holidays: parseNagerHolidays(await response.json(), year), source: 'Nager.Date (countrywide holidays)' };
}

export function addSavedHolidays(document: TodoDocument, holidays: PublicHoliday[], today: string, createId: () => string): number {
  let added = 0;
  for (const holiday of holidays) {
    const day = document.days.find(entry => entry.date === holiday.date) ?? (() => {
      const entry = { date: holiday.date, items: [] as TodoItem[] };
      document.days.push(entry);
      return entry;
    })();
    if (day.items.some(item => item.text === holiday.name && item.span?.kind === 'all-day')) continue;
    day.items.push({ id: createId(), text: holiday.name, completed: holiday.date < today, details: [], span: { kind: 'all-day' } });
    added++;
  }
  document.days.sort((a, b) => a.date.localeCompare(b.date));
  return added;
}
