#include "core/CalendarSourceModel.h"

#include <utility>

namespace hcb {

CalendarSourceModel::CalendarSourceModel(QObject* parent) : QAbstractListModel(parent) {}

int CalendarSourceModel::rowCount(const QModelIndex& parent) const {
  return parent.isValid() ? 0 : static_cast<int>(calendars_.size());
}

QVariant CalendarSourceModel::data(const QModelIndex& index, int role) const {
  if (!index.isValid() || index.row() < 0 || index.row() >= static_cast<int>(calendars_.size())) {
    return {};
  }
  const CalendarSummary& calendar = calendars_.at(index.row());
  switch (role) {
  case Qt::DisplayRole:
  case TitleRole:
    return calendar.title;
  case IdRole:
    return calendar.id;
  case AccountIdRole:
    return calendar.accountId;
  case DescriptionRole:
    return calendar.description.value_or(QString());
  case TimeZoneRole:
    return calendar.timeZone.value_or(QString());
  case BackgroundColorRole:
    return calendar.backgroundColor.value_or(QString());
  case ForegroundColorRole:
    return calendar.foregroundColor.value_or(QString());
  case AccessRoleRole:
    return calendar.accessRole.value_or(QString());
  case SelectedRole:
    return calendar.selected;
  case PrimaryRole:
    return calendar.primary;
  case EventCountRole:
    return calendar.eventCount;
  default:
    return {};
  }
}

QHash<int, QByteArray> CalendarSourceModel::roleNames() const {
  return {{IdRole, "id"},
          {AccountIdRole, "accountId"},
          {TitleRole, "title"},
          {DescriptionRole, "description"},
          {TimeZoneRole, "timeZone"},
          {BackgroundColorRole, "backgroundColor"},
          {ForegroundColorRole, "foregroundColor"},
          {AccessRoleRole, "accessRole"},
          {SelectedRole, "selected"},
          {PrimaryRole, "primary"},
          {EventCountRole, "eventCount"}};
}

void CalendarSourceModel::setCalendars(QList<CalendarSummary> calendars) {
  beginResetModel();
  calendars_ = std::move(calendars);
  endResetModel();
}

} // namespace hcb
