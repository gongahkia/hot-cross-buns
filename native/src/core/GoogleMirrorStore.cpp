#include "core/GoogleMirrorStore.h"

#include "data/LocalSchema.h"
#include "data/SqliteTransaction.h"
#include "sqlite3.h"

#include <QByteArray>
#include <QCryptographicHash>
#include <QDateTime>
#include <QSet>
#include <QTimeZone>

#include <chrono>
#include <optional>
#include <utility>

namespace hcb {
namespace {

constexpr qsizetype kMaximumIdentifierLength = 256;

enum class SqlValueType {
  Null,
  Text,
  Integer
};

struct SqlValue final {
  SqlValueType type;
  QString text;
  sqlite3_int64 integer{0};
};

[[nodiscard]] SqlValue nullValue() { return {.type = SqlValueType::Null}; }

[[nodiscard]] SqlValue textValue(QString value) {
  return {.type = SqlValueType::Text, .text = std::move(value)};
}

[[nodiscard]] SqlValue optionalTextValue(const std::optional<QString>& value) {
  return value.has_value() ? textValue(*value) : nullValue();
}

[[nodiscard]] SqlValue integerValue(sqlite3_int64 value) {
  return {.type = SqlValueType::Integer, .integer = value};
}

[[nodiscard]] AppError databaseError(QString message, int result) {
  return AppError(AppErrorCode::Database, message.arg(result));
}

[[nodiscard]] AppError validationError(QString message) {
  return AppError(AppErrorCode::Validation, std::move(message));
}

[[nodiscard]] bool validIdentifier(const QString& value) {
  return !value.isEmpty() && value == value.trimmed() && value.size() <= kMaximumIdentifierLength &&
         !value.contains(QChar::Null);
}

[[nodiscard]] QString timestamp(const Clock& clock) {
  const auto milliseconds =
      std::chrono::duration_cast<std::chrono::milliseconds>(clock.wallNow().time_since_epoch());
  return QDateTime::fromMSecsSinceEpoch(milliseconds.count(), QTimeZone::UTC)
      .toString(Qt::ISODateWithMs);
}

[[nodiscard]] QString localId(QStringView prefix, const QList<QString>& parts) {
  QCryptographicHash hash(QCryptographicHash::Sha256);
  for (const QString& part : parts) {
    hash.addData(part.toUtf8());
    hash.addData(QByteArrayView("\0", 1));
  }
  return prefix.toString() + QString::fromLatin1(hash.result().toHex());
}

[[nodiscard]] QString taskListId(const QString& accountId, const QString& remoteId) {
  return localId(u"g-tl-", {accountId, remoteId});
}

[[nodiscard]] QString
taskId(const QString& accountId, const QString& taskListRemoteId, const QString& remoteId) {
  return localId(u"g-t-", {accountId, taskListRemoteId, remoteId});
}

[[nodiscard]] QString calendarId(const QString& accountId, const QString& remoteId) {
  return localId(u"g-c-", {accountId, remoteId});
}

[[nodiscard]] QString
eventId(const QString& accountId, const QString& calendarRemoteId, const QString& remoteId) {
  return localId(u"g-e-", {accountId, calendarRemoteId, remoteId});
}

[[nodiscard]] std::optional<AppError>
execute(sqlite3* handle, const char* sql, const QList<SqlValue>& values) {
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite mirror preparation failed (%1)"), prepareResult);
  }
  for (qsizetype index = 0; index < values.size(); ++index) {
    const SqlValue& value = values.at(index);
    const int parameter = static_cast<int>(index + 1);
    int bindResult = SQLITE_ERROR;
    switch (value.type) {
    case SqlValueType::Null:
      bindResult = sqlite3_bind_null(statement, parameter);
      break;
    case SqlValueType::Text: {
      const QByteArray utf8 = value.text.toUtf8();
      bindResult = sqlite3_bind_text(
          statement, parameter, utf8.constData(), static_cast<int>(utf8.size()), SQLITE_TRANSIENT);
      break;
    }
    case SqlValueType::Integer:
      bindResult = sqlite3_bind_int64(statement, parameter, value.integer);
      break;
    }
    if (bindResult != SQLITE_OK) {
      sqlite3_finalize(statement);
      return databaseError(QStringLiteral("SQLite mirror binding failed (%1)"), bindResult);
    }
  }
  const int stepResult = sqlite3_step(statement);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite mirror write failed (%1)"), stepResult);
  }
  return finalizeResult == SQLITE_OK
             ? std::nullopt
             : std::optional<AppError>(databaseError(
                   QStringLiteral("SQLite mirror finalization failed (%1)"), finalizeResult));
}

