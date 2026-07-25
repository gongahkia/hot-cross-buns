#include "core/CalendarMutationService.h"

#include "data/LocalSchema.h"
#include "sqlite3.h"

#include <QByteArray>
#include <QDateTime>
#include <QString>
#include <QTimeZone>
#include <QUuid>

#include <chrono>
#include <future>
#include <initializer_list>
#include <optional>
#include <utility>
#include <variant>

namespace hcb {
namespace {

constexpr qsizetype kMaximumIdentifierLength = 256;
constexpr qsizetype kMaximumTitleLength = 500;
constexpr qsizetype kMaximumDescriptionLength = 20'000;
constexpr qsizetype kMaximumLocationLength = 1'000;
constexpr qsizetype kMaximumTimeZoneLength = 120;
constexpr qsizetype kMaximumTimestampLength = 64;

[[nodiscard]] AppError databaseError(const QString& message, int result) {
  return AppError(AppErrorCode::Database, message.arg(result));
}

[[nodiscard]] AppError validationError(QString message) {
  return AppError(AppErrorCode::Validation, std::move(message));
}

template <typename Result> [[nodiscard]] std::future<Result> readyFuture(Result result) {
  std::promise<Result> completion;
  std::future<Result> future = completion.get_future();
  completion.set_value(std::move(result));
  return future;
}

[[nodiscard]] bool isValidRequiredText(const QString& value, qsizetype maximumLength) {
  return !value.isEmpty() && value == value.trimmed() && value.size() <= maximumLength &&
         !value.contains(QChar::Null);
}

[[nodiscard]] bool isValidOptionalText(const std::optional<QString>& value,
                                       qsizetype maximumLength) {
  return !value.has_value() || (value->size() <= maximumLength && !value->contains(QChar::Null));
}

[[nodiscard]] std::optional<QString> canonicalTimestamp(const QString& value) {
  if (!isValidRequiredText(value, kMaximumTimestampLength) || !value.contains(u'T')) {
    return std::nullopt;
  }
  const QDateTime parsed = QDateTime::fromString(value, Qt::ISODateWithMs);
  if (!parsed.isValid()) {
    return std::nullopt;
  }
  return parsed.toUTC().toString(Qt::ISODateWithMs);
}

[[nodiscard]] bool isValidTimeZone(const std::optional<QString>& value) {
  return !value.has_value() || (isValidRequiredText(*value, kMaximumTimeZoneLength) &&
                                QTimeZone(value->toUtf8()).isValid());
}

[[nodiscard]] QString timestamp(const Clock& clock) {
  const auto milliseconds =
      std::chrono::duration_cast<std::chrono::milliseconds>(clock.wallNow().time_since_epoch());
  return QDateTime::fromMSecsSinceEpoch(milliseconds.count(), QTimeZone::UTC)
      .toString(Qt::ISODateWithMs);
}

[[nodiscard]] std::optional<AppError>
bindText(sqlite3_stmt* statement, int index, const QString& value) {
  const QByteArray utf8 = value.toUtf8();
  const int result = sqlite3_bind_text(
      statement, index, utf8.constData(), static_cast<int>(utf8.size()), SQLITE_TRANSIENT);
  if (result != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite calendar-event binding failed (%1)"), result);
  }
  return std::nullopt;
}

[[nodiscard]] std::optional<AppError>
bindOptionalText(sqlite3_stmt* statement, int index, const std::optional<QString>& value) {
  if (!value.has_value()) {
    const int result = sqlite3_bind_null(statement, index);
    if (result != SQLITE_OK) {
      return databaseError(QStringLiteral("SQLite calendar-event binding failed (%1)"), result);
    }
    return std::nullopt;
  }
  return bindText(statement, index, *value);
}

[[nodiscard]] std::optional<AppError> bindInteger(sqlite3_stmt* statement, int index, int value) {
  const int result = sqlite3_bind_int(statement, index, value);
  if (result != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite calendar-event binding failed (%1)"), result);
  }
  return std::nullopt;
}

[[nodiscard]] std::optional<AppError>
bindAll(sqlite3_stmt* statement, const std::initializer_list<std::optional<AppError>>& results) {
  for (const std::optional<AppError>& result : results) {
    if (result.has_value()) {
      sqlite3_finalize(statement);
      return result;
    }
  }
  return std::nullopt;
}

[[nodiscard]] std::variant<CalendarEventCreateInput, AppError>
canonicalize(CalendarEventCreateInput input) {
  input.title = input.title.trimmed();
  const std::optional<QString> startAt = canonicalTimestamp(input.startAt);
  const std::optional<QString> endAt = canonicalTimestamp(input.endAt);
  if (!isValidRequiredText(input.calendarId, kMaximumIdentifierLength) ||
      !isValidRequiredText(input.title, kMaximumTitleLength) ||
      !isValidOptionalText(input.description, kMaximumDescriptionLength) ||
      !isValidOptionalText(input.location, kMaximumLocationLength) ||
      !isValidTimeZone(input.startTimeZone) || !isValidTimeZone(input.endTimeZone) ||
      !startAt.has_value() || !endAt.has_value() ||
      QDateTime::fromString(*endAt, Qt::ISODateWithMs) <=
          QDateTime::fromString(*startAt, Qt::ISODateWithMs)) {
    return validationError(QStringLiteral("Calendar event create input is invalid"));
  }
  input.startAt = *startAt;
  input.endAt = *endAt;
  return input;
}

[[nodiscard]] std::variant<CalendarEventUpdateInput, AppError>
canonicalize(CalendarEventUpdateInput input) {
  if (input.title.has_value()) {
    *input.title = input.title->trimmed();
  }
  if (input.startAt.has_value()) {
    const std::optional<QString> startAt = canonicalTimestamp(*input.startAt);
    if (!startAt.has_value()) {
      return validationError(QStringLiteral("Calendar event update input is invalid"));
    }
    input.startAt = *startAt;
  }
  if (input.endAt.has_value()) {
    const std::optional<QString> endAt = canonicalTimestamp(*input.endAt);
    if (!endAt.has_value()) {
      return validationError(QStringLiteral("Calendar event update input is invalid"));
    }
    input.endAt = *endAt;
  }
  const bool hasPatch =
      input.calendarId.has_value() || input.title.has_value() || input.description.has_value() ||
      input.location.has_value() || input.startAt.has_value() || input.endAt.has_value() ||
      input.allDay.has_value() || input.startTimeZone.has_value() || input.endTimeZone.has_value();
  if (!isValidRequiredText(input.eventId, kMaximumIdentifierLength) ||
      (input.calendarId.has_value() &&
       !isValidRequiredText(*input.calendarId, kMaximumIdentifierLength)) ||
      (input.title.has_value() && !isValidRequiredText(*input.title, kMaximumTitleLength)) ||
      (input.description.has_value() &&
       !isValidOptionalText(*input.description, kMaximumDescriptionLength)) ||
      (input.location.has_value() &&
       !isValidOptionalText(*input.location, kMaximumLocationLength)) ||
      (input.startTimeZone.has_value() && !isValidTimeZone(*input.startTimeZone)) ||
      (input.endTimeZone.has_value() && !isValidTimeZone(*input.endTimeZone)) || !hasPatch) {
    return validationError(QStringLiteral("Calendar event update input is invalid"));
  }
  if (input.startAt.has_value() && input.endAt.has_value() &&
      QDateTime::fromString(*input.endAt, Qt::ISODateWithMs) <=
          QDateTime::fromString(*input.startAt, Qt::ISODateWithMs)) {
    return validationError(QStringLiteral("Calendar event update range is invalid"));
  }
  return input;
}

[[nodiscard]] CalendarEventMutationResult createStoredEvent(SqliteConnection& connection,
                                                            const CalendarEventCreateInput& input,
                                                            const QString& eventId,
                                                            const QString& remoteId,
                                                            const QString& updatedAt) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite calendar-event connection is unavailable"));
  }
  constexpr char sql[] = R"(
INSERT INTO local_calendar_events (
  id, calendar_id, remote_id, status, title, description, location, start_at, start_time_zone,
  end_at, end_time_zone, is_all_day, created_at, updated_at
)
SELECT ?1, calendars.id, ?3, 'confirmed', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12
FROM local_calendars AS calendars
WHERE calendars.id = ?2 AND calendars.deleted_at IS NULL
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite calendar-event create preparation failed (%1)"),
                         prepareResult);
  }
  if (const std::optional<AppError> error =
          bindAll(statement,
                  {bindText(statement, 1, eventId),
                   bindText(statement, 2, input.calendarId),
                   bindText(statement, 3, remoteId),
                   bindText(statement, 4, input.title),
                   bindOptionalText(statement, 5, input.description),
                   bindOptionalText(statement, 6, input.location),
                   bindText(statement, 7, input.startAt),
                   bindOptionalText(statement, 8, input.startTimeZone),
                   bindText(statement, 9, input.endAt),
                   bindOptionalText(statement, 10, input.endTimeZone),
                   bindInteger(statement, 11, input.allDay ? 1 : 0),
                   bindText(statement, 12, updatedAt)});
      error.has_value()) {
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  const int changedRows = sqlite3_changes(handle);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite calendar-event create failed (%1)"), stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite calendar-event create finalization failed (%1)"),
                         finalizeResult);
  }
  if (changedRows != 1) {
    return validationError(QStringLiteral("Calendar is unavailable for event creation"));
  }
  return CalendarEventMutationReceipt{.eventId = eventId, .updatedAt = updatedAt};
}

