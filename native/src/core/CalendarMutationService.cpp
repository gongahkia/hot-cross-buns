#include "core/CalendarMutationService.h"

#include "data/LocalSchema.h"
#include "data/SqliteTransaction.h"
#include "sqlite3.h"

#include <QByteArray>
#include <QDateTime>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSet>
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
constexpr qsizetype kMaximumColorIdLength = 32;
constexpr char kConflictMetadataKey[] = "_hcbSync";

struct StoredEventContext final {
  QString eventId;
  QString accountId;
  QString calendarId;
  QString calendarRemoteId;
  std::optional<QString> calendarAccessRole;
  QString remoteId;
  std::optional<QString> remoteEtag;
  QString title;
  std::optional<QString> description;
  std::optional<QString> location;
  QString startAt;
  std::optional<QString> startTimeZone;
  QString endAt;
  std::optional<QString> endTimeZone;
  bool allDay{false};
  std::optional<QString> recurrenceRule;
  std::optional<QString> recurringRemoteId;
  QString status;
  std::optional<QString> colorId;
  std::optional<QString> transparency;
  std::optional<QString> visibility;
  std::optional<QString> eventType;
};

struct ActiveEventMutation final {
  QString id;
  QString operation;
  QJsonObject payload;
};

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

[[nodiscard]] bool isValidColorId(const QString& value) {
  return isValidRequiredText(value, kMaximumColorIdLength);
}

[[nodiscard]] bool isValidTransparency(const QString& value) {
  return value == QStringLiteral("opaque") || value == QStringLiteral("transparent");
}

[[nodiscard]] bool isValidVisibility(const QString& value) {
  return value == QStringLiteral("default") || value == QStringLiteral("public") ||
         value == QStringLiteral("private");
}

[[nodiscard]] bool isWritableCalendar(const std::optional<QString>& accessRole) {
  return !accessRole.has_value() || *accessRole == QStringLiteral("writer") ||
         *accessRole == QStringLiteral("owner");
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

[[nodiscard]] std::optional<QString> optionalText(sqlite3_stmt* statement, int index) {
  if (sqlite3_column_type(statement, index) == SQLITE_NULL) {
    return std::nullopt;
  }
  const auto* value = reinterpret_cast<const char*>(sqlite3_column_text(statement, index));
  const int size = sqlite3_column_bytes(statement, index);
  return value == nullptr || size < 0 ? std::nullopt
                                      : std::optional<QString>(QString::fromUtf8(value, size));
}

[[nodiscard]] bool isPendingRemoteId(const QString& remoteId) {
  return remoteId.startsWith(QStringLiteral("pending:"));
}

[[nodiscard]] std::variant<std::optional<StoredEventContext>, AppError>
readEventContext(SqliteConnection& connection, const QString& eventId) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite calendar-event connection is unavailable"));
  }
  constexpr char sql[] = R"(
SELECT events.id, calendars.account_id, events.calendar_id, calendars.remote_id,
       calendars.access_role, events.remote_id, events.etag, events.title, events.description,
       events.location, events.start_at, events.start_time_zone, events.end_at,
       events.end_time_zone, events.is_all_day, events.recurrence_rule, events.recurring_remote_id,
       events.status, events.color_id, events.transparency, events.visibility, events.event_type
FROM local_calendar_events AS events
INNER JOIN local_calendars AS calendars ON calendars.id = events.calendar_id
WHERE events.id = ?1 AND events.deleted_at IS NULL AND calendars.deleted_at IS NULL
LIMIT 1
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite calendar-event context preparation failed (%1)"),
                         prepareResult);
  }
  if (const std::optional<AppError> error = bindText(statement, 1, eventId); error.has_value()) {
    sqlite3_finalize(statement);
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  if (stepResult == SQLITE_DONE) {
    const int finalizeResult = sqlite3_finalize(statement);
    return finalizeResult == SQLITE_OK
               ? std::optional<StoredEventContext>{}
               : std::variant<std::optional<StoredEventContext>, AppError>(databaseError(
                     QStringLiteral("SQLite calendar-event context finalization failed (%1)"),
                     finalizeResult));
  }
  if (stepResult != SQLITE_ROW) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite calendar-event context lookup failed (%1)"),
                         stepResult);
  }
  const std::optional<QString> storedEventId = optionalText(statement, 0);
  const std::optional<QString> accountId = optionalText(statement, 1);
  const std::optional<QString> calendarId = optionalText(statement, 2);
  const std::optional<QString> calendarRemoteId = optionalText(statement, 3);
  const std::optional<QString> remoteId = optionalText(statement, 5);
  const std::optional<QString> title = optionalText(statement, 7);
  const std::optional<QString> startAt = optionalText(statement, 10);
  const std::optional<QString> endAt = optionalText(statement, 12);
  if (!storedEventId.has_value() || !accountId.has_value() || !calendarId.has_value() ||
      !calendarRemoteId.has_value() || !remoteId.has_value() || !title.has_value() ||
      !startAt.has_value() || !endAt.has_value()) {
    sqlite3_finalize(statement);
    return AppError(AppErrorCode::Database, QStringLiteral("Stored calendar event is invalid"));
  }
  StoredEventContext context{.eventId = *storedEventId,
                             .accountId = *accountId,
                             .calendarId = *calendarId,
                             .calendarRemoteId = *calendarRemoteId,
                             .calendarAccessRole = optionalText(statement, 4),
                             .remoteId = *remoteId,
                             .remoteEtag = optionalText(statement, 6),
                             .title = *title,
                             .description = optionalText(statement, 8),
                             .location = optionalText(statement, 9),
                             .startAt = *startAt,
                             .startTimeZone = optionalText(statement, 11),
                             .endAt = *endAt,
                             .endTimeZone = optionalText(statement, 13),
                             .allDay = sqlite3_column_int(statement, 14) != 0,
                             .recurrenceRule = optionalText(statement, 15),
                             .recurringRemoteId = optionalText(statement, 16),
                             .status = optionalText(statement, 17).value_or(QString()),
                             .colorId = optionalText(statement, 18),
                             .transparency = optionalText(statement, 19),
                             .visibility = optionalText(statement, 20),
                             .eventType = optionalText(statement, 21)};
  const int finalizeResult = sqlite3_finalize(statement);
  return finalizeResult == SQLITE_OK
             ? std::variant<std::optional<StoredEventContext>, AppError>(std::move(context))
             : std::variant<std::optional<StoredEventContext>, AppError>(databaseError(
                   QStringLiteral("SQLite calendar-event context finalization failed (%1)"),
                   finalizeResult));
}