[[nodiscard]] std::optional<AppError>
markTaskListsDeleted(sqlite3* handle, const QString& accountId, const QString& now) {
  return execute(handle,
                 "UPDATE local_task_lists SET deleted_at = ?1, updated_at = ?1 "
                 "WHERE account_id = ?2 AND deleted_at IS NULL "
                 "AND NOT EXISTS (SELECT 1 FROM local_pending_mutations AS mutations "
                 "WHERE mutations.resource_type = 'task_list' "
                 "AND mutations.resource_id = local_task_lists.id "
                 "AND mutations.status IN ('pending', 'applying'))",
                 {textValue(now), textValue(accountId)});
}

[[nodiscard]] std::optional<AppError>
markTasksDeleted(sqlite3* handle, const QString& listId, const QString& now) {
  return execute(handle,
                 "UPDATE local_tasks SET deleted_at = ?1, updated_at = ?1 "
                 "WHERE task_list_id = ?2 AND deleted_at IS NULL "
                 "AND NOT EXISTS (SELECT 1 FROM local_pending_mutations AS mutations "
                 "WHERE mutations.resource_type = 'task' "
                 "AND mutations.resource_id = local_tasks.id "
                 "AND mutations.status IN ('pending', 'applying'))",
                 {textValue(now), textValue(listId)});
}

[[nodiscard]] std::optional<AppError> upsertTaskList(sqlite3* handle,
                                                     const QString& accountId,
                                                     const GoogleTaskListMirror& taskList,
                                                     sqlite3_int64 sortOrder,
                                                     const QString& now) {
  return execute(
      handle,
      "INSERT INTO local_task_lists (id, account_id, remote_id, title, etag, sort_order, "
      "is_selected, remote_updated_at, updated_at, deleted_at) "
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, NULL) "
      "ON CONFLICT(account_id, remote_id) DO UPDATE SET "
      "title = excluded.title, etag = excluded.etag, sort_order = excluded.sort_order, "
      "remote_updated_at = excluded.remote_updated_at, updated_at = excluded.updated_at, "
      "deleted_at = NULL "
      "WHERE NOT EXISTS (SELECT 1 FROM local_pending_mutations AS mutations "
      "WHERE mutations.resource_type = 'task_list' "
      "AND mutations.resource_id = local_task_lists.id "
      "AND mutations.status IN ('pending', 'applying'))",
      {textValue(taskListId(accountId, taskList.id)),
       textValue(accountId),
       textValue(taskList.id),
       textValue(taskList.title),
       optionalTextValue(taskList.etag),
       integerValue(sortOrder),
       optionalTextValue(taskList.updatedAt),
       textValue(now)});
}

