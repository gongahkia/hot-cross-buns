#include "core/MonthGridModel.h"

#include <QDateTime>
#include <QVariantList>
#include <QVariantMap>

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
          {QStringLiteral("remindersJson"), event.remindersJson},
          {QStringLiteral("remindersUseDefault"), event.remindersUseDefault}};
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
  default:
    return {};
  }
}

QHash<int, QByteArray> MonthGridModel::roleNames() const {
  return {{DateRole, "date"},
          {DayRole, "day"},
          {OutsideMonthRole, "outsideMonth"},
          {EventCountRole, "eventCount"},
          {EventsRole, "events"}};
}

MonthGridModel::Layout MonthGridModel::buildLayout(QDate month,
                                                   const QList<CalendarEventSummary>& events,
                                                   const QTimeZone& displayTimeZone) {
  QList<Cell> cells;
  if (month.isValid() && displayTimeZone.isValid()) {
    const QDate firstDay(month.year(), month.month(), 1);
    const QDate gridStart = firstDay.addDays(-firstDay.dayOfWeek() % 7);
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
  }
  return {.month = month, .cells = std::move(cells)};
}

void MonthGridModel::applyLayout(Layout layout) {
  beginResetModel();
  month_ = layout.month;
  cells_ = std::move(layout.cells);
  endResetModel();
}

void MonthGridModel::setMonth(QDate month,
                              const QList<CalendarEventSummary>& events,
                              const QTimeZone& displayTimeZone) {
  applyLayout(buildLayout(month, events, displayTimeZone));
}

} // namespace hcb
