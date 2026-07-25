#include "core/RecurrenceExpansionWorker.h"

#include <QDate>
#include <QDateTime>
#include <QHash>
#include <QRegularExpression>
#include <QTime>
#include <QTimeZone>

#include <algorithm>
#include <cstdint>
#include <future>
#include <limits>
#include <optional>
#include <utility>
#include <variant>

namespace hcb {
namespace {

constexpr int kMaximumOccurrences = 366;
constexpr int kMaximumInterval = 366;
constexpr int kMaximumMonthDay = 31;
constexpr int kMaximumWeekdayPosition = 5;

enum class RecurrenceFrequency : std::uint8_t {
  Daily,
  Weekly,
  Monthly,
  Yearly
};

struct ParsedRecurrenceRule final {
  RecurrenceFrequency frequency;
  int interval{1};
  QList<int> byDay;
  std::optional<int> byMonthDay;
  std::optional<int> bySetPosition;
  std::optional<int> count;
  std::optional<QDateTime> until;
};

[[nodiscard]] int positiveBoundedInteger(const QString& text, int maximum) {
  bool converted = false;
  const int value = text.toInt(&converted);
  return converted ? std::clamp(value, 1, maximum) : 1;
}

[[nodiscard]] int boundedWeekdayPosition(const QString& text) {
  bool converted = false;
  const int value = text.toInt(&converted);
  if (!converted || value == 0) {
    return 1;
  }
  return std::clamp(value, -kMaximumWeekdayPosition, kMaximumWeekdayPosition);
}

[[nodiscard]] int weekdayCode(const QDateTime& value) { return value.date().dayOfWeek() % 7; }

[[nodiscard]] std::optional<int> weekdayCode(const QString& value) {
  if (value == QStringLiteral("SU")) {
    return 0;
  }
  if (value == QStringLiteral("MO")) {
    return 1;
  }
  if (value == QStringLiteral("TU")) {
    return 2;
  }
  if (value == QStringLiteral("WE")) {
    return 3;
  }
  if (value == QStringLiteral("TH")) {
    return 4;
  }
  if (value == QStringLiteral("FR")) {
    return 5;
  }
  if (value == QStringLiteral("SA")) {
    return 6;
  }
  return std::nullopt;
}

[[nodiscard]] std::optional<QDateTime> parseUntil(const QString& value) {
  static const QRegularExpression dateTimePattern(
      QStringLiteral("^(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z$"));
  static const QRegularExpression datePattern(QStringLiteral("^(\\d{4})(\\d{2})(\\d{2})$"));
  const QRegularExpressionMatch dateTimeMatch = dateTimePattern.match(value);
  const QRegularExpressionMatch dateMatch = datePattern.match(value);
  const QRegularExpressionMatch match = dateTimeMatch.hasMatch() ? dateTimeMatch : dateMatch;
  if (!match.hasMatch()) {
    return std::nullopt;
  }
  bool yearConverted = false;
  bool monthConverted = false;
  bool dayConverted = false;
  const int year = match.captured(1).toInt(&yearConverted);
  const int month = match.captured(2).toInt(&monthConverted);
  const int day = match.captured(3).toInt(&dayConverted);
  const QDate date(year, month, day);
  if (!yearConverted || !monthConverted || !dayConverted || !date.isValid()) {
    return std::nullopt;
  }
  if (!dateTimeMatch.hasMatch()) {
    return QDateTime(date, QTime(23, 59, 59), QTimeZone::utc());
  }
  bool hourConverted = false;
  bool minuteConverted = false;
  bool secondConverted = false;
  const QTime time(match.captured(4).toInt(&hourConverted),
                   match.captured(5).toInt(&minuteConverted),
                   match.captured(6).toInt(&secondConverted));
  return hourConverted && minuteConverted && secondConverted && time.isValid()
             ? std::optional<QDateTime>(QDateTime(date, time, QTimeZone::utc()))
             : std::nullopt;
}

[[nodiscard]] std::optional<ParsedRecurrenceRule>
parseRecurrenceRule(const std::optional<QString>& recurrenceRule) {
  if (!recurrenceRule.has_value()) {
    return std::nullopt;
  }
  QString line;
  for (const QString& candidate : recurrenceRule->split(u'\n')) {
    const QString trimmed = candidate.trimmed();
    if (trimmed.startsWith(QStringLiteral("RRULE:"))) {
      line = trimmed;
      break;
    }
  }
  if (line.isEmpty()) {
    return std::nullopt;
  }
  QHash<QString, QString> parts;
  for (const QString& field : line.sliced(6).split(u';', Qt::SkipEmptyParts)) {
    const qsizetype separator = field.indexOf(u'=');
    if (separator <= 0) {
      continue;
    }
    parts.insert(field.first(separator), field.sliced(separator + 1));
  }
  const QString frequency = parts.value(QStringLiteral("FREQ"));
  std::optional<RecurrenceFrequency> parsedFrequency;
  if (frequency == QStringLiteral("DAILY")) {
    parsedFrequency = RecurrenceFrequency::Daily;
  } else if (frequency == QStringLiteral("WEEKLY")) {
    parsedFrequency = RecurrenceFrequency::Weekly;
  } else if (frequency == QStringLiteral("MONTHLY")) {
    parsedFrequency = RecurrenceFrequency::Monthly;
  } else if (frequency == QStringLiteral("YEARLY")) {
    parsedFrequency = RecurrenceFrequency::Yearly;
  }
  if (!parsedFrequency.has_value()) {
    return std::nullopt;
  }
  ParsedRecurrenceRule parsed{.frequency = *parsedFrequency};
  if (parts.contains(QStringLiteral("INTERVAL"))) {
    parsed.interval =
        positiveBoundedInteger(parts.value(QStringLiteral("INTERVAL")), kMaximumInterval);
  }
  if (parts.contains(QStringLiteral("BYDAY"))) {
    for (QString day : parts.value(QStringLiteral("BYDAY")).split(u',')) {
      day.remove(QRegularExpression(QStringLiteral("^[+-]?\\d+")));
      const std::optional<int> code = weekdayCode(day);
      if (code.has_value() && !parsed.byDay.contains(*code)) {
        parsed.byDay.append(*code);
      }
    }
  }
  if (parts.contains(QStringLiteral("BYMONTHDAY"))) {
    parsed.byMonthDay =
        positiveBoundedInteger(parts.value(QStringLiteral("BYMONTHDAY")), kMaximumMonthDay);
  }
  if (parts.contains(QStringLiteral("BYSETPOS"))) {
    parsed.bySetPosition = boundedWeekdayPosition(parts.value(QStringLiteral("BYSETPOS")));
  }
  if (parts.contains(QStringLiteral("COUNT"))) {
    parsed.count =
        positiveBoundedInteger(parts.value(QStringLiteral("COUNT")), kMaximumOccurrences);
  }
  if (parts.contains(QStringLiteral("UNTIL"))) {
    parsed.until = parseUntil(parts.value(QStringLiteral("UNTIL")));
  }
  return parsed;
}

[[nodiscard]] std::optional<QDateTime> parseUtcDateTime(const QString& value) {
  if (value.size() > 64 || !value.contains(u'T')) {
    return std::nullopt;
  }
  const QDateTime parsed = QDateTime::fromString(value, Qt::ISODateWithMs);
  return parsed.isValid() ? std::optional<QDateTime>(parsed.toUTC()) : std::nullopt;
}

[[nodiscard]] bool isValidEventId(const QString& value) {
  return !value.isEmpty() && value == value.trimmed() && value.size() <= 256 &&
         !value.contains(QChar::Null);
}

[[nodiscard]] QDateTime addMonthsWithRollover(const QDateTime& value, int months) {
  const QDate date = value.date();
  const qint64 monthIndex =
      static_cast<qint64>(date.year()) * 12 + static_cast<qint64>(date.month() - 1) + months;
  const qint64 year = monthIndex / 12;
  const int month = static_cast<int>(monthIndex % 12) + 1;
  if (year < std::numeric_limits<int>::min() || year > std::numeric_limits<int>::max()) {
    return {};
  }
  const QDate target(static_cast<int>(year), month, 1);
  return target.isValid()
             ? QDateTime(target.addDays(date.day() - 1), value.time(), QTimeZone::utc())
             : QDateTime{};
}

[[nodiscard]] QDateTime addYearsWithRollover(const QDateTime& value, int years) {
  const QDate date = value.date();
  const qint64 year = static_cast<qint64>(date.year()) + years;
  if (year < std::numeric_limits<int>::min() || year > std::numeric_limits<int>::max()) {
    return {};
  }
  const QDate target(static_cast<int>(year), date.month(), 1);
  return target.isValid()
             ? QDateTime(target.addDays(date.day() - 1), value.time(), QTimeZone::utc())
             : QDateTime{};
}

[[nodiscard]] bool
matchesRecurrenceMonth(const QDateTime& seriesStart, const QDateTime& candidate, int interval) {
  const QDate start = seriesStart.date();
  const QDate date = candidate.date();
  const int months = (date.year() - start.year()) * 12 + date.month() - start.month();
  return months >= 0 && months % interval == 0;
}

[[nodiscard]] bool matchesWeekdayPosition(const QDateTime& candidate, int position) {
  const QDate date = candidate.date();
  if (position > 0) {
    return (date.day() - 1) / 7 + 1 == position;
  }
  QDate nextWeek = date.addDays(7);
  int fromEnd = 1;
  while (nextWeek.month() == date.month()) {
    ++fromEnd;
    nextWeek = nextWeek.addDays(7);
  }
  return -fromEnd == position;
}

[[nodiscard]] bool matchesMonthlyRule(const QDateTime& candidate,
                                      const ParsedRecurrenceRule& rule,
                                      const QDateTime& seriesStart) {
  if (!matchesRecurrenceMonth(seriesStart, candidate, rule.interval)) {
    return false;
  }
  if (rule.byMonthDay.has_value()) {
    return candidate.date().day() == *rule.byMonthDay;
  }
  if (rule.bySetPosition.has_value() && !rule.byDay.isEmpty()) {
    return rule.byDay.contains(weekdayCode(candidate)) &&
           matchesWeekdayPosition(candidate, *rule.bySetPosition);
  }
  return candidate.date().day() == seriesStart.date().day();
}

[[nodiscard]] bool
matchesRecurrenceWeek(const QDateTime& seriesStart, const QDateTime& candidate, int interval) {
  const QDate startWeek = seriesStart.date().addDays(-(seriesStart.date().dayOfWeek() % 7));
  const QDate candidateWeek = candidate.date().addDays(-(candidate.date().dayOfWeek() % 7));
  const qint64 weeks = startWeek.daysTo(candidateWeek) / 7;
  return weeks >= 0 && weeks % interval == 0;
}

[[nodiscard]] QDateTime nextWeeklyByDay(const QDateTime& current,
                                        const ParsedRecurrenceRule& rule,
                                        const QDateTime& seriesStart) {
  QDateTime next = current;
  for (int offset = 1; offset <= rule.interval * 7 + 7; ++offset) {
    next = next.addDays(1);
    if (rule.byDay.contains(weekdayCode(next)) &&
        matchesRecurrenceWeek(seriesStart, next, rule.interval)) {
      return next;
    }
  }
  return current.addDays(static_cast<qint64>(rule.interval) * 7);
}

[[nodiscard]] QDateTime nextMonthlyRuleDate(const QDateTime& current,
                                            const ParsedRecurrenceRule& rule,
                                            const QDateTime& seriesStart) {
  QDateTime next = current;
  for (int offset = 1; offset <= 370; ++offset) {
    next = next.addDays(1);
    next.setTime(seriesStart.time());
    if (matchesMonthlyRule(next, rule, seriesStart)) {
      return next;
    }
  }
  return addMonthsWithRollover(current, rule.interval);
}

[[nodiscard]] QDateTime firstRecurrenceDate(const QDateTime& start,
                                            const ParsedRecurrenceRule& rule) {
  if (rule.frequency == RecurrenceFrequency::Monthly &&
      (rule.byMonthDay.has_value() || rule.bySetPosition.has_value())) {
    return matchesMonthlyRule(start, rule, start)
               ? start
               : nextMonthlyRuleDate(start.addDays(-1), rule, start);
  }
  if (rule.frequency != RecurrenceFrequency::Weekly || rule.byDay.isEmpty() ||
      rule.byDay.contains(weekdayCode(start))) {
    return start;
  }
  return nextWeeklyByDay(start.addDays(-1), rule, start);
}

[[nodiscard]] QDateTime nextRecurrenceDate(const QDateTime& current,
                                           const ParsedRecurrenceRule& rule,
                                           const QDateTime& seriesStart) {
  if (rule.frequency == RecurrenceFrequency::Weekly && !rule.byDay.isEmpty()) {
    return nextWeeklyByDay(current, rule, seriesStart);
  }
  if (rule.frequency == RecurrenceFrequency::Monthly &&
      (rule.byMonthDay.has_value() || rule.bySetPosition.has_value())) {
    return nextMonthlyRuleDate(current, rule, seriesStart);
  }
  switch (rule.frequency) {
  case RecurrenceFrequency::Daily:
    return current.addDays(rule.interval);
  case RecurrenceFrequency::Weekly:
    return current.addDays(static_cast<qint64>(rule.interval) * 7);
  case RecurrenceFrequency::Monthly:
    return addMonthsWithRollover(current, rule.interval);
  case RecurrenceFrequency::Yearly:
    return addYearsWithRollover(current, rule.interval);
  }
  return {};
}

[[nodiscard]] RecurrenceExpansionResult expandStored(const RecurrenceExpansionRequest& request,
                                                     const std::stop_token& cancellation) {
  if (cancellation.stop_requested()) {
    return AppError(AppErrorCode::Cancelled, QStringLiteral("Recurrence expansion was cancelled"));
  }
  if (!isValidEventId(request.eventId)) {
    return AppError(AppErrorCode::Validation,
                    QStringLiteral("Recurrence event identifier is invalid"));
  }
  const std::optional<QDateTime> start = parseUtcDateTime(request.startAt);
  const std::optional<QDateTime> end = parseUtcDateTime(request.endAt);
  if (!start.has_value() || !end.has_value() || *end <= *start) {
    return AppError(AppErrorCode::Validation, QStringLiteral("Recurrence event range is invalid"));
  }
  const RecurrenceOccurrence single{.id = request.eventId,
                                    .startAt = start->toString(Qt::ISODateWithMs),
                                    .endAt = end->toString(Qt::ISODateWithMs),
                                    .originalStartAt = std::nullopt};
  const std::optional<ParsedRecurrenceRule> rule = parseRecurrenceRule(request.recurrenceRule);
  if (!rule.has_value()) {
    return QList<RecurrenceOccurrence>{single};
  }
  const qint64 duration = start->msecsTo(*end);
  const int maximum = std::min(rule->count.value_or(kMaximumOccurrences), kMaximumOccurrences);
  const QDateTime until = rule->until.value_or(start->addDays(kMaximumOccurrences));
  QList<RecurrenceOccurrence> occurrences;
  occurrences.reserve(maximum);
  QDateTime cursor = firstRecurrenceDate(*start, *rule);
  for (int index = 0; index < maximum && cursor <= until; ++index) {
    if (cancellation.stop_requested()) {
      return AppError(AppErrorCode::Cancelled,
                      QStringLiteral("Recurrence expansion was cancelled"));
    }
    if (!cursor.isValid()) {
      return AppError(AppErrorCode::Validation,
                      QStringLiteral("Recurrence rule exceeds date range"));
    }
    const QString occurrenceStart = cursor.toString(Qt::ISODateWithMs);
    QString suffix = occurrenceStart;
    if (request.allDay) {
      suffix = suffix.left(10).remove(u'-');
    } else {
      suffix.remove(u'-').remove(u':').remove(QStringLiteral(".000"));
    }
    occurrences.append({.id = index == 0 ? request.eventId
                                         : request.eventId + QStringLiteral(":instance:") + suffix,
                        .startAt = occurrenceStart,
                        .endAt = cursor.addMSecs(duration).toString(Qt::ISODateWithMs),
                        .originalStartAt = occurrenceStart});
    cursor = nextRecurrenceDate(cursor, *rule, *start);
  }
  return occurrences.isEmpty() ? RecurrenceExpansionResult(QList<RecurrenceOccurrence>{single})
                               : RecurrenceExpansionResult(std::move(occurrences));
}

} // namespace

std::future<RecurrenceExpansionResult>
RecurrenceExpansionWorker::expand(RecurrenceExpansionRequest request,
                                  const std::stop_token& cancellation) const {
  return std::async(std::launch::async, [request = std::move(request), cancellation]() {
    return expandStored(request, cancellation);
  });
}

} // namespace hcb
