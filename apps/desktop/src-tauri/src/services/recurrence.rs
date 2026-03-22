/// Simple RRULE parsing and expansion engine.
///
/// Supports the following RRULE properties:
///   FREQ=DAILY|WEEKLY|MONTHLY|YEARLY
///   INTERVAL=N          (defaults to 1)
///   BYDAY=MO,TU,WE,TH,FR,SA,SU   (only meaningful with FREQ=WEEKLY)
///   COUNT=N             (maximum total occurrences from dtstart)
///
/// All dates are ISO 8601 date strings (YYYY-MM-DD) or datetime strings
/// (YYYY-MM-DDTHH:MM:SSZ). Only the date portion is used for expansion.

// ---------------------------------------------------------------------------
// Date helpers (no external crate)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct SimpleDate {
    year: i32,
    month: u32, // 1..=12
    day: u32,   // 1..=31
}

impl SimpleDate {
    fn from_iso(s: &str) -> Result<Self, String> {
        // Accept "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS..." (truncate at T).
        let date_part = s.split('T').next().unwrap_or(s);
        let parts: Vec<&str> = date_part.split('-').collect();
        if parts.len() != 3 {
            return Err(format!("Invalid date format: {}", s));
        }
        let year: i32 = parts[0].parse().map_err(|_| format!("Invalid year in: {}", s))?;
        let month: u32 = parts[1].parse().map_err(|_| format!("Invalid month in: {}", s))?;
        let day: u32 = parts[2].parse().map_err(|_| format!("Invalid day in: {}", s))?;
        if !(1..=12).contains(&month) {
            return Err(format!("Month out of range: {}", month));
        }
        if day < 1 || day > days_in_month(year, month) {
            return Err(format!("Day out of range: {}-{:02}-{:02}", year, month, day));
        }
        Ok(SimpleDate { year, month, day })
    }