[[nodiscard]] QJsonObject eventTime(const QString& at,
                                    const std::optional<QString>& timeZone,
                                    bool allDay) {
  const QDateTime parsed = QDateTime::fromString(at, Qt::ISODate);
  QJsonObject result;
  if (allDay) {
    result.insert(QStringLiteral("date"), parsed.date().toString(Qt::ISODate));
  } else {
    result.insert(QStringLiteral("dateTime"), parsed.toUTC().toString(Qt::ISODateWithMs));
  }
  if (timeZone.has_value()) {
    result.insert(QStringLiteral("timeZone"), *timeZone);
  }
  return result;
}

[[nodiscard]] QJsonObject eventSnapshot(const StoredEventContext& event) {
  return {{QStringLiteral("summary"), event.title},
          {QStringLiteral("description"),
           event.description.has_value() ? QJsonValue(*event.description) : QJsonValue::Null},
          {QStringLiteral("location"),
           event.location.has_value() ? QJsonValue(*event.location) : QJsonValue::Null},
          {QStringLiteral("start"), eventTime(event.startAt, event.startTimeZone, event.allDay)},
          {QStringLiteral("end"), eventTime(event.endAt, event.endTimeZone, event.allDay)},
          {QStringLiteral("colorId"),
           event.colorId.has_value() ? QJsonValue(*event.colorId) : QJsonValue::Null},
          {QStringLiteral("transparency"),
           event.transparency.has_value() ? QJsonValue(*event.transparency) : QJsonValue::Null},
          {QStringLiteral("visibility"),
           event.visibility.has_value() ? QJsonValue(*event.visibility) : QJsonValue::Null}};
}

[[nodiscard]] QJsonObject eventBody(const StoredEventContext& event, bool creating) {
  QJsonObject body{{QStringLiteral("summary"), event.title},
                   {QStringLiteral("start"),
                    eventTime(event.startAt, event.startTimeZone, event.allDay)},
                   {QStringLiteral("end"), eventTime(event.endAt, event.endTimeZone, event.allDay)}};
  if (event.description.has_value()) {
    body.insert(QStringLiteral("description"), *event.description);
  } else if (!creating) {
    body.insert(QStringLiteral("description"), QJsonValue::Null);
  }
  if (event.location.has_value()) {
    body.insert(QStringLiteral("location"), *event.location);
  } else if (!creating) {
    body.insert(QStringLiteral("location"), QJsonValue::Null);
  }
  if (event.colorId.has_value()) {
    body.insert(QStringLiteral("colorId"), *event.colorId);
  }
  if (event.transparency.has_value()) {
    body.insert(QStringLiteral("transparency"), *event.transparency);
  }
  if (event.visibility.has_value()) {
    body.insert(QStringLiteral("visibility"), *event.visibility);
  }
  return body;
}

[[nodiscard]] QJsonObject eventPayload(const StoredEventContext& event,
                                      bool includeRemoteIdentity) {
  QJsonObject payload{{QStringLiteral("calendarId"), event.calendarRemoteId},
                      {QStringLiteral("localCalendarId"), event.calendarId},
                      {QStringLiteral("localEventId"), event.eventId},
                      {QStringLiteral("event"), eventBody(event, !includeRemoteIdentity)}};
  if (includeRemoteIdentity) {
    payload.insert(QStringLiteral("remoteEventId"), event.remoteId);
  }
  return payload;
}

[[nodiscard]] QJsonObject movePayload(const StoredEventContext& before,
                                     const StoredEventContext& after) {
  QJsonObject payload = eventPayload(after, true);
  payload.insert(QStringLiteral("sourceCalendarId"), before.calendarRemoteId);
  payload.insert(QStringLiteral("destinationCalendarId"), after.calendarRemoteId);
  payload.insert(QStringLiteral("remoteEventId"), before.remoteId);
  return payload;
}