[[nodiscard]] std::optional<AppError> upsertTask(sqlite3* handle,
                                                 const QString& accountId,
                                                 const GoogleTaskMirror& task,
                                                 sqlite3_int64 sortOrder,
                                                 const QString& now) {
  const QString localListId = taskListId(accountId, task.taskListId);
  const std::optional<QString> parent =
      task.parentId.has_value()
          ? std::optional<QString>(taskId(accountId, task.taskListId, *task.parentId))
          : std::nullopt;
  const QString state = task.status == GoogleTaskStatus::Completed ? QStringLiteral("completed")
                                                                   : QStringLiteral("active");
  const std::optional<QString> deletedAt =
      task.deleted ? std::optional<QString>(now) : std::nullopt;
  return execute(
      handle,
      "INSERT INTO local_tasks (id, task_list_id, remote_id, parent_task_id, title, notes, state, "
      "due_at, completed_at, remote_position, sort_order, is_hidden, etag, remote_updated_at, "
      "created_at, updated_at, deleted_at) "
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16) "
      "ON CONFLICT(task_list_id, remote_id) DO UPDATE SET "
      "parent_task_id = excluded.parent_task_id, title = excluded.title, notes = excluded.notes, "
      "state = excluded.state, due_at = excluded.due_at, completed_at = excluded.completed_at, "
      "remote_position = excluded.remote_position, sort_order = excluded.sort_order, "
      "is_hidden = excluded.is_hidden, etag = excluded.etag, "
      "remote_updated_at = excluded.remote_updated_at, updated_at = excluded.updated_at, "
      "deleted_at = excluded.deleted_at "
      "WHERE NOT EXISTS (SELECT 1 FROM local_pending_mutations AS mutations "
      "WHERE mutations.resource_type = 'task' "
      "AND mutations.resource_id = local_tasks.id "
      "AND mutations.status IN ('pending', 'applying'))",
      {textValue(taskId(accountId, task.taskListId, task.id)),
       textValue(localListId),
       textValue(task.id),
       optionalTextValue(parent),
       textValue(task.title.left(500)),
       optionalTextValue(task.notes),
       textValue(state),
       optionalTextValue(task.dueAt),
       optionalTextValue(task.completedAt),
       optionalTextValue(task.position),
       integerValue(sortOrder),
       integerValue(task.hidden ? 1 : 0),
       optionalTextValue(task.etag),
       optionalTextValue(task.updatedAt),
       textValue(now),
       optionalTextValue(deletedAt)});
}

[[nodiscard]] std::optional<QString> calendarAccessRole(GoogleCalendarAccessRole role) {
  switch (role) {
  case GoogleCalendarAccessRole::FreeBusyReader:
    return QStringLiteral("freeBusyReader");
  case GoogleCalendarAccessRole::Reader:
    return QStringLiteral("reader");
  case GoogleCalendarAccessRole::Writer:
    return QStringLiteral("writer");
  case GoogleCalendarAccessRole::Owner:
    return QStringLiteral("owner");
  }
  return std::nullopt;
}

[[nodiscard]] std::optional<AppError>
markCalendarsDeleted(sqlite3* handle, const QString& accountId, const QString& now) {
  return execute(handle,
                 "UPDATE local_calendars SET deleted_at = ?1, updated_at = ?1 "
                 "WHERE account_id = ?2 AND deleted_at IS NULL",
                 {textValue(now), textValue(accountId)});
}

[[nodiscard]] std::optional<AppError>
markEventsDeleted(sqlite3* handle, const QString& localCalendarId, const QString& now) {
  return execute(handle,
                 "UPDATE local_calendar_events SET deleted_at = ?1, updated_at = ?1 "
                 "WHERE calendar_id = ?2 AND deleted_at IS NULL "
                 "AND NOT EXISTS (SELECT 1 FROM local_pending_mutations AS mutations "
                 "WHERE mutations.resource_type = 'event' "
                 "AND mutations.resource_id = local_calendar_events.id "
                 "AND mutations.status IN ('pending', 'applying'))",
                 {textValue(now), textValue(localCalendarId)});
}

