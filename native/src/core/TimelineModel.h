#pragma once

#include "core/CalendarReadService.h"

#include <QAbstractListModel>
#include <QDate>
#include <QTimeZone>

#include <cstdint>

namespace hcb {

class TimelineModel final : public QAbstractListModel {
  Q_OBJECT

public:
  enum Role : std::int32_t {
    IdRole = Qt::UserRole + 1,
    CalendarIdRole,
    TitleRole,
    StatusRole,
    ColorIdRole,
    AllDayRole,
    DayIndexRole,
    StartMinuteRole,
    DurationMinutesRole,
    LaneIndexRole,
    LaneCountRole,
    DaySpanRole,
    StartsBeforeRangeRole,
    EndsAfterRangeRole
  };
  Q_ENUM(Role)

  explicit TimelineModel(QObject* parent = nullptr);

  [[nodiscard]] int rowCount(const QModelIndex& parent = QModelIndex()) const override;
  [[nodiscard]] QVariant data(const QModelIndex& index, int role = Qt::DisplayRole) const override;
  [[nodiscard]] QHash<int, QByteArray> roleNames() const override;

  void setRange(QDate startDate,
                int dayCount,
                const QList<CalendarEventSummary>& events,
                const QTimeZone& displayTimeZone,
                int visibleAllDayLaneCount);

private:
  struct Item final {
    CalendarEventSummary event;
    bool allDay{false};
    int dayIndex{0};
    int startMinute{0};
    int durationMinutes{0};
    int laneIndex{0};
    int laneCount{1};
    int daySpan{1};
    bool startsBeforeRange{false};
    bool endsAfterRange{false};
  };

  QList<Item> items_;
};

} // namespace hcb