[[nodiscard]] QJsonObject deletePayload(const StoredEventContext& event) {
  return {{QStringLiteral("calendarId"), event.calendarRemoteId},
          {QStringLiteral("localCalendarId"), event.calendarId},
          {QStringLiteral("localEventId"), event.eventId},
          {QStringLiteral("remoteEventId"), event.remoteId}};
}

[[nodiscard]] QJsonObject withConflictMetadata(QJsonObject payload,
                                               QJsonObject baseSnapshot,
                                               const std::optional<QString>& remoteEtag) {
  QJsonObject metadata{{QStringLiteral("base"), std::move(baseSnapshot)}};
  if (remoteEtag.has_value()) {
    metadata.insert(QStringLiteral("etag"), *remoteEtag);
  }
  payload.insert(QString::fromLatin1(kConflictMetadataKey), std::move(metadata));
  return payload;
}

[[nodiscard]] std::optional<QString> mutationDependency(const QJsonObject& payload) {
  const QJsonValue value = payload.value(QStringLiteral("dependsOnMutationId"));
  if (value.isUndefined() || value.isNull()) {
    return std::nullopt;
  }
  if (!value.isString() || !isValidRequiredText(value.toString(), kMaximumIdentifierLength)) {
    return std::nullopt;
  }
  return value.toString();
}

[[nodiscard]] std::variant<std::optional<ActiveEventMutation>, AppError>
findActiveEventMutation(SqliteConnection& connection, const QString& eventId) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite calendar-event connection is unavailable"));
  }
  constexpr char sql[] = R"(
SELECT id, operation, payload_json
FROM local_pending_mutations
WHERE resource_type = 'event' AND resource_id = ?1 AND status IN ('pending', 'failed')
ORDER BY created_at DESC, id DESC
LIMIT 1
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite calendar-event mutation lookup preparation failed (%1)"),
                         prepareResult);
  }
  if (const std::optional<AppError> error = bindText(statement, 1, eventId); error.has_value()) {
    sqlite3_finalize(statement);
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  if (stepResult == SQLITE_DONE) {
    const int finalizeResult = sqlite3_finalize(statement);
    return finalizeResult == SQLITE_OK
               ? std::optional<ActiveEventMutation>{}
               : std::variant<std::optional<ActiveEventMutation>, AppError>(databaseError(
                     QStringLiteral("SQLite calendar-event mutation lookup finalization failed (%1)"),
                     finalizeResult));
  }
  if (stepResult != SQLITE_ROW) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite calendar-event mutation lookup failed (%1)"),
                         stepResult);
  }
  const std::optional<QString> mutationId = optionalText(statement, 0);
  const std::optional<QString> operation = optionalText(statement, 1);
  const std::optional<QString> payloadJson = optionalText(statement, 2);
  QJsonParseError parseError;
  const QJsonDocument payloadDocument =
      payloadJson.has_value() ? QJsonDocument::fromJson(payloadJson->toUtf8(), &parseError)
                              : QJsonDocument();
  if (!mutationId.has_value() || !operation.has_value() || !payloadJson.has_value() ||
      parseError.error != QJsonParseError::NoError || !payloadDocument.isObject()) {
    sqlite3_finalize(statement);
    return AppError(AppErrorCode::Database,
                    QStringLiteral("Stored calendar-event mutation is invalid"));
  }
  ActiveEventMutation mutation{
      .id = *mutationId, .operation = *operation, .payload = payloadDocument.object()};
  const int finalizeResult = sqlite3_finalize(statement);
  return finalizeResult == SQLITE_OK
             ? std::variant<std::optional<ActiveEventMutation>, AppError>(std::move(mutation))
             : std::variant<std::optional<ActiveEventMutation>, AppError>(databaseError(
                   QStringLiteral("SQLite calendar-event mutation lookup finalization failed (%1)"),
                   finalizeResult));
}

[[nodiscard]] std::optional<AppError> replaceActiveEventMutation(SqliteConnection& connection,
                                                                 const ActiveEventMutation& mutation,
                                                                 QString operation,
                                                                 QJsonObject payload,
                                                                 const QString& updatedAt) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite calendar-event connection is unavailable"));
  }
  constexpr char sql[] = R"(
UPDATE local_pending_mutations
SET operation = ?2, payload_json = ?3, status = 'pending', next_retry_at = NULL,
    last_error_code = NULL, last_error_message = NULL, updated_at = ?4
WHERE id = ?1 AND status IN ('pending', 'failed')
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(
        QStringLiteral("SQLite calendar-event mutation replacement preparation failed (%1)"),
        prepareResult);
  }
  const QString payloadJson =
      QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact));
  if (const std::optional<AppError> error = bindAll(statement,
                                                    {bindText(statement, 1, mutation.id),
                                                     bindText(statement, 2, operation),
                                                     bindText(statement, 3, payloadJson),
                                                     bindText(statement, 4, updatedAt)});
      error.has_value()) {
    return error;
  }
  const int stepResult = sqlite3_step(statement);
  const int changedRows = sqlite3_changes(handle);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite calendar-event mutation replacement failed (%1)"),
                         stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return databaseError(
        QStringLiteral("SQLite calendar-event mutation replacement finalization failed (%1)"),
        finalizeResult);
  }
  return changedRows == 1
             ? std::nullopt
             : std::optional<AppError>(AppError(
                   AppErrorCode::Database,
                   QStringLiteral("Active calendar-event mutation was not replaced")));
}