[[nodiscard]] std::optional<AppError> upsertCalendar(sqlite3* handle,
                                                     const QString& accountId,
                                                     const GoogleCalendarMirror& calendar,
                                                     const QString& now) {
  const std::optional<QString> accessRole =
      calendar.accessRole.has_value() ? calendarAccessRole(*calendar.accessRole) : std::nullopt;
  const std::optional<QString> deletedAt =
      calendar.deleted ? std::optional<QString>(now) : std::nullopt;
  return execute(
      handle,
      "INSERT INTO local_calendars (id, account_id, remote_id, title, description, time_zone, "
      "background_color, foreground_color, access_role, is_selected, is_hidden, is_primary, etag, "
      "updated_at, deleted_at) "
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15) "
      "ON CONFLICT(account_id, remote_id) DO UPDATE SET "
      "title = excluded.title, description = excluded.description, time_zone = excluded.time_zone, "
      "background_color = excluded.background_color, foreground_color = excluded.foreground_color, "
      "access_role = excluded.access_role, is_selected = excluded.is_selected, "
      "is_hidden = excluded.is_hidden, is_primary = excluded.is_primary, etag = excluded.etag, "
      "updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
      {textValue(calendarId(accountId, calendar.id)),
       textValue(accountId),
       textValue(calendar.id),
       textValue(calendar.title.left(500)),
       optionalTextValue(calendar.description),
       optionalTextValue(calendar.timeZone),
       optionalTextValue(calendar.backgroundColor),
       optionalTextValue(calendar.foregroundColor),
       optionalTextValue(accessRole),
       integerValue(calendar.selected ? 1 : 0),
       integerValue(calendar.hidden ? 1 : 0),
       integerValue(calendar.primary ? 1 : 0),
       optionalTextValue(calendar.etag),
       textValue(now),
       optionalTextValue(deletedAt)});
}

[[nodiscard]] QString calendarEventStatus(GoogleCalendarEventStatus status) {
  switch (status) {
  case GoogleCalendarEventStatus::Confirmed:
    return QStringLiteral("confirmed");
  case GoogleCalendarEventStatus::Tentative:
    return QStringLiteral("tentative");
  case GoogleCalendarEventStatus::Cancelled:
    return QStringLiteral("cancelled");
  }
  return {};
}

[[nodiscard]] std::optional<AppError> upsertEvent(sqlite3* handle,
                                                  const QString& accountId,
                                                  const GoogleCalendarEventMirror& event,
                                                  const QString& now) {
  const QString status = calendarEventStatus(event.status);
  const bool cancelled = event.status == GoogleCalendarEventStatus::Cancelled;
  if (status.isEmpty() ||
      (!cancelled && (!event.startAt.has_value() || !event.endAt.has_value()))) {
    return validationError(QStringLiteral("Google calendar event is invalid"));
  }
  const QString startAt = event.startAt.value_or(now);
  const QString endAt = event.endAt.value_or(now);
  const QString recurrence = event.recurrence.join(u'\n');
  if (recurrence.size() > 4'096) {
    return validationError(QStringLiteral("Google calendar recurrence is too large"));
  }
  const std::optional<QString> deletedAt = cancelled ? std::optional<QString>(now) : std::nullopt;
  return execute(
      handle,
      "INSERT INTO local_calendar_events (id, calendar_id, remote_id, recurring_remote_id, "
      "original_start_at, status, title, description, location, start_at, start_time_zone, end_at, "
      "end_time_zone, is_all_day, recurrence_rule, color_id, transparency, visibility, time_zone, "
      "etag, sequence, remote_updated_at, updated_at, deleted_at) "
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, "
      "?18, ?19, ?20, ?21, ?22, ?23, ?24) "
      "ON CONFLICT(calendar_id, remote_id) WHERE remote_id IS NOT NULL DO UPDATE SET "
      "recurring_remote_id = excluded.recurring_remote_id, original_start_at = "
      "excluded.original_start_at, "
      "status = excluded.status, title = excluded.title, description = excluded.description, "
      "location = excluded.location, start_at = excluded.start_at, "
      "start_time_zone = excluded.start_time_zone, end_at = excluded.end_at, "
      "end_time_zone = excluded.end_time_zone, is_all_day = excluded.is_all_day, "
      "recurrence_rule = excluded.recurrence_rule, color_id = excluded.color_id, "
      "transparency = excluded.transparency, visibility = excluded.visibility, "
      "time_zone = excluded.time_zone, etag = excluded.etag, sequence = excluded.sequence, "
      "remote_updated_at = excluded.remote_updated_at, updated_at = excluded.updated_at, "
      "deleted_at = excluded.deleted_at "
      "WHERE NOT EXISTS (SELECT 1 FROM local_pending_mutations AS mutations "
      "WHERE mutations.resource_type = 'event' "
      "AND mutations.resource_id = local_calendar_events.id "
      "AND mutations.status IN ('pending', 'applying'))",
      {textValue(eventId(accountId, event.calendarId, event.id)),
       textValue(calendarId(accountId, event.calendarId)),
       textValue(event.id),
       optionalTextValue(event.recurringEventId),
       optionalTextValue(event.originalStartAt),
       textValue(status),
       textValue(event.title.left(500)),
       optionalTextValue(event.description),
       optionalTextValue(event.location),
       textValue(startAt),
       optionalTextValue(event.startTimeZone),
       textValue(endAt),
       optionalTextValue(event.endTimeZone),
       integerValue(event.allDay ? 1 : 0),
       recurrence.isEmpty() ? nullValue() : textValue(recurrence),
       optionalTextValue(event.colorId),
       optionalTextValue(event.transparency),
       optionalTextValue(event.visibility),
       optionalTextValue(event.timeZone),
       optionalTextValue(event.etag),
       event.sequence.has_value() ? integerValue(*event.sequence) : nullValue(),
       optionalTextValue(event.updatedAt),
       textValue(now),
       optionalTextValue(deletedAt)});
}