[[nodiscard]] CalendarEventMutationResult updateStoredEvent(SqliteConnection& connection,
                                                            const CalendarEventUpdateInput& input,
                                                            const QString& updatedAt) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite calendar-event connection is unavailable"));
  }
  constexpr char sql[] = R"(
UPDATE local_calendar_events
SET calendar_id = CASE WHEN ?2 = 1 THEN ?3 ELSE calendar_id END,
    title = CASE WHEN ?4 = 1 THEN ?5 ELSE title END,
    description = CASE WHEN ?6 = 1 THEN ?7 ELSE description END,
    location = CASE WHEN ?8 = 1 THEN ?9 ELSE location END,
    start_at = CASE WHEN ?10 = 1 THEN ?11 ELSE start_at END,
    end_at = CASE WHEN ?12 = 1 THEN ?13 ELSE end_at END,
    is_all_day = CASE WHEN ?14 = 1 THEN ?15 ELSE is_all_day END,
    start_time_zone = CASE WHEN ?16 = 1 THEN ?17 ELSE start_time_zone END,
    end_time_zone = CASE WHEN ?18 = 1 THEN ?19 ELSE end_time_zone END,
    updated_at = ?20
WHERE id = ?1
  AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM local_calendars AS source
              WHERE source.id = local_calendar_events.calendar_id
                AND source.deleted_at IS NULL)
  AND (?2 = 0 OR EXISTS (SELECT 1 FROM local_calendars AS target
                          INNER JOIN local_calendars AS source ON source.id = local_calendar_events.calendar_id
                          WHERE target.id = ?3
                            AND target.deleted_at IS NULL
                            AND source.deleted_at IS NULL
                            AND target.account_id = source.account_id))
  AND julianday(CASE WHEN ?10 = 1 THEN ?11 ELSE start_at END) IS NOT NULL
  AND julianday(CASE WHEN ?12 = 1 THEN ?13 ELSE end_at END) >
      julianday(CASE WHEN ?10 = 1 THEN ?11 ELSE start_at END)
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite calendar-event update preparation failed (%1)"),
                         prepareResult);
  }
  const std::optional<QString> description =
      input.description.has_value() ? *input.description : std::nullopt;
  const std::optional<QString> location =
      input.location.has_value() ? *input.location : std::nullopt;
  const std::optional<QString> startTimeZone =
      input.startTimeZone.has_value() ? *input.startTimeZone : std::nullopt;
  const std::optional<QString> endTimeZone =
      input.endTimeZone.has_value() ? *input.endTimeZone : std::nullopt;
  if (const std::optional<AppError> error =
          bindAll(statement,
                  {bindText(statement, 1, input.eventId),
                   bindInteger(statement, 2, input.calendarId.has_value()),
                   bindOptionalText(statement, 3, input.calendarId),
                   bindInteger(statement, 4, input.title.has_value()),
                   bindOptionalText(statement, 5, input.title),
                   bindInteger(statement, 6, input.description.has_value()),
                   bindOptionalText(statement, 7, description),
                   bindInteger(statement, 8, input.location.has_value()),
                   bindOptionalText(statement, 9, location),
                   bindInteger(statement, 10, input.startAt.has_value()),
                   bindOptionalText(statement, 11, input.startAt),
                   bindInteger(statement, 12, input.endAt.has_value()),
                   bindOptionalText(statement, 13, input.endAt),
                   bindInteger(statement, 14, input.allDay.has_value()),
                   bindInteger(statement, 15, input.allDay.value_or(false) ? 1 : 0),
                   bindInteger(statement, 16, input.startTimeZone.has_value()),
                   bindOptionalText(statement, 17, startTimeZone),
                   bindInteger(statement, 18, input.endTimeZone.has_value()),
                   bindOptionalText(statement, 19, endTimeZone),
                   bindText(statement, 20, updatedAt)});
      error.has_value()) {
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  const int changedRows = sqlite3_changes(handle);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite calendar-event update failed (%1)"), stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite calendar-event update finalization failed (%1)"),
                         finalizeResult);
  }
  if (changedRows != 1) {
    return validationError(QStringLiteral("Calendar event is unavailable for update"));
  }
  return CalendarEventMutationReceipt{.eventId = input.eventId, .updatedAt = updatedAt};
}