[[nodiscard]] std::optional<AppError> removeActiveEventMutation(SqliteConnection& connection,
                                                                const ActiveEventMutation& mutation) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite calendar-event connection is unavailable"));
  }
  sqlite3_stmt* statement = nullptr;
  const int prepareResult = sqlite3_prepare_v3(handle,
                                               "DELETE FROM local_pending_mutations "
                                               "WHERE id = ?1 AND status IN ('pending', 'failed')",
                                               -1,
                                               SQLITE_PREPARE_PERSISTENT,
                                               &statement,
                                               nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(
        QStringLiteral("SQLite calendar-event mutation removal preparation failed (%1)"),
        prepareResult);
  }
  if (const std::optional<AppError> error = bindText(statement, 1, mutation.id);
      error.has_value()) {
    sqlite3_finalize(statement);
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  const int changedRows = sqlite3_changes(handle);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite calendar-event mutation removal failed (%1)"),
                         stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return databaseError(
        QStringLiteral("SQLite calendar-event mutation removal finalization failed (%1)"),
        finalizeResult);
  }
  return changedRows == 1
             ? std::nullopt
             : std::optional<AppError>(AppError(
                   AppErrorCode::Database,
                   QStringLiteral("Active calendar-event mutation was not removed")));
}

using EventMutationInsertResult = std::variant<QString, AppError>;

[[nodiscard]] EventMutationInsertResult insertEventMutation(SqliteConnection& connection,
                                                             const StoredEventContext& event,
                                                             QString operation,
                                                             QJsonObject payload,
                                                             const QString& createdAt) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite calendar-event connection is unavailable"));
  }
  constexpr char sql[] = R"(
INSERT INTO local_pending_mutations (
  id, account_id, resource_type, resource_id, operation, payload_json, status, attempt_count,
  created_at, updated_at
) VALUES (?1, ?2, 'event', ?3, ?4, ?5, 'pending', 0, ?6, ?6)
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(
        QStringLiteral("SQLite calendar-event mutation enqueue preparation failed (%1)"),
        prepareResult);
  }
  const QString mutationId =
      QStringLiteral("mutation:event:") + QUuid::createUuid().toString(QUuid::WithoutBraces);
  const QString payloadJson =
      QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact));
  if (const std::optional<AppError> error = bindAll(statement,
                                                    {bindText(statement, 1, mutationId),
                                                     bindText(statement, 2, event.accountId),
                                                     bindText(statement, 3, event.eventId),
                                                     bindText(statement, 4, operation),
                                                     bindText(statement, 5, payloadJson),
                                                     bindText(statement, 6, createdAt)});
      error.has_value()) {
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite calendar-event mutation enqueue failed (%1)"),
                         stepResult);
  }
  return finalizeResult == SQLITE_OK
             ? EventMutationInsertResult(mutationId)
             : EventMutationInsertResult(databaseError(
                   QStringLiteral("SQLite calendar-event mutation enqueue finalization failed (%1)"),
                   finalizeResult));
}