[[nodiscard]] GoogleMirrorWriteResult
replaceStoredTasks(SqliteConnection& connection,
                   const QString& accountId,
                   const QList<GoogleTaskListMirror>& taskLists,
                   const QList<GoogleTaskMirror>& tasks,
                   const Clock& clock) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database, QStringLiteral("SQLite task mirror is unavailable"));
  }
  if (!validIdentifier(accountId)) {
    return validationError(QStringLiteral("Google account identifier is invalid"));
  }
  QSet<QString> listIds;
  for (const GoogleTaskListMirror& taskList : taskLists) {
    if (!validIdentifier(taskList.id) || taskList.title.trimmed().isEmpty()) {
      return validationError(QStringLiteral("Google task list is invalid"));
    }
    listIds.insert(taskList.id);
  }
  QHash<QString, QSet<QString>> taskIdsByList;
  for (const GoogleTaskMirror& task : tasks) {
    if (!validIdentifier(task.id) || !listIds.contains(task.taskListId) ||
        task.title.trimmed().isEmpty()) {
      return validationError(QStringLiteral("Google task is invalid"));
    }
    taskIdsByList[task.taskListId].insert(task.id);
  }
  for (const GoogleTaskMirror& task : tasks) {
    if (task.parentId.has_value() && !taskIdsByList[task.taskListId].contains(*task.parentId)) {
      return validationError(QStringLiteral("Google task parent is unavailable"));
    }
  }
  SqliteTransactionResult transactionResult = SqliteTransaction::begin(connection);
  if (std::holds_alternative<AppError>(transactionResult)) {
    return std::get<AppError>(std::move(transactionResult));
  }
  SqliteTransaction transaction = std::move(std::get<SqliteTransaction>(transactionResult));
  const QString now = timestamp(clock);
  if (const std::optional<AppError> error = markTaskListsDeleted(handle, accountId, now);
      error.has_value()) {
    return *error;
  }
  sqlite3_int64 listOrder = 0;
  for (const GoogleTaskListMirror& taskList : taskLists) {
    if (const std::optional<AppError> error =
            upsertTaskList(handle, accountId, taskList, listOrder++, now);
        error.has_value()) {
      return *error;
    }
    if (const std::optional<AppError> error =
            markTasksDeleted(handle, taskListId(accountId, taskList.id), now);
        error.has_value()) {
      return *error;
    }
  }
  QHash<QString, sqlite3_int64> taskOrders;
  for (const GoogleTaskMirror& task : tasks) {
    sqlite3_int64& order = taskOrders[task.taskListId];
    if (const std::optional<AppError> error = upsertTask(handle, accountId, task, order++, now);
        error.has_value()) {
      return *error;
    }
  }
  if (const std::optional<AppError> error = transaction.commit(); error.has_value()) {
    return *error;
  }
  return std::monostate{};
}