[[nodiscard]] CalendarEventMutationResult
removeStoredEvent(SqliteConnection& connection, const QString& eventId, const QString& updatedAt) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite calendar-event connection is unavailable"));
  }
  constexpr char sql[] = R"(
UPDATE local_calendar_events
SET deleted_at = ?2,
    updated_at = ?2
WHERE id = ?1 AND deleted_at IS NULL
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite calendar-event deletion preparation failed (%1)"),
                         prepareResult);
  }
  if (const std::optional<AppError> error =
          bindAll(statement, {bindText(statement, 1, eventId), bindText(statement, 2, updatedAt)});
      error.has_value()) {
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  const int changedRows = sqlite3_changes(handle);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite calendar-event deletion failed (%1)"), stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite calendar-event deletion finalization failed (%1)"),
                         finalizeResult);
  }
  if (changedRows != 1) {
    return validationError(QStringLiteral("Calendar event is unavailable for deletion"));
  }
  return CalendarEventMutationReceipt{.eventId = eventId, .updatedAt = updatedAt};
}

} // namespace

CalendarMutationService::CalendarMutationService(FilePath databasePath, const Clock& clock)
    : clock_(clock), writerQueue_(std::move(databasePath)),
      initialization_(writerQueue_
                          .enqueue([](SqliteConnection& connection) -> SqliteWriteResult {
                            const SqliteMigrationRunResultOrError result =
                                LocalSchema::initialize(connection);
                            return std::holds_alternative<AppError>(result)
                                       ? std::optional<AppError>(std::get<AppError>(result))
                                       : std::nullopt;
                          })
                          .share()) {}