[[nodiscard]] std::optional<AppError>
queueEventMutation(SqliteConnection& connection,
                   const StoredEventContext& before,
                   const std::optional<StoredEventContext>& after,
                   const QString& operation,
                   const QString& updatedAt) {
  const std::variant<std::optional<ActiveEventMutation>, AppError> activeResult =
      findActiveEventMutation(connection, before.eventId);
  if (std::holds_alternative<AppError>(activeResult)) {
    return std::get<AppError>(activeResult);
  }
  const std::optional<ActiveEventMutation>& active =
      std::get<std::optional<ActiveEventMutation>>(activeResult);
  const bool deleting = operation == QStringLiteral("event.delete");
  if (active.has_value()) {
    const QJsonValue metadata = active->payload.value(QString::fromLatin1(kConflictMetadataKey));
    if (!metadata.isObject()) {
      return AppError(AppErrorCode::Database,
                      QStringLiteral("Stored calendar-event mutation is invalid"));
    }
    if (active->operation == QStringLiteral("event.create")) {
      if (deleting) {
        return removeActiveEventMutation(connection, *active);
      }
      if (!after.has_value()) {
        return AppError(AppErrorCode::Database,
                        QStringLiteral("Updated calendar event is unavailable"));
      }
      QJsonObject payload = eventPayload(*after, false);
      payload.insert(QString::fromLatin1(kConflictMetadataKey), metadata);
      return replaceActiveEventMutation(
          connection, *active, QStringLiteral("event.create"), std::move(payload), updatedAt);
    }
    std::optional<QString> dependency = mutationDependency(active->payload);
    if (operation == QStringLiteral("event.move")) {
      if (!after.has_value()) {
        return AppError(AppErrorCode::Database,
                        QStringLiteral("Moved calendar event is unavailable"));
      }
      QJsonObject payload = movePayload(before, *after);
      if (dependency.has_value()) {
        payload.insert(QStringLiteral("dependsOnMutationId"), *dependency);
      }
      payload.insert(QString::fromLatin1(kConflictMetadataKey), metadata);
      if (const std::optional<AppError> error = replaceActiveEventMutation(
              connection, *active, QStringLiteral("event.move"), std::move(payload), updatedAt);
          error.has_value()) {
        return error;
      }
      QJsonObject followUp = eventPayload(*after, true);
      followUp.insert(QStringLiteral("dependsOnMutationId"), active->id);
      followUp = withConflictMetadata(std::move(followUp), eventSnapshot(before), before.remoteEtag);
      const EventMutationInsertResult inserted = insertEventMutation(
          connection, *after, QStringLiteral("event.update"), std::move(followUp), updatedAt);
      return std::holds_alternative<AppError>(inserted)
                 ? std::optional<AppError>(std::get<AppError>(inserted))
                 : std::nullopt;
    }
    QJsonObject payload = deleting ? deletePayload(before) : eventPayload(*after, true);
    if (dependency.has_value()) {
      payload.insert(QStringLiteral("dependsOnMutationId"), *dependency);
    }
    payload.insert(QString::fromLatin1(kConflictMetadataKey), metadata);
    return replaceActiveEventMutation(connection, *active, operation, std::move(payload), updatedAt);
  }
  QJsonObject payload;
  if (deleting) {
    payload = deletePayload(before);
  } else if (operation == QStringLiteral("event.move")) {
    if (!after.has_value()) {
      return AppError(AppErrorCode::Database, QStringLiteral("Moved calendar event is unavailable"));
    }
    payload = movePayload(before, *after);
  } else {
    if (!after.has_value()) {
      return AppError(AppErrorCode::Database,
                      QStringLiteral("Updated calendar event is unavailable"));
    }
    payload = eventPayload(*after, operation != QStringLiteral("event.create"));
  }
  payload = withConflictMetadata(
      std::move(payload),
      operation == QStringLiteral("event.create") ? QJsonObject() : eventSnapshot(before),
      operation == QStringLiteral("event.create") ? std::optional<QString>{} : before.remoteEtag);
  const EventMutationInsertResult inserted =
      insertEventMutation(connection, before, operation, std::move(payload), updatedAt);
  if (std::holds_alternative<AppError>(inserted)) {
    return std::get<AppError>(inserted);
  }
  if (operation != QStringLiteral("event.move")) {
    return std::nullopt;
  }
  if (!after.has_value()) {
    return AppError(AppErrorCode::Database, QStringLiteral("Moved calendar event is unavailable"));
  }
  QJsonObject followUp = eventPayload(*after, true);
  followUp.insert(QStringLiteral("dependsOnMutationId"), std::get<QString>(inserted));
  followUp = withConflictMetadata(std::move(followUp), eventSnapshot(before), before.remoteEtag);
  const EventMutationInsertResult followUpInserted = insertEventMutation(
      connection, *after, QStringLiteral("event.update"), std::move(followUp), updatedAt);
  return std::holds_alternative<AppError>(followUpInserted)
             ? std::optional<AppError>(std::get<AppError>(followUpInserted))
             : std::nullopt;
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
      input.allDay.has_value() || input.startTimeZone.has_value() || input.endTimeZone.has_value() ||
      input.colorId.has_value() || input.transparency.has_value() || input.visibility.has_value();
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
  if ((input.colorId.has_value() && !isValidColorId(*input.colorId)) ||
      (input.transparency.has_value() && !isValidTransparency(*input.transparency)) ||
      (input.visibility.has_value() && !isValidVisibility(*input.visibility))) {
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
    color_id = CASE WHEN ?20 = 1 THEN ?21 ELSE color_id END,
    transparency = CASE WHEN ?22 = 1 THEN ?23 ELSE transparency END,
    visibility = CASE WHEN ?24 = 1 THEN ?25 ELSE visibility END,
    updated_at = ?26
WHERE id = ?1
  AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM local_calendars AS source
              WHERE source.id = local_calendar_events.calendar_id
                AND source.deleted_at IS NULL
                AND (source.access_role IS NULL OR source.access_role IN ('writer', 'owner')))
  AND (?2 = 0 OR EXISTS (SELECT 1 FROM local_calendars AS target
                          INNER JOIN local_calendars AS source ON source.id = local_calendar_events.calendar_id
                          WHERE target.id = ?3
                            AND target.deleted_at IS NULL
                            AND source.deleted_at IS NULL
                            AND (target.access_role IS NULL OR target.access_role IN ('writer', 'owner'))
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
                   bindInteger(statement, 20, input.colorId.has_value()),
                   bindOptionalText(statement, 21, input.colorId),
                   bindInteger(statement, 22, input.transparency.has_value()),
                   bindOptionalText(statement, 23, input.transparency),
                   bindInteger(statement, 24, input.visibility.has_value()),
                   bindOptionalText(statement, 25, input.visibility),
                   bindText(statement, 26, updatedAt)});
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

[[nodiscard]] CalendarEventMutationResult
reconcileStoredGoogleEvent(SqliteConnection& connection,
                           const CalendarEventRemoteReconciliationInput& input,
                           const QString& updatedAt) {
  SqliteTransactionResult transactionResult = SqliteTransaction::begin(connection);
  if (std::holds_alternative<AppError>(transactionResult)) {
    return std::get<AppError>(std::move(transactionResult));
  }
  SqliteTransaction transaction = std::get<SqliteTransaction>(std::move(transactionResult));
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite calendar-event connection is unavailable"));
  }
  constexpr char eventSql[] = R"(
UPDATE local_calendar_events
SET remote_id = CASE WHEN remote_id LIKE 'pending:%' THEN ?2 ELSE remote_id END,
    etag = COALESCE(?3, etag),
    updated_at = ?4
WHERE id = ?1
  AND (remote_id = ?2 OR remote_id LIKE 'pending:%')
)";
  sqlite3_stmt* eventStatement = nullptr;
  const int eventPrepareResult = sqlite3_prepare_v3(
      handle, eventSql, -1, SQLITE_PREPARE_PERSISTENT, &eventStatement, nullptr);
  if (eventPrepareResult != SQLITE_OK) {
    sqlite3_finalize(eventStatement);
    return databaseError(
        QStringLiteral("SQLite calendar-event reconciliation preparation failed (%1)"),
        eventPrepareResult);
  }
  if (const std::optional<AppError> error =
          bindAll(eventStatement,
                  {bindText(eventStatement, 1, input.localEventId),
                   bindText(eventStatement, 2, input.remoteEventId),
                   bindOptionalText(eventStatement, 3, input.remoteEtag),
                   bindText(eventStatement, 4, updatedAt)});
      error.has_value()) {
    return *error;
  }
  const int eventStepResult = sqlite3_step(eventStatement);
  const int eventChangedRows = sqlite3_changes(handle);
  const int eventFinalizeResult = sqlite3_finalize(eventStatement);
  if (eventStepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite calendar-event reconciliation failed (%1)"),
                         eventStepResult);
  }
  if (eventFinalizeResult != SQLITE_OK) {
    return databaseError(
        QStringLiteral("SQLite calendar-event reconciliation finalization failed (%1)"),
        eventFinalizeResult);
  }
  if (eventChangedRows != 1) {
    return validationError(QStringLiteral("Calendar event is unavailable for Google reconciliation"));
  }
  constexpr char pendingSql[] = R"(