[[nodiscard]] GoogleMirrorWriteResult
replaceStoredCalendars(SqliteConnection& connection,
                       const QString& accountId,
                       const QList<GoogleCalendarMirror>& calendars,
                       const QList<GoogleCalendarEventMirror>& events,
                       const Clock& clock) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite calendar mirror is unavailable"));
  }
  if (!validIdentifier(accountId)) {
    return validationError(QStringLiteral("Google account identifier is invalid"));
  }
  QSet<QString> calendarIds;
  for (const GoogleCalendarMirror& calendar : calendars) {
    if (!validIdentifier(calendar.id) || calendar.title.trimmed().isEmpty()) {
      return validationError(QStringLiteral("Google calendar is invalid"));
    }
    calendarIds.insert(calendar.id);
  }
  for (const GoogleCalendarEventMirror& event : events) {
    if (!validIdentifier(event.id) || !calendarIds.contains(event.calendarId) ||
        event.title.trimmed().isEmpty()) {
      return validationError(QStringLiteral("Google calendar event is invalid"));
    }
  }
  SqliteTransactionResult transactionResult = SqliteTransaction::begin(connection);
  if (std::holds_alternative<AppError>(transactionResult)) {
    return std::get<AppError>(std::move(transactionResult));
  }
  SqliteTransaction transaction = std::move(std::get<SqliteTransaction>(transactionResult));
  const QString now = timestamp(clock);
  if (const std::optional<AppError> error = markCalendarsDeleted(handle, accountId, now);
      error.has_value()) {
    return *error;
  }
  for (const GoogleCalendarMirror& calendar : calendars) {
    if (const std::optional<AppError> error = upsertCalendar(handle, accountId, calendar, now);
        error.has_value()) {
      return *error;
    }
    if (const std::optional<AppError> error =
            markEventsDeleted(handle, calendarId(accountId, calendar.id), now);
        error.has_value()) {
      return *error;
    }
  }
  for (const GoogleCalendarEventMirror& event : events) {
    if (const std::optional<AppError> error = upsertEvent(handle, accountId, event, now);
        error.has_value()) {
      return *error;
    }
  }
  if (const std::optional<AppError> error = transaction.commit(); error.has_value()) {
    return *error;
  }
  return std::monostate{};
}

} // namespace

GoogleMirrorStore::GoogleMirrorStore(FilePath databasePath, const Clock& clock)
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

std::shared_future<SqliteWriteResult> GoogleMirrorStore::ready() const { return initialization_; }

std::future<GoogleMirrorWriteResult> GoogleMirrorStore::replaceTasks(
    QString accountId, QList<GoogleTaskListMirror> taskLists, QList<GoogleTaskMirror> tasks) {
  return writerQueue_.enqueueResult([this,
                                     accountId = std::move(accountId),
                                     taskLists = std::move(taskLists),
                                     tasks = std::move(tasks)](SqliteConnection& connection) {
    return replaceStoredTasks(connection, accountId, taskLists, tasks, clock_);
  });
}

std::future<GoogleMirrorWriteResult>
GoogleMirrorStore::replaceCalendars(QString accountId,
                                    QList<GoogleCalendarMirror> calendars,
                                    QList<GoogleCalendarEventMirror> events) {
  return writerQueue_.enqueueResult([this,
                                     accountId = std::move(accountId),
                                     calendars = std::move(calendars),
                                     events = std::move(events)](SqliteConnection& connection) {
    return replaceStoredCalendars(connection, accountId, calendars, events, clock_);
  });
}

} // namespace hcb