std::shared_future<SqliteWriteResult> CalendarMutationService::ready() const {
  return initialization_;
}

std::future<CalendarEventMutationResult>
CalendarMutationService::create(CalendarEventCreateInput input) {
  const std::variant<CalendarEventCreateInput, AppError> canonical = canonicalize(std::move(input));
  if (std::holds_alternative<AppError>(canonical)) {
    return readyFuture(CalendarEventMutationResult(std::get<AppError>(canonical)));
  }
  const QString localId = QUuid::createUuid().toString(QUuid::WithoutBraces);
  const QString eventId = QStringLiteral("event:") + localId;
  const QString remoteId = QStringLiteral("pending:") + localId;
  const QString updatedAt = timestamp(clock_);
  return writerQueue_.enqueueResult(
      [input = std::get<CalendarEventCreateInput>(canonical), eventId, remoteId, updatedAt](
          SqliteConnection& connection) {
        return createStoredEvent(connection, input, eventId, remoteId, updatedAt);
      });
}

std::future<CalendarEventMutationResult>
CalendarMutationService::update(CalendarEventUpdateInput input) {
  const std::variant<CalendarEventUpdateInput, AppError> canonical = canonicalize(std::move(input));
  if (std::holds_alternative<AppError>(canonical)) {
    return readyFuture(CalendarEventMutationResult(std::get<AppError>(canonical)));
  }
  const QString updatedAt = timestamp(clock_);
  return writerQueue_.enqueueResult([input = std::get<CalendarEventUpdateInput>(canonical),
                                     updatedAt](SqliteConnection& connection) {
    return updateStoredEvent(connection, input, updatedAt);
  });
}

std::future<CalendarEventMutationResult> CalendarMutationService::remove(QString eventId) {
  if (!isValidRequiredText(eventId, kMaximumIdentifierLength)) {
    return readyFuture(CalendarEventMutationResult(
        validationError(QStringLiteral("Calendar event deletion input is invalid"))));
  }
  const QString updatedAt = timestamp(clock_);
  return writerQueue_.enqueueResult(
      [eventId = std::move(eventId), updatedAt](SqliteConnection& connection) {
        return removeStoredEvent(connection, eventId, updatedAt);
      });
}

} // namespace hcb