SELECT id, payload_json
FROM local_pending_mutations
WHERE resource_type = 'event' AND resource_id = ?1 AND status IN ('pending', 'failed')
)";
  sqlite3_stmt* pendingStatement = nullptr;
  const int pendingPrepareResult = sqlite3_prepare_v3(
      handle, pendingSql, -1, SQLITE_PREPARE_PERSISTENT, &pendingStatement, nullptr);
  if (pendingPrepareResult != SQLITE_OK) {
    sqlite3_finalize(pendingStatement);
    return databaseError(
        QStringLiteral("SQLite pending calendar-event reconciliation preparation failed (%1)"),
        pendingPrepareResult);
  }
  if (const std::optional<AppError> error = bindText(pendingStatement, 1, input.localEventId);
      error.has_value()) {
    sqlite3_finalize(pendingStatement);
    return *error;
  }
  struct PendingPayload final {
    QString mutationId;
    QJsonObject payload;
  };
  QList<PendingPayload> pendingPayloads;
  int pendingStepResult = SQLITE_ROW;
  while ((pendingStepResult = sqlite3_step(pendingStatement)) == SQLITE_ROW) {
    const std::optional<QString> mutationId = optionalText(pendingStatement, 0);
    const std::optional<QString> payloadJson = optionalText(pendingStatement, 1);
    QJsonParseError parseError;
    const QJsonDocument document = payloadJson.has_value()
                                       ? QJsonDocument::fromJson(payloadJson->toUtf8(), &parseError)
                                       : QJsonDocument();
    if (!mutationId.has_value() || !payloadJson.has_value() ||
        parseError.error != QJsonParseError::NoError || !document.isObject()) {
      sqlite3_finalize(pendingStatement);
      return AppError(AppErrorCode::Database,
                      QStringLiteral("Stored pending calendar-event mutation is invalid"));
    }
    QJsonObject payload = document.object();
    const QJsonValue remoteEventId = payload.value(QStringLiteral("remoteEventId"));
    if (remoteEventId.isString() && isPendingRemoteId(remoteEventId.toString())) {
      payload.insert(QStringLiteral("remoteEventId"), input.remoteEventId);
    }
    if (input.remoteEtag.has_value()) {
      const QJsonValue metadataValue = payload.value(QString::fromLatin1(kConflictMetadataKey));
      if (!metadataValue.isObject()) {
        sqlite3_finalize(pendingStatement);
        return AppError(AppErrorCode::Database,
                        QStringLiteral("Stored pending calendar-event mutation is invalid"));
      }
      QJsonObject metadata = metadataValue.toObject();
      metadata.insert(QStringLiteral("etag"), *input.remoteEtag);
      payload.insert(QString::fromLatin1(kConflictMetadataKey), std::move(metadata));
    }
    pendingPayloads.append({.mutationId = *mutationId, .payload = std::move(payload)});
  }
  const int pendingFinalizeResult = sqlite3_finalize(pendingStatement);
  if (pendingStepResult != SQLITE_DONE) {
    return databaseError(
        QStringLiteral("SQLite pending calendar-event reconciliation lookup failed (%1)"),
        pendingStepResult);
  }
  if (pendingFinalizeResult != SQLITE_OK) {
    return databaseError(
        QStringLiteral("SQLite pending calendar-event reconciliation lookup finalization failed (%1)"),
        pendingFinalizeResult);
  }
  constexpr char updateSql[] = R"(
