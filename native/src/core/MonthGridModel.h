#pragma once

#include "core/CalendarReadService.h"

#include <QAbstractTableModel>
#include <QDate>
#include <QTimeZone>

#include <cstdint>

namespace hcb {

class MonthGridModel final : public QAbstractTableModel {
  Q_OBJECT

public:
  enum Role : std::int32_t {
    DateRole = Qt::UserRole + 1,
    DayRole,
    OutsideMonthRole,
    EventCountRole,
    EventsRole
  };
  Q_ENUM(Role)

  explicit MonthGridModel(QObject* parent = nullptr);

  [[nodiscard]] int rowCount(const QModelIndex& parent = QModelIndex()) const override;
  [[nodiscard]] int columnCount(const QModelIndex& parent = QModelIndex()) const override;
  [[nodiscard]] QVariant data(const QModelIndex& index, int role = Qt::DisplayRole) const override;
  [[nodiscard]] QHash<int, QByteArray> roleNames() const override;

  void setMonth(QDate month,
                const QList<CalendarEventSummary>& events,
                const QTimeZone& displayTimeZone);

private:
  struct Cell final {
    QDate date;
    QList<CalendarEventSummary> events;
  };

  QDate month_;
  QList<Cell> cells_;
};

} // namespace hcb
