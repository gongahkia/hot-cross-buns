#pragma once

#include "core/CalendarReadService.h"

#include <QAbstractListModel>

#include <cstdint>

namespace hcb {

class CalendarSourceModel final : public QAbstractListModel {
  Q_OBJECT

public:
  enum Role : std::int32_t {
    IdRole = Qt::UserRole + 1,
    AccountIdRole,
    TitleRole,
    DescriptionRole,
    TimeZoneRole,
    BackgroundColorRole,
    ForegroundColorRole,
    AccessRoleRole,
    SelectedRole,
    PrimaryRole,
    EventCountRole
  };
  Q_ENUM(Role)

  explicit CalendarSourceModel(QObject* parent = nullptr);

  [[nodiscard]] int rowCount(const QModelIndex& parent = QModelIndex()) const override;
  [[nodiscard]] QVariant data(const QModelIndex& index, int role = Qt::DisplayRole) const override;
  [[nodiscard]] QHash<int, QByteArray> roleNames() const override;

  void setCalendars(QList<CalendarSummary> calendars);

private:
  QList<CalendarSummary> calendars_;
};

} // namespace hcb
