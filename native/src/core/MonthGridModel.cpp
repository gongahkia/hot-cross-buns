#include "core/MonthGridModel.h"

#include "core/CalendarLayoutEngine.h"

#include <QDateTime>
#include <QVariantList>
#include <QVariantMap>

#include <algorithm>
#include <limits>
#include <optional>
#include <utility>

namespace hcb {

namespace {

[[nodiscard]] std::optional<QDateTime> parseDateTime(const QString& value,
                                                     const QTimeZone& displayTimeZone) {
  QDateTime parsed = QDateTime::fromString(value, Qt::ISODateWithMs);
  if (!parsed.isValid()) {
    parsed = QDateTime::fromString(value, Qt::ISODate);
  }
  if (parsed.isValid()) {
    const bool hasOffset =
        value.endsWith(u'Z') || value.lastIndexOf(u'+') > 9 || value.lastIndexOf(u'-') > 9;
    return hasOffset ? parsed.toTimeZone(displayTimeZone)
                     : QDateTime(parsed.date(), parsed.time(), displayTimeZone);
  }
  const QDate date = QDate::fromString(value.left(10), Qt::ISODate);
  return date.isValid() ? std::optional<QDateTime>(QDateTime(date, QTime(0, 0), displayTimeZone))
                        : std::nullopt;
}

[[nodiscard]] std::optional<QPair<QDate, QDate>> eventDateRange(const CalendarEventSummary& event,
                                                                const QTimeZone& displayTimeZone) {
  if (event.allDay) {
    const QDate startDate = QDate::fromString(event.startAt.left(10), Qt::ISODate);
    const QDate endDate = QDate::fromString(event.endAt.left(10), Qt::ISODate);
    return startDate.isValid() && endDate.isValid() && endDate > startDate
               ? std::optional<QPair<QDate, QDate>>(qMakePair(startDate, endDate.addDays(-1)))
               : std::nullopt;
  }
  const std::optional<QDateTime> start = parseDateTime(event.startAt, displayTimeZone);
  const std::optional<QDateTime> end = parseDateTime(event.endAt, displayTimeZone);
  if (!start.has_value() || !end.has_value() || *end <= *start) {
    return std::nullopt;
  }
  QDate last = end->date();
  if (end->time() == QTime(0, 0)) {
    last = last.addDays(-1);
  }
  return last < start->date() ? std::nullopt
                              : std::optional<QPair<QDate, QDate>>(qMakePair(start->date(), last));
}

[[nodiscard]] QVariantMap eventMap(const CalendarEventSummary& event) {
  return {{QStringLiteral("id"), event.id},
          {QStringLiteral("calendarId"), event.calendarId},
          {QStringLiteral("recurringRemoteId"), event.recurringRemoteId.value_or(QString())},
          {QStringLiteral("originalStartAt"), event.originalStartAt.value_or(QString())},
          {QStringLiteral("recurrenceRule"), event.recurrenceRule.value_or(QString())},
          {QStringLiteral("title"), event.title},
          {QStringLiteral("status"), event.status},
          {QStringLiteral("startAt"), event.startAt},
          {QStringLiteral("endAt"), event.endAt},
          {QStringLiteral("allDay"), event.allDay},
          {QStringLiteral("colorId"), event.colorId.value_or(QString())},
          {QStringLiteral("description"), event.description.value_or(QString())},
          {QStringLiteral("location"), event.location.value_or(QString())},
          {QStringLiteral("startTimeZone"), event.startTimeZone.value_or(QString())},
          {QStringLiteral("endTimeZone"), event.endTimeZone.value_or(QString())},
          {QStringLiteral("transparency"), event.transparency.value_or(QString())},
          {QStringLiteral("visibility"), event.visibility.value_or(QString())},
          {QStringLiteral("attendeeEmailsJson"), event.attendeeEmailsJson},
          {QStringLiteral("attendeeDetailsJson"), event.attendeeDetailsJson},
          {QStringLiteral("remindersJson"), event.remindersJson},
          {QStringLiteral("remindersUseDefault"), event.remindersUseDefault},
          {QStringLiteral("conferenceJson"), event.conferenceJson.value_or(QString())},
          {QStringLiteral("attachmentsJson"), event.attachmentsJson},
          {QStringLiteral("guestPermissionsJson"), event.guestPermissionsJson},
          {QStringLiteral("statusPropertiesJson"), event.statusPropertiesJson},
          {QStringLiteral("eventType"), event.eventType.value_or(QStringLiteral("default"))}};
}

[[nodiscard]] QVariantMap allDaySpanMap(const MonthGridModel::AllDaySpan& span) {
  QVariantMap result = eventMap(span.event);
  result.insert(QStringLiteral("weekIndex"), span.weekIndex);
  result.insert(QStringLiteral("startColumn"), span.startColumn);
  result.insert(QStringLiteral("daySpan"), span.daySpan);
  result.insert(QStringLiteral("laneIndex"), span.laneIndex);
  result.insert(QStringLiteral("startsBeforeRange"), span.startsBeforeRange);
  result.insert(QStringLiteral("endsAfterRange"), span.endsAfterRange);
  return result;
}

} // namespace

MonthGridModel::MonthGridModel(QObject* parent) : QAbstractTableModel(parent) {}

int MonthGridModel::rowCount(const QModelIndex& parent) const {
  return parent.isValid() || cells_.isEmpty() ? 0 : 6;
}

int MonthGridModel::columnCount(const QModelIndex& parent) const {
  return parent.isValid() ? 0 : 7;
}

QVariant MonthGridModel::data(const QModelIndex& index, int role) const {
  if (!index.isValid() || index.row() < 0 || index.row() >= rowCount() || index.column() < 0 ||
      index.column() >= columnCount()) {
    return {};
  }
  const Cell& cell = cells_.at(index.row() * columnCount() + index.column());
  switch (role) {
  case Qt::DisplayRole:
  case DateRole:
    return cell.date.toString(Qt::ISODate);
  case DayRole:
    return cell.date.day();
  case OutsideMonthRole:
    return cell.date.month() != month_.month() || cell.date.year() != month_.year();
  case EventCountRole:
    return cell.events.size();
  case EventsRole: {
    QVariantList events;
    events.reserve(cell.events.size());
    for (const CalendarEventSummary& event : cell.events) {
      events.append(eventMap(event));
    }
    return events;
  }
  case AllDayOverflowCountRole:
    return allDayOverflowCounts_.value(index.row() * columnCount() + index.column());
  default:
    return {};
  }
}

QHash<int, QByteArray> MonthGridModel::roleNames() const {
  return {{DateRole, "date"},
          {DayRole, "day"},
          {OutsideMonthRole, "outsideMonth"},
          {EventCountRole, "eventCount"},
          {EventsRole, "events"},
          {AllDayOverflowCountRole, "allDayOverflowCount"}};
}

QVariantList MonthGridModel::allDaySpans() const {
  QVariantList spans;
  spans.reserve(allDaySpans_.size());
  for (const AllDaySpan& span : allDaySpans_) {
    spans.append(allDaySpanMap(span));
  }
  return spans;
}

MonthGridModel::Layout MonthGridModel::buildLayout(QDate month,
                                                   const QList<CalendarEventSummary>& events,
                                                   const QTimeZone& displayTimeZone,
                                                   int weekStartDay) {
  QList<Cell> cells;
  QList<AllDaySpan> allDaySpans;
  QList<int> allDayOverflowCounts;
  if (month.isValid() && displayTimeZone.isValid() && (weekStartDay == 0 || weekStartDay == 1)) {
    const QDate firstDay(month.year(), month.month(), 1);
    const int firstQtDay = weekStartDay == 0 ? 7 : 1;
    const QDate gridStart = firstDay.addDays(-(firstDay.dayOfWeek() - firstQtDay + 7) % 7);
    cells.reserve(42);
    for (int dayOffset = 0; dayOffset < 42; ++dayOffset) {
      cells.append(Cell{.date = gridStart.addDays(dayOffset)});
    }
    for (const CalendarEventSummary& event : events) {
      const std::optional<QPair<QDate, QDate>> dates = eventDateRange(event, displayTimeZone);
      if (!dates.has_value()) {
        continue;
      }
      for (Cell& cell : cells) {
        if (cell.date >= dates->first && cell.date <= dates->second) {
          cell.events.append(event);
        }
      }
    }
    QList<CalendarAllDayLayoutEvent> allDayEvents;
    QList<CalendarEventSummary> allDaySources;
    const auto gridDayIndex = [&gridStart](const QDate& date) {
      const qint64 index = gridStart.daysTo(date);
      return static_cast<int>(std::clamp(index,
                                         static_cast<qint64>(std::numeric_limits<int>::min()),
                                         static_cast<qint64>(std::numeric_limits<int>::max())));
    };
    for (const CalendarEventSummary& event : events) {
      if (!event.allDay) {
        continue;
      }
      const std::optional<QPair<QDate, QDate>> dates = eventDateRange(event, displayTimeZone);
      if (!dates.has_value()) {
        continue;
      }
      allDayEvents.append({.id = QString::number(allDaySources.size()),
                           .startDayIndex = gridDayIndex(dates->first),
                           .endDayIndex = gridDayIndex(dates->second)});
      allDaySources.append(event);
    }
    const CalendarAllDayLayout layout = CalendarLayoutEngine::layoutAllDay(
        allDayEvents, 42, std::max(1, static_cast<int>(allDayEvents.size())));
    allDayOverflowCounts.fill(0, 42);
    for (const CalendarAllDaySegment& segment : layout.segments) {
      bool validIndex = false;
      const int sourceIndex = segment.id.toInt(&validIndex);
      if (!validIndex || sourceIndex < 0 || sourceIndex >= allDaySources.size()) {
        continue;
      }
      const int segmentEnd = segment.startDayIndex + segment.daySpan - 1;
      for (int start = segment.startDayIndex; start <= segmentEnd;) {
        const int weekEnd = (start / 7) * 7 + 6;
        const int end = std::min(segmentEnd, weekEnd);
        const bool startsBeforeRange = segment.startsBeforeRange || start > segment.startDayIndex;
        const bool endsAfterRange = segment.endsAfterRange || end < segmentEnd;
        allDaySpans.append({.event = allDaySources.at(sourceIndex),
                            .weekIndex = start / 7,
                            .startColumn = start % 7,
                            .daySpan = end - start + 1,
                            .laneIndex = segment.laneIndex,
                            .startsBeforeRange = startsBeforeRange,
                            .endsAfterRange = endsAfterRange});
        if (segment.laneIndex >= 3) {
          for (int day = start; day <= end; ++day) {
            ++allDayOverflowCounts[day];
          }
        }
        start = end + 1;
      }
    }
  }
  return {.month = month,
          .cells = std::move(cells),
          .allDaySpans = std::move(allDaySpans),
          .allDayOverflowCounts = std::move(allDayOverflowCounts)};
}

void MonthGridModel::applyLayout(Layout layout) {
  beginResetModel();
  month_ = layout.month;
  cells_ = std::move(layout.cells);
  allDaySpans_ = std::move(layout.allDaySpans);
  allDayOverflowCounts_ = std::move(layout.allDayOverflowCounts);
  endResetModel();
  emit allDaySpansChanged();
}

void MonthGridModel::setMonth(QDate month,
                              const QList<CalendarEventSummary>& events,
                              const QTimeZone& displayTimeZone,
                              int weekStartDay) {
  applyLayout(buildLayout(month, events, displayTimeZone, weekStartDay));
}

} // namespace hcb
