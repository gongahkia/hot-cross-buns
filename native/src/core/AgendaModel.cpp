#include "core/AgendaModel.h"

#include <utility>

namespace hcb {

AgendaModel::AgendaModel(QObject* parent) : QAbstractListModel(parent) {}

int AgendaModel::rowCount(const QModelIndex& parent) const {
  return parent.isValid() ? 0 : static_cast<int>(events_.size());
}

QVariant AgendaModel::data(const QModelIndex& index, int role) const {
  if (!index.isValid() || index.row() < 0 || index.row() >= static_cast<int>(events_.size())) {
    return {};
  }
  const CalendarEventSummary& event = events_.at(index.row());
  switch (role) {
  case Qt::DisplayRole:
  case TitleRole:
    return event.title;
  case IdRole:
    return event.id;
  case CalendarIdRole:
    return event.calendarId;
  case RecurringRemoteIdRole:
    return event.recurringRemoteId.value_or(QString());
  case OriginalStartAtRole:
    return event.originalStartAt.value_or(QString());
  case StatusRole:
    return event.status;
  case DescriptionRole:
    return event.description.value_or(QString());
  case LocationRole:
    return event.location.value_or(QString());
  case StartAtRole:
    return event.startAt;
  case StartTimeZoneRole:
    return event.startTimeZone.value_or(QString());
  case EndAtRole:
    return event.endAt;
  case EndTimeZoneRole:
    return event.endTimeZone.value_or(QString());
  case AllDayRole:
    return event.allDay;
  case ColorIdRole:
    return event.colorId.value_or(QString());
  case TransparencyRole:
    return event.transparency.value_or(QString());
  case VisibilityRole:
    return event.visibility.value_or(QString());
  case HcbKindRole:
    return event.hcbKind.value_or(QString());
  default:
    return {};
  }
}

QHash<int, QByteArray> AgendaModel::roleNames() const {
  return {{IdRole, "id"},
          {CalendarIdRole, "calendarId"},
          {RecurringRemoteIdRole, "recurringRemoteId"},
          {OriginalStartAtRole, "originalStartAt"},
          {StatusRole, "status"},
          {TitleRole, "title"},
          {DescriptionRole, "description"},
          {LocationRole, "location"},
          {StartAtRole, "startAt"},
          {StartTimeZoneRole, "startTimeZone"},
          {EndAtRole, "endAt"},
          {EndTimeZoneRole, "endTimeZone"},
          {AllDayRole, "allDay"},
          {ColorIdRole, "colorId"},
          {TransparencyRole, "transparency"},
          {VisibilityRole, "visibility"},
          {HcbKindRole, "hcbKind"}};
}

void AgendaModel::setEvents(QList<CalendarEventSummary> events) {
  beginResetModel();
  events_ = std::move(events);
  endResetModel();
}

} // namespace hcb
