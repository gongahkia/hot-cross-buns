#include "core/AgendaModel.h"
#include "core/ModelDiffPolicy.h"

#include <utility>

namespace hcb {

namespace {

[[nodiscard]] bool equivalentEvent(const CalendarEventSummary& left,
                                   const CalendarEventSummary& right) {
  return left.id == right.id && left.calendarId == right.calendarId &&
         left.remoteId == right.remoteId && left.recurringRemoteId == right.recurringRemoteId &&
         left.originalStartAt == right.originalStartAt && left.status == right.status &&
         left.title == right.title && left.description == right.description &&
         left.location == right.location && left.startAt == right.startAt &&
         left.startTimeZone == right.startTimeZone && left.endAt == right.endAt &&
         left.endTimeZone == right.endTimeZone && left.allDay == right.allDay &&
         left.recurrenceRule == right.recurrenceRule && left.colorId == right.colorId &&
         left.transparency == right.transparency && left.visibility == right.visibility &&
         left.timeZone == right.timeZone && left.hcbKind == right.hcbKind &&
         left.attendeeEmailsJson == right.attendeeEmailsJson &&
         left.remindersJson == right.remindersJson &&
         left.remindersUseDefault == right.remindersUseDefault &&
         left.etag == right.etag && left.sequence == right.sequence &&
         left.remoteUpdatedAt == right.remoteUpdatedAt && left.updatedAt == right.updatedAt;
}

} // namespace

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
  case RecurrenceRuleRole:
    return event.recurrenceRule.value_or(QString());
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
  case AttendeeEmailsJsonRole:
    return event.attendeeEmailsJson;
  case RemindersJsonRole:
    return event.remindersJson;
  case RemindersUseDefaultRole:
    return event.remindersUseDefault;
  default:
    return {};
  }
}

QHash<int, QByteArray> AgendaModel::roleNames() const {
  return {{IdRole, "id"},
          {CalendarIdRole, "calendarId"},
          {RecurringRemoteIdRole, "recurringRemoteId"},
          {OriginalStartAtRole, "originalStartAt"},
          {RecurrenceRuleRole, "recurrenceRule"},
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
          {HcbKindRole, "hcbKind"},
          {AttendeeEmailsJsonRole, "attendeeEmailsJson"},
          {RemindersJsonRole, "remindersJson"},
          {RemindersUseDefaultRole, "remindersUseDefault"}};
}

void AgendaModel::setEvents(QList<CalendarEventSummary> events) {
  const ModelDiffPlan plan = ModelDiffPolicy::plan(
      events_,
      events,
      [](const CalendarEventSummary& event) -> const QString& { return event.id; },
      equivalentEvent);
  if (plan.requiresReset) {
    beginResetModel();
    events_ = std::move(events);
    endResetModel();
    return;
  }
  events_ = std::move(events);
  for (const ModelDataChangeRange& range : plan.changedRanges) {
    emit dataChanged(index(range.firstRow, 0), index(range.lastRow, 0));
  }
}

} // namespace hcb
