#pragma once

#include "core/AppError.h"
#include "core/Clock.h"
#include "core/FilePath.h"
#include "data/SqliteWriterQueue.h"

#include <QList>
#include <QString>

#include <future>
#include <optional>
#include <variant>

namespace hcb {

struct CalendarEventReminder final {
  QString method;
  int minutes{0};
};

struct CalendarEventReminderSettings final {
  bool useDefault{true};
  QList<CalendarEventReminder> overrides;
};

struct CalendarEventCreateInput final {
  QString calendarId;
  QString title;
  QString startAt;
  QString endAt;
  bool allDay{false};
  std::optional<QString> description;
  std::optional<QString> location;
  std::optional<QString> startTimeZone;
  std::optional<QString> endTimeZone;
  std::optional<QString> colorId;
  std::optional<QString> transparency;
  std::optional<QString> visibility;
  QList<QString> attendeeEmails;
  CalendarEventReminderSettings reminders;
};

struct CalendarEventUpdateInput final {
  QString eventId;
  std::optional<QString> calendarId;
  std::optional<QString> title;
  std::optional<std::optional<QString>> description;
  std::optional<std::optional<QString>> location;
  std::optional<QString> startAt;
  std::optional<QString> endAt;
  std::optional<bool> allDay;
  std::optional<std::optional<QString>> startTimeZone;
  std::optional<std::optional<QString>> endTimeZone;
  std::optional<std::optional<QString>> colorId;
  std::optional<QString> transparency;
  std::optional<QString> visibility;
  std::optional<QList<QString>> attendeeEmails;
  std::optional<CalendarEventReminderSettings> reminders;
};

struct CalendarEventMutationReceipt final {
  QString eventId;
  QString updatedAt;
};

struct CalendarEventRemoteReconciliationInput final {
  QString localEventId;
  QString remoteEventId;
  std::optional<QString> remoteEtag;
};

struct CalendarEventMutationSnapshot final {
  QString eventId;
  QString accountId;
  QString calendarId;
  std::optional<QString> calendarAccessRole;
  QString status;
  std::optional<QString> recurringRemoteId;
  std::optional<QString> recurrenceRule;
  std::optional<QString> eventType;
  QString startAt;
  QString endAt;
  bool allDay{false};
  std::optional<QString> colorId;
  std::optional<QString> transparency;
  std::optional<QString> visibility;
  QString attendeeEmailsJson;
  QString remindersJson;
  bool remindersUseDefault{true};
};

using CalendarEventMutationResult = std::variant<CalendarEventMutationReceipt, AppError>;
using CalendarEventMutationSnapshotResult =
    std::variant<QList<CalendarEventMutationSnapshot>, AppError>;

class CalendarMutationService final {
public:
  CalendarMutationService(FilePath databasePath, const Clock& clock);
  CalendarMutationService(const CalendarMutationService&) = delete;
  CalendarMutationService& operator=(const CalendarMutationService&) = delete;

  [[nodiscard]] std::shared_future<SqliteWriteResult> ready() const;
  [[nodiscard]] std::future<CalendarEventMutationResult> create(CalendarEventCreateInput input);
  [[nodiscard]] std::future<CalendarEventMutationResult> update(CalendarEventUpdateInput input);
  [[nodiscard]] std::future<CalendarEventMutationResult> remove(QString eventId);
  [[nodiscard]] std::future<CalendarEventMutationSnapshotResult> inspect(QList<QString> eventIds);
  [[nodiscard]] std::future<CalendarEventMutationResult>
  reconcileGoogleEvent(CalendarEventRemoteReconciliationInput input);

private:
  const Clock& clock_;
  SqliteWriterQueue writerQueue_;
  std::shared_future<SqliteWriteResult> initialization_;
};

} // namespace hcb
