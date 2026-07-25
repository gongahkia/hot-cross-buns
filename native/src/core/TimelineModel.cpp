#include "core/TimelineModel.h"

#include "core/CalendarLayoutEngine.h"

#include <QDateTime>
#include <QHash>

#include <algorithm>
#include <optional>
#include <utility>

namespace hcb {

namespace {

constexpr int kMinutesPerDay = 24 * 60;

struct EventRange final {
  QDateTime start;
  QDateTime end;
  QDate firstDate;
  QDate lastDate;
};

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

[[nodiscard]] std::optional<EventRange> eventRange(const CalendarEventSummary& event,
                                                   const QTimeZone& displayTimeZone) {
  const std::optional<QDateTime> start = parseDateTime(event.startAt, displayTimeZone);
  const std::optional<QDateTime> end = parseDateTime(event.endAt, displayTimeZone);
  if (!start.has_value() || !end.has_value() || *end <= *start) {
    return std::nullopt;
  }
  QDate lastDate = end->date();
  if (end->time() == QTime(0, 0)) {
    lastDate = lastDate.addDays(-1);
  }
  if (lastDate < start->date()) {
    return std::nullopt;
  }
  return EventRange{.start = *start, .end = *end, .firstDate = start->date(), .lastDate = lastDate};
}

[[nodiscard]] int minuteOfDay(const QDateTime& value, bool roundUp) {
  const QTime time = value.time();
  const int minute = time.hour() * 60 + time.minute();
  return roundUp && (time.second() > 0 || time.msec() > 0) ? minute + 1 : minute;
}

} // namespace

TimelineModel::TimelineModel(QObject* parent) : QAbstractListModel(parent) {}

int TimelineModel::rowCount(const QModelIndex& parent) const {
  return parent.isValid() ? 0 : static_cast<int>(items_.size());
}

QVariant TimelineModel::data(const QModelIndex& index, int role) const {
  if (!index.isValid() || index.row() < 0 || index.row() >= static_cast<int>(items_.size())) {
    return {};
  }
  const Item& item = items_.at(index.row());
  switch (role) {
  case Qt::DisplayRole:
  case TitleRole:
    return item.event.title;
  case IdRole:
    return item.event.id;
  case CalendarIdRole:
    return item.event.calendarId;
  case StatusRole:
    return item.event.status;
  case ColorIdRole:
    return item.event.colorId.value_or(QString());
  case AllDayRole:
    return item.allDay;
  case DayIndexRole:
    return item.dayIndex;
  case StartMinuteRole:
    return item.startMinute;
  case DurationMinutesRole:
    return item.durationMinutes;
  case LaneIndexRole:
    return item.laneIndex;
  case LaneCountRole:
    return item.laneCount;
  case DaySpanRole:
    return item.daySpan;
  case StartsBeforeRangeRole:
    return item.startsBeforeRange;
  case EndsAfterRangeRole:
    return item.endsAfterRange;
  default:
    return {};
  }
}

QHash<int, QByteArray> TimelineModel::roleNames() const {
  return {{IdRole, "id"},
          {CalendarIdRole, "calendarId"},
          {TitleRole, "title"},
          {StatusRole, "status"},
          {ColorIdRole, "colorId"},
          {AllDayRole, "allDay"},
          {DayIndexRole, "dayIndex"},
          {StartMinuteRole, "startMinute"},
          {DurationMinutesRole, "durationMinutes"},
          {LaneIndexRole, "laneIndex"},
          {LaneCountRole, "laneCount"},
          {DaySpanRole, "daySpan"},
          {StartsBeforeRangeRole, "startsBeforeRange"},
          {EndsAfterRangeRole, "endsAfterRange"}};
}

QVariantMap
TimelineModel::moveInput(const QString& eventId, int targetDayIndex, int targetMinute) const {
  if (eventId.isEmpty() || !rangeStartDate_.isValid() || dayCount_ < 1 || targetDayIndex < 0 ||
      targetDayIndex >= dayCount_ || targetMinute < 0 || targetMinute >= kMinutesPerDay ||
      !displayTimeZone_.isValid()) {
    return {};
  }
  const auto item = std::find_if(items_.cbegin(), items_.cend(), [&eventId](const Item& candidate) {
    return candidate.event.id == eventId && !candidate.allDay;
  });
  if (item == items_.cend()) {
    return {};
  }
  const std::optional<EventRange> range = eventRange(item->event, displayTimeZone_);
  if (!range.has_value()) {
    return {};
  }
  const QDate targetDate = rangeStartDate_.addDays(targetDayIndex);
  const QTime targetTime(targetMinute / 60, targetMinute % 60);
  const QDateTime targetStart(targetDate, targetTime, displayTimeZone_);
  if (!targetStart.isValid()) {
    return {};
  }
  const QDateTime targetEnd = targetStart.addMSecs(range->start.msecsTo(range->end));
  if (!targetEnd.isValid() || targetEnd <= targetStart) {
    return {};
  }
  return {{QStringLiteral("id"), item->event.id},
          {QStringLiteral("startAt"), targetStart.toUTC().toString(Qt::ISODateWithMs)},
          {QStringLiteral("endAt"), targetEnd.toUTC().toString(Qt::ISODateWithMs)},
          {QStringLiteral("allDay"), false}};
}

QVariantMap TimelineModel::resizeInput(const QString& eventId,
                                       int targetEndDayIndex,
                                       int targetEndMinute) const {
  if (eventId.isEmpty() || !rangeStartDate_.isValid() || dayCount_ < 1 || targetEndDayIndex < 0 ||
      targetEndDayIndex >= dayCount_ || targetEndMinute < 0 || targetEndMinute > kMinutesPerDay ||
      !displayTimeZone_.isValid()) {
    return {};
  }
  const auto item = std::find_if(items_.cbegin(), items_.cend(), [&eventId](const Item& candidate) {
    return candidate.event.id == eventId && !candidate.allDay;
  });
  if (item == items_.cend()) {
    return {};
  }
  const std::optional<EventRange> range = eventRange(item->event, displayTimeZone_);
  if (!range.has_value()) {
    return {};
  }
  QDate targetDate = rangeStartDate_.addDays(targetEndDayIndex);
  if (targetEndMinute == kMinutesPerDay) {
    targetDate = targetDate.addDays(1);
  }
  const QTime targetTime(targetEndMinute % kMinutesPerDay / 60,
                         targetEndMinute % kMinutesPerDay % 60);
  const QDateTime targetEnd(targetDate, targetTime, displayTimeZone_);
  if (!targetEnd.isValid() || targetEnd <= range->start) {
    return {};
  }
  return {{QStringLiteral("id"), item->event.id},
          {QStringLiteral("endAt"), targetEnd.toUTC().toString(Qt::ISODateWithMs)}};
}

void TimelineModel::setRange(QDate startDate,
                             int dayCount,
                             const QList<CalendarEventSummary>& events,
                             const QTimeZone& displayTimeZone,
                             int visibleAllDayLaneCount) {
  QList<Item> items;
  rangeStartDate_ = startDate;
  dayCount_ = dayCount;
  displayTimeZone_ = displayTimeZone;
  if (startDate.isValid() && dayCount >= 1 && dayCount <= 7 && displayTimeZone.isValid() &&
      visibleAllDayLaneCount >= 0) {
    QList<CalendarAllDayLayoutEvent> allDayEvents;
    QList<CalendarEventSummary> allDaySources;
    QHash<QString, int> allDaySourceIndexes;
    for (const CalendarEventSummary& event : events) {
      if (!event.allDay) {
        continue;
      }
      const std::optional<EventRange> range = eventRange(event, displayTimeZone);
      if (!range.has_value()) {
        continue;
      }
      const QString layoutId = QStringLiteral("all-day-%1").arg(allDaySources.size());
      allDayEvents.append({.id = layoutId,
                           .startDayIndex = static_cast<int>(startDate.daysTo(range->firstDate)),
                           .endDayIndex = static_cast<int>(startDate.daysTo(range->lastDate))});
      allDaySourceIndexes.insert(layoutId, static_cast<int>(allDaySources.size()));
      allDaySources.append(event);
    }
    const CalendarAllDayLayout allDayLayout = CalendarLayoutEngine::layoutAllDay(
        std::move(allDayEvents), dayCount, visibleAllDayLaneCount);
    for (const CalendarAllDaySegment& segment : allDayLayout.segments) {
      const int sourceIndex = allDaySourceIndexes.value(segment.id, -1);
      if (sourceIndex < 0 || sourceIndex >= allDaySources.size()) {
        continue;
      }
      items.append({.event = allDaySources.at(sourceIndex),
                    .allDay = true,
                    .dayIndex = segment.startDayIndex,
                    .laneIndex = segment.laneIndex,
                    .daySpan = segment.daySpan,
                    .startsBeforeRange = segment.startsBeforeRange,
                    .endsAfterRange = segment.endsAfterRange});
    }

    int layoutIdentifier = 0;
    for (int dayIndex = 0; dayIndex < dayCount; ++dayIndex) {
      const QDate date = startDate.addDays(dayIndex);
      const QDateTime dayStart(date, QTime(0, 0), displayTimeZone);
      const QDateTime dayEnd = dayStart.addDays(1);
      QList<CalendarTimedLayoutEvent> timedEvents;
      QList<Item> timedSources;
      QHash<QString, int> timedSourceIndexes;
      for (const CalendarEventSummary& event : events) {
        if (event.allDay) {
          continue;
        }
        const std::optional<EventRange> range = eventRange(event, displayTimeZone);
        if (!range.has_value() || range->lastDate < date || range->firstDate > date) {
          continue;
        }
        const QDateTime segmentStart = std::max(range->start, dayStart);
        const QDateTime segmentEnd = std::min(range->end, dayEnd);
        const int startMinute = minuteOfDay(segmentStart, false);
        const int endMinute = segmentEnd == dayEnd ? kMinutesPerDay : minuteOfDay(segmentEnd, true);
        if (endMinute <= startMinute) {
          continue;
        }
        const QString layoutId = QStringLiteral("timed-%1").arg(layoutIdentifier++);
        timedEvents.append({.id = layoutId, .startMinute = startMinute, .endMinute = endMinute});
        timedSourceIndexes.insert(layoutId, static_cast<int>(timedSources.size()));
        timedSources.append({.event = event, .dayIndex = dayIndex});
      }
      const QList<CalendarTimedLayout> timedLayout =
          CalendarLayoutEngine::layoutTimed(std::move(timedEvents));
      for (const CalendarTimedLayout& layout : timedLayout) {
        const int sourceIndex = timedSourceIndexes.value(layout.id, -1);
        if (sourceIndex < 0 || sourceIndex >= timedSources.size()) {
          continue;
        }
        Item item = timedSources.at(sourceIndex);
        item.startMinute = layout.startMinute;
        item.durationMinutes = layout.durationMinutes;
        item.laneIndex = layout.laneIndex;
        item.laneCount = layout.laneCount;
        items.append(std::move(item));
      }
    }
  }
  beginResetModel();
  items_ = std::move(items);
  endResetModel();
}

} // namespace hcb