    fn to_iso(self) -> String {
        format!("{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }

    /// Day of week: 0=Monday .. 6=Sunday (ISO weekday).
    fn weekday(self) -> u32 {
        // Tomohiko Sakamoto's algorithm (returns 0=Sunday..6=Saturday).
        let t = [0i32, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
        let mut y = self.year;
        if self.month < 3 {
            y -= 1;
        }
        let dow =
            (y + y / 4 - y / 100 + y / 400 + t[(self.month - 1) as usize] + self.day as i32) % 7;
        // Convert from 0=Sunday to 0=Monday: (dow + 6) % 7
        ((dow + 6) % 7) as u32
    }

    fn add_days(self, n: i32) -> SimpleDate {
        let days = ymd_to_epoch_days(self.year, self.month, self.day) + n as i64;
        epoch_days_to_date(days)
    }

    fn add_months(self, n: i32) -> SimpleDate {
        let total_months = (self.year * 12 + self.month as i32 - 1) + n;
        let new_year = total_months.div_euclid(12);
        let new_month = (total_months.rem_euclid(12) + 1) as u32;
        let max_day = days_in_month(new_year, new_month);
        let new_day = self.day.min(max_day);
        SimpleDate {
            year: new_year,
            month: new_month,
            day: new_day,
        }
    }

    fn add_years(self, n: i32) -> SimpleDate {
        let new_year = self.year + n;
        let max_day = days_in_month(new_year, self.month);
        let new_day = self.day.min(max_day);
        SimpleDate {
            year: new_year,
            month: self.month,
            day: new_day,
        }
    }
}

fn is_leap_year(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

fn days_in_month(y: i32, m: u32) -> u32 {
    match m {
        1 => 31,
        2 => {
            if is_leap_year(y) {
                29
            } else {
                28
            }
        }
        3 => 31,
        4 => 30,
        5 => 31,
        6 => 30,
        7 => 31,
        8 => 31,
        9 => 30,
        10 => 31,
        11 => 30,
        12 => 31,
        _ => 30,
    }
}

/// Convert (year, month, day) to days since 1970-01-01.
fn ymd_to_epoch_days(y: i32, m: u32, d: u32) -> i64 {
    let (y, m) = if m <= 2 {
        (y as i64 - 1, m as i64 + 9)
    } else {
        (y as i64, m as i64 - 3)
    };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let doy = (153 * m as u64 + 2) / 5 + d as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era as i64 * 146097 + doe as i64 - 719468
}

fn epoch_days_to_date(epoch_days: i64) -> SimpleDate {
    let z = epoch_days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    SimpleDate {
        year: y as i32,
        month: m,
        day: d,
    }
}

// ---------------------------------------------------------------------------
// RRULE parsing
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

/// Weekday constants matching ISO weekday (0=Mon .. 6=Sun).
fn parse_weekday(s: &str) -> Result<u32, String> {
    match s {
        "MO" => Ok(0),
        "TU" => Ok(1),
        "WE" => Ok(2),
        "TH" => Ok(3),
        "FR" => Ok(4),
        "SA" => Ok(5),
        "SU" => Ok(6),
        _ => Err(format!("Unknown weekday: {}", s)),
    }
}

struct RRule {
    freq: Freq,
    interval: u32,
    by_day: Vec<u32>,
    count: Option<usize>,
}

fn parse_rrule(rule: &str) -> Result<RRule, String> {
    // Strip an optional "RRULE:" prefix.
    let rule = rule.strip_prefix("RRULE:").unwrap_or(rule);

    let mut freq: Option<Freq> = None;
    let mut interval: u32 = 1;
    let mut by_day: Vec<u32> = Vec::new();
    let mut count: Option<usize> = None;

    for part in rule.split(';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (key, value) = part
            .split_once('=')
            .ok_or_else(|| format!("Invalid RRULE part: {}", part))?;
        match key {
            "FREQ" => {
                freq = Some(match value {
                    "DAILY" => Freq::Daily,
                    "WEEKLY" => Freq::Weekly,
                    "MONTHLY" => Freq::Monthly,
                    "YEARLY" => Freq::Yearly,
                    _ => return Err(format!("Unsupported FREQ: {}", value)),
                });
            }
            "INTERVAL" => {
                interval = value
                    .parse()
                    .map_err(|_| format!("Invalid INTERVAL: {}", value))?;
                if interval == 0 {
                    return Err("INTERVAL must be >= 1".to_string());
                }
            }
            "BYDAY" => {
                for day_str in value.split(',') {
                    by_day.push(parse_weekday(day_str.trim())?);
                }
            }
            "COUNT" => {
                count = Some(
                    value
                        .parse()
                        .map_err(|_| format!("Invalid COUNT: {}", value))?,
                );
            }
            // Silently ignore UNTIL and other unknown properties for now.
            _ => {}
        }
    }

    let freq = freq.ok_or_else(|| "RRULE missing FREQ".to_string())?;
    Ok(RRule {
        freq,
        interval,
        by_day,
        count,
    })
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

/// Expand an RRULE starting from `dtstart`, returning the next `limit`
/// occurrences that fall strictly after `after`.
///
/// All parameters are ISO 8601 date strings (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ).
/// Returns ISO 8601 date strings (YYYY-MM-DD).
pub fn expand_rrule(
    rule: &str,
    dtstart: &str,
    after: &str,
    limit: usize,
) -> Result<Vec<String>, String> {
    let rrule = parse_rrule(rule)?;
    let start = SimpleDate::from_iso(dtstart)?;
    let after_date = SimpleDate::from_iso(after)?;

    let mut results: Vec<String> = Vec::new();
    let mut total_generated: usize = 0; // counts all occurrences from dtstart for COUNT logic

    // Safety limit to prevent runaway loops.
    let max_iterations: usize = 10_000;
    let mut iterations: usize = 0;

    match rrule.freq {
        Freq::Daily => {
            let mut current = start;
            loop {
                if iterations >= max_iterations || results.len() >= limit {
                    break;
                }
                iterations += 1;

                if let Some(cnt) = rrule.count {
                    if total_generated >= cnt {
                        break;
                    }
                }

                total_generated += 1;

                if current > after_date {
                    results.push(current.to_iso());
                }

                current = current.add_days(rrule.interval as i32);
            }
        }
        Freq::Weekly => {
            if rrule.by_day.is_empty() {
                // No BYDAY: just advance by interval weeks.
                let mut current = start;
                loop {
                    if iterations >= max_iterations || results.len() >= limit {
                        break;
                    }
                    iterations += 1;

                    if let Some(cnt) = rrule.count {
                        if total_generated >= cnt {
                            break;
                        }
                    }

                    total_generated += 1;

                    if current > after_date {
                        results.push(current.to_iso());
                    }

                    current = current.add_days(7 * rrule.interval as i32);
                }
            } else {
                // With BYDAY: iterate week by week, checking each day.
                // Find the Monday of the week containing dtstart.
                let start_wd = start.weekday();
                let week_start = start.add_days(-(start_wd as i32));

                let mut week = week_start;
                let mut first_week = true;
                loop {
                    if iterations >= max_iterations || results.len() >= limit {
                        break;
                    }

                    for &wd in &rrule.by_day {
                        let candidate = week.add_days(wd as i32);

                        // On the first week, skip days before dtstart.
                        if first_week && candidate < start {
                            continue;
                        }

                        if let Some(cnt) = rrule.count {
                            if total_generated >= cnt {
                                break;
                            }
                        }

                        total_generated += 1;

                        if candidate > after_date && results.len() < limit {
                            results.push(candidate.to_iso());
                        }

                        iterations += 1;
                        if iterations >= max_iterations || results.len() >= limit {
                            break;
                        }
                    }

                    first_week = false;
                    week = week.add_days(7 * rrule.interval as i32);
                }
            }
        }
        Freq::Monthly => {
            let mut step: i32 = 0;
            loop {
                // Always compute from the original start to preserve the original day.
                let current = start.add_months(step * rrule.interval as i32);

                if iterations >= max_iterations || results.len() >= limit {
                    break;
                }
                iterations += 1;

                if let Some(cnt) = rrule.count {
                    if total_generated >= cnt {
                        break;
                    }
                }

                total_generated += 1;

                if current > after_date {
                    results.push(current.to_iso());
                }

                step += 1;
            }
        }
        Freq::Yearly => {
            let mut step: i32 = 0;
            loop {
                let current = start.add_years(step * rrule.interval as i32);

                if iterations >= max_iterations || results.len() >= limit {
                    break;
                }
                iterations += 1;

                if let Some(cnt) = rrule.count {
                    if total_generated >= cnt {
                        break;
                    }
                }

                total_generated += 1;

                if current > after_date {
                    results.push(current.to_iso());
                }

                step += 1;
            }
        }
    }

    Ok(results)
}

/// Convenience wrapper: return the single next occurrence after `after`, or None.
pub fn next_occurrence(
    rule: &str,
    dtstart: &str,
    after: &str,
) -> Result<Option<String>, String> {
    let results = expand_rrule(rule, dtstart, after, 1)?;
    Ok(results.into_iter().next())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_daily_basic() {
        let r = expand_rrule("FREQ=DAILY", "2026-01-01", "2026-01-01", 3).unwrap();
        assert_eq!(r, vec!["2026-01-02", "2026-01-03", "2026-01-04"]);
    }

    #[test]
    fn test_daily_interval() {
        let r = expand_rrule("FREQ=DAILY;INTERVAL=3", "2026-01-01", "2026-01-01", 3).unwrap();
        assert_eq!(r, vec!["2026-01-04", "2026-01-07", "2026-01-10"]);
    }

    #[test]
    fn test_weekly_no_byday() {
        let r = expand_rrule("FREQ=WEEKLY", "2026-01-05", "2026-01-05", 3).unwrap();
        // 2026-01-05 is a Monday
        assert_eq!(r, vec!["2026-01-12", "2026-01-19", "2026-01-26"]);
    }

    #[test]
    fn test_weekly_byday() {
        let r = expand_rrule(
            "FREQ=WEEKLY;BYDAY=MO,WE,FR",
            "2026-01-05", // Monday
            "2026-01-05",
            5,
        )
        .unwrap();
        assert_eq!(
            r,
            vec![
                "2026-01-07", // Wed
                "2026-01-09", // Fri
                "2026-01-12", // Mon
                "2026-01-14", // Wed
                "2026-01-16", // Fri
            ]
        );
    }

    #[test]
    fn test_monthly() {
        let r = expand_rrule("FREQ=MONTHLY", "2026-01-31", "2026-01-31", 3).unwrap();
        // Jan 31 -> Feb 28 -> Mar 31
        assert_eq!(r, vec!["2026-02-28", "2026-03-31", "2026-04-30"]);
    }

    #[test]
    fn test_yearly() {
        let r = expand_rrule("FREQ=YEARLY", "2024-02-29", "2024-02-29", 3).unwrap();
        // Leap day: 2025-02-28, 2026-02-28, 2027-02-28
        assert_eq!(r, vec!["2025-02-28", "2026-02-28", "2027-02-28"]);
    }

    #[test]
    fn test_count_limit() {
        let r = expand_rrule("FREQ=DAILY;COUNT=5", "2026-01-01", "2025-12-31", 10).unwrap();
        // COUNT=5 means only 5 occurrences total from dtstart.
        assert_eq!(
            r,
            vec![
                "2026-01-01",
                "2026-01-02",
                "2026-01-03",
                "2026-01-04",
                "2026-01-05",
            ]
        );
    }

    #[test]
    fn test_next_occurrence() {
        let r = next_occurrence("FREQ=WEEKLY", "2026-01-05", "2026-01-20").unwrap();
        assert_eq!(r, Some("2026-01-26".to_string()));
    }

    #[test]
    fn test_rrule_prefix() {
        let r = expand_rrule("RRULE:FREQ=DAILY;INTERVAL=2", "2026-01-01", "2026-01-01", 2).unwrap();
        assert_eq!(r, vec!["2026-01-03", "2026-01-05"]);
    }

    #[test]
    fn test_weekday_calculation() {
        // 2026-01-05 is a Monday
        assert_eq!(SimpleDate::from_iso("2026-01-05").unwrap().weekday(), 0);
        // 2026-01-11 is a Sunday
        assert_eq!(SimpleDate::from_iso("2026-01-11").unwrap().weekday(), 6);
    }
}