UPDATE local_pending_mutations
SET payload_json = ?2, updated_at = ?3
WHERE id = ?1 AND status IN ('pending', 'failed')
)";
  for (const PendingPayload& pending : pendingPayloads) {
    sqlite3_stmt* updateStatement = nullptr;
    const int updatePrepareResult =
        sqlite3_prepare_v3(handle, updateSql, -1, SQLITE_PREPARE_PERSISTENT, &updateStatement,
                           nullptr);
    if (updatePrepareResult != SQLITE_OK) {
      sqlite3_finalize(updateStatement);
      return databaseError(
          QStringLiteral("SQLite pending calendar-event reconciliation update preparation failed (%1)"),
          updatePrepareResult);
    }
    const QString payloadJson =
        QString::fromUtf8(QJsonDocument(pending.payload).toJson(QJsonDocument::Compact));
    if (const std::optional<AppError> error =
            bindAll(updateStatement,
                    {bindText(updateStatement, 1, pending.mutationId),
                     bindText(updateStatement, 2, payloadJson),
                     bindText(updateStatement, 3, updatedAt)});
        error.has_value()) {
      return *error;
    }
    const int updateStepResult = sqlite3_step(updateStatement);
    const int updateChangedRows = sqlite3_changes(handle);
    const int updateFinalizeResult = sqlite3_finalize(updateStatement);
    if (updateStepResult != SQLITE_DONE) {
      return databaseError(
          QStringLiteral("SQLite pending calendar-event reconciliation update failed (%1)"),
          updateStepResult);
    }
    if (updateFinalizeResult != SQLITE_OK) {
      return databaseError(
          QStringLiteral("SQLite pending calendar-event reconciliation update finalization failed (%1)"),
          updateFinalizeResult);
    }
    if (updateChangedRows != 1) {
      return AppError(AppErrorCode::Database,
                      QStringLiteral("Pending calendar-event mutation was unavailable for reconciliation"));
    }
  }
  if (const std::optional<AppError> error = transaction.commit(); error.has_value()) {
    return *error;
  }
  return CalendarEventMutationReceipt{.eventId = input.localEventId, .updatedAt = updatedAt};
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
        SqliteTransactionResult transactionResult = SqliteTransaction::begin(connection);
        if (std::holds_alternative<AppError>(transactionResult)) {
          return CalendarEventMutationResult(std::get<AppError>(std::move(transactionResult)));
        }
        SqliteTransaction transaction = std::get<SqliteTransaction>(std::move(transactionResult));
        CalendarEventMutationResult created =
            createStoredEvent(connection, input, eventId, remoteId, updatedAt);
        if (std::holds_alternative<AppError>(created)) {
          return created;
        }
        const std::variant<std::optional<StoredEventContext>, AppError> contextResult =
            readEventContext(connection, eventId);
        if (std::holds_alternative<AppError>(contextResult)) {
          return CalendarEventMutationResult(std::get<AppError>(contextResult));
        }
        const std::optional<StoredEventContext>& context =
            std::get<std::optional<StoredEventContext>>(contextResult);
        if (!context.has_value()) {
          return CalendarEventMutationResult(
              AppError(AppErrorCode::Database, QStringLiteral("Created calendar event is unavailable")));
        }
        if (const std::optional<AppError> error = queueEventMutation(
                connection, *context, context, QStringLiteral("event.create"), updatedAt);
            error.has_value()) {
          return CalendarEventMutationResult(*error);
        }
        if (const std::optional<AppError> error = transaction.commit(); error.has_value()) {
          return CalendarEventMutationResult(*error);
        }
        return created;
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
    SqliteTransactionResult transactionResult = SqliteTransaction::begin(connection);
    if (std::holds_alternative<AppError>(transactionResult)) {
      return CalendarEventMutationResult(std::get<AppError>(std::move(transactionResult)));
    }
    SqliteTransaction transaction = std::get<SqliteTransaction>(std::move(transactionResult));
    const std::variant<std::optional<StoredEventContext>, AppError> beforeResult =
        readEventContext(connection, input.eventId);
    if (std::holds_alternative<AppError>(beforeResult)) {
      return CalendarEventMutationResult(std::get<AppError>(beforeResult));
    }
    const std::optional<StoredEventContext>& before =
        std::get<std::optional<StoredEventContext>>(beforeResult);
    if (!before.has_value()) {
      return CalendarEventMutationResult(
          validationError(QStringLiteral("Calendar event is unavailable for update")));
    }
    if (!isWritableCalendar(before->calendarAccessRole)) {
      return CalendarEventMutationResult(
          validationError(QStringLiteral("Calendar is read-only for event updates")));
    }
    CalendarEventMutationResult updated = updateStoredEvent(connection, input, updatedAt);
    if (std::holds_alternative<AppError>(updated)) {
      return updated;
    }
    const std::variant<std::optional<StoredEventContext>, AppError> afterResult =
        readEventContext(connection, input.eventId);
    if (std::holds_alternative<AppError>(afterResult)) {
      return CalendarEventMutationResult(std::get<AppError>(afterResult));
    }
    const std::optional<StoredEventContext>& after =
        std::get<std::optional<StoredEventContext>>(afterResult);
    if (!after.has_value()) {
      return CalendarEventMutationResult(
          AppError(AppErrorCode::Database, QStringLiteral("Updated calendar event is unavailable")));
    }
    const QString operation = before->calendarId == after->calendarId
                                  ? QStringLiteral("event.update")
                                  : QStringLiteral("event.move");
    if (const std::optional<AppError> error =
            queueEventMutation(connection, *before, after, operation, updatedAt);
        error.has_value()) {
      return CalendarEventMutationResult(*error);
    }
    if (const std::optional<AppError> error = transaction.commit(); error.has_value()) {
      return CalendarEventMutationResult(*error);
    }
    return updated;
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
        SqliteTransactionResult transactionResult = SqliteTransaction::begin(connection);
        if (std::holds_alternative<AppError>(transactionResult)) {
          return CalendarEventMutationResult(std::get<AppError>(std::move(transactionResult)));
        }
        SqliteTransaction transaction = std::get<SqliteTransaction>(std::move(transactionResult));
        const std::variant<std::optional<StoredEventContext>, AppError> beforeResult =
            readEventContext(connection, eventId);
        if (std::holds_alternative<AppError>(beforeResult)) {
          return CalendarEventMutationResult(std::get<AppError>(beforeResult));
        }
        const std::optional<StoredEventContext>& before =
            std::get<std::optional<StoredEventContext>>(beforeResult);
        if (!before.has_value()) {
          return CalendarEventMutationResult(
              validationError(QStringLiteral("Calendar event is unavailable for deletion")));
        }
        if (!isWritableCalendar(before->calendarAccessRole)) {
          return CalendarEventMutationResult(
              validationError(QStringLiteral("Calendar is read-only for event deletion")));
        }
        CalendarEventMutationResult removed = removeStoredEvent(connection, eventId, updatedAt);
        if (std::holds_alternative<AppError>(removed)) {
          return removed;
        }
        if (const std::optional<AppError> error = queueEventMutation(
                connection, *before, std::nullopt, QStringLiteral("event.delete"), updatedAt);
            error.has_value()) {
          return CalendarEventMutationResult(*error);
        }
        if (const std::optional<AppError> error = transaction.commit(); error.has_value()) {
          return CalendarEventMutationResult(*error);
        }
        return removed;
      });
}

