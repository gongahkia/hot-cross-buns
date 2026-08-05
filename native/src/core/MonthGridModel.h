#pragma once

#include "core/CalendarReadService.h"

#include <QAbstractTableModel>
#include <QDate>
#include <QTimeZone>
#include <QVariantList>

#include <cstdint>

namespace hcb {

class MonthGridModel final : public QAbstractTableModel {
  Q_OBJECT
  Q_PROPERTY(QVariantList allDaySpans READ allDaySpans NOTIFY allDaySpansChanged)

public:
  enum Role : std::int32_t {
    DateRole = Qt::UserRole + 1,
    DayRole,
    OutsideMonthRole,
    EventCountRole,
    EventsRole,
    AllDayOverflowCountRole
  };
  Q_ENUM(Role)

  explicit MonthGridModel(QObject* parent = nullptr);

  [[nodiscard]] int rowCount(const QModelIndex& parent = QModelIndex()) const override;
  [[nodiscard]] int columnCount(const QModelIndex& parent = QModelIndex()) const override;
  [[nodiscard]] QVariant data(const QModelIndex& index, int role = Qt::DisplayRole) const override;
  [[nodiscard]] QHash<int, QByteArray> roleNames() const override;
  [[nodiscard]] QVariantList allDaySpans() const;

  struct Cell final {
    QDate date;
    QList<CalendarEventSummary> events;
  };

  struct AllDaySpan final {
    CalendarEventSummary event;
    int weekIndex{0};
    int startColumn{0};
    int daySpan{1};
    int laneIndex{0};
    bool startsBeforeRange{false};
    bool endsAfterRange{false};
  };

  struct Layout final {
    QDate month;
    QList<Cell> cells;
    QList<AllDaySpan> allDaySpans;
    QList<int> allDayOverflowCounts;
  };

  [[nodiscard]] static Layout buildLayout(QDate month,
                                          const QList<CalendarEventSummary>& events,
                                          const QTimeZone& displayTimeZone,
                                          int weekStartDay = 0);
  void applyLayout(Layout layout);

  void setMonth(QDate month,
                const QList<CalendarEventSummary>& events,
                const QTimeZone& displayTimeZone,
                int weekStartDay = 0);

signals:
  void allDaySpansChanged();

private:
  QDate month_;
  QList<Cell> cells_;
  QList<AllDaySpan> allDaySpans_;
  QList<int> allDayOverflowCounts_;
};

} // namespace hcb