std::future<CalendarEventMutationSnapshotResult>
CalendarMutationService::inspect(QList<QString> eventIds) {
  constexpr qsizetype kMaximumInspectionSize = 500;
  if (eventIds.isEmpty() || eventIds.size() > kMaximumInspectionSize) {
    return readyFuture(CalendarEventMutationSnapshotResult(
        validationError(QStringLiteral("Calendar event inspection input is invalid"))));
  }
  QSet<QString> uniqueIds;
  for (const QString& eventId : eventIds) {
    if (!isValidRequiredText(eventId, kMaximumIdentifierLength) || uniqueIds.contains(eventId)) {
      return readyFuture(CalendarEventMutationSnapshotResult(
          validationError(QStringLiteral("Calendar event inspection input is invalid"))));
    }
    uniqueIds.insert(eventId);
  }
  return writerQueue_.enqueueResult([eventIds = std::move(eventIds)](SqliteConnection& connection) {
    QList<CalendarEventMutationSnapshot> snapshots;
    snapshots.reserve(eventIds.size());
    for (const QString& eventId : eventIds) {
      const std::variant<std::optional<StoredEventContext>, AppError> contextResult =
          readEventContext(connection, eventId);
      if (std::holds_alternative<AppError>(contextResult)) {
        return CalendarEventMutationSnapshotResult(std::get<AppError>(contextResult));
      }
      const std::optional<StoredEventContext>& context =
          std::get<std::optional<StoredEventContext>>(contextResult);
      if (!context.has_value()) {
        continue;
      }
      snapshots.append({.eventId = context->eventId,
                        .accountId = context->accountId,
                        .calendarId = context->calendarId,
                        .calendarAccessRole = context->calendarAccessRole,
                        .status = context->status,
                        .recurringRemoteId = context->recurringRemoteId,
                        .recurrenceRule = context->recurrenceRule,
                        .eventType = context->eventType,
                        .startAt = context->startAt,
                        .endAt = context->endAt,
                        .allDay = context->allDay,
                        .colorId = context->colorId,
                        .transparency = context->transparency,
                        .visibility = context->visibility});
    }
    return CalendarEventMutationSnapshotResult(std::move(snapshots));
  });
}

std::future<CalendarEventMutationResult>
CalendarMutationService::reconcileGoogleEvent(CalendarEventRemoteReconciliationInput input) {
  if (!isValidRequiredText(input.localEventId, kMaximumIdentifierLength) ||
      !isValidRequiredText(input.remoteEventId, kMaximumIdentifierLength) ||
      isPendingRemoteId(input.remoteEventId) ||
      (input.remoteEtag.has_value() &&
       (!isValidRequiredText(*input.remoteEtag, 4'096) || input.remoteEtag->contains(u'\r') ||
        input.remoteEtag->contains(u'\n')))) {
    return readyFuture(CalendarEventMutationResult(
        validationError(QStringLiteral("Google calendar-event reconciliation input is invalid"))));
  }
  const QString updatedAt = timestamp(clock_);
  return writerQueue_.enqueueResult(
      [input = std::move(input), updatedAt](SqliteConnection& connection) {
        return reconcileStoredGoogleEvent(connection, input, updatedAt);
      });
}

} // namespace hcb
