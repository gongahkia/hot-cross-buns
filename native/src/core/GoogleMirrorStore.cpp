#include "core/GoogleMirrorStore.h"

#include "core/TaskRecurrenceMarker.h"
#include "data/LocalSchema.h"
#include "data/SqliteTransaction.h"
#include "sqlite3.h"

#include <QByteArray>
#include <QCryptographicHash>
#include <QDateTime>
#include <QJsonDocument>
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

struct StoredTaskRecurrence final {
  std::optional<QString> notes;
  std::optional<QString> diagnostic;
};

[[nodiscard]] std::optional<StoredTaskRecurrence>
readStoredTaskRecurrence(sqlite3* handle, const QString& localTaskListId, const QString& remoteTaskId) {
  constexpr char sql[] = R"(
SELECT notes, recurrence_diagnostic
FROM local_tasks
WHERE task_list_id = ?1 AND remote_id = ?2
LIMIT 1
)";
  sqlite3_stmt* statement = nullptr;
  if (sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr) !=
      SQLITE_OK) {
    sqlite3_finalize(statement);
    return std::nullopt;
  }
  const QByteArray listId = localTaskListId.toUtf8();
  const QByteArray taskId = remoteTaskId.toUtf8();
  if (sqlite3_bind_text(statement,
                        1,
                        listId.constData(),
                        static_cast<int>(listId.size()),
                        SQLITE_TRANSIENT) != SQLITE_OK ||
      sqlite3_bind_text(statement,
                        2,
                        taskId.constData(),
                        static_cast<int>(taskId.size()),
                        SQLITE_TRANSIENT) != SQLITE_OK) {
    sqlite3_finalize(statement);
    return std::nullopt;
  }
  if (sqlite3_step(statement) != SQLITE_ROW) {
    sqlite3_finalize(statement);
    return std::nullopt;
  }
  const auto optionalColumnText = [](sqlite3_stmt* source, int index) -> std::optional<QString> {
    if (sqlite3_column_type(source, index) == SQLITE_NULL) {
      return std::nullopt;
    }
    const auto* value = reinterpret_cast<const char*>(sqlite3_column_text(source, index));
    const int size = sqlite3_column_bytes(source, index);
    return value == nullptr || size < 0 ? std::nullopt
                                        : std::optional<QString>(QString::fromUtf8(value, size));
  };
  StoredTaskRecurrence recurrence{.notes = optionalColumnText(statement, 0),
                                  .diagnostic = optionalColumnText(statement, 1)};
  return sqlite3_finalize(statement) == SQLITE_OK ? std::optional<StoredTaskRecurrence>(recurrence)
                                                   : std::nullopt;
}

[[nodiscard]] std::optional<QString>
recurrenceMarkerFingerprint(const TaskRecurrenceMarker& marker) {
  const TaskRecurrenceSerializationResult serialized = serializeTaskRecurrenceNotes({}, marker);
  return serialized.error.has_value() ? std::nullopt : std::optional<QString>(serialized.notes);
}

[[nodiscard]] std::optional<QString>
recurrenceDiagnostic(const std::optional<StoredTaskRecurrence>& previous,
                     const GoogleTaskMirror& incoming) {
  const TaskRecurrenceNotes incomingRecurrence =
      parseTaskRecurrenceNotes(incoming.notes.value_or(QString()));
  if (incomingRecurrence.state == TaskRecurrenceNotesState::Malformed ||
      incomingRecurrence.state == TaskRecurrenceNotesState::UnsupportedVersion) {
    return QStringLiteral("Managed recurrence marker is malformed in Google Tasks");
  }
  if (incomingRecurrence.state == TaskRecurrenceNotesState::Managed && incoming.isAssigned) {
    return QStringLiteral("Managed recurrence is unavailable for an assigned Google Task");
  }
  if (!previous.has_value()) {
    return std::nullopt;
  }
  const TaskRecurrenceNotes previousRecurrence =
      parseTaskRecurrenceNotes(previous->notes.value_or(QString()));
  if (previousRecurrence.state != TaskRecurrenceNotesState::Managed ||
      !previousRecurrence.marker.has_value()) {
    return std::nullopt;
  }
  if (incomingRecurrence.state != TaskRecurrenceNotesState::Managed ||
      !incomingRecurrence.marker.has_value()) {
    return QStringLiteral("Managed recurrence marker was removed in Google Tasks");
  }
  const std::optional<QString> previousFingerprint =
      recurrenceMarkerFingerprint(*previousRecurrence.marker);
  const std::optional<QString> incomingFingerprint =
      recurrenceMarkerFingerprint(*incomingRecurrence.marker);
  if (!previousFingerprint.has_value() || !incomingFingerprint.has_value() ||
      *previousFingerprint != *incomingFingerprint) {
    return QStringLiteral("Managed recurrence marker changed in Google Tasks");
  }
  return std::nullopt;
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
                 "AND (mutations.status IN ('pending', 'applying') "
                 "OR (mutations.status = 'failed' AND mutations.next_retry_at IS NOT NULL))) "
                 "AND NOT EXISTS (SELECT 1 FROM local_tasks AS tasks "
                 "JOIN local_pending_mutations AS mutations ON mutations.resource_id = tasks.id "
                 "WHERE tasks.task_list_id = local_task_lists.id "
                 "AND mutations.resource_type = 'task' "
                 "AND (mutations.status IN ('pending', 'applying') "
                 "OR (mutations.status = 'failed' AND mutations.next_retry_at IS NOT NULL)))",
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
                 "AND (mutations.status IN ('pending', 'applying') "
                 "OR (mutations.status = 'failed' AND mutations.next_retry_at IS NOT NULL)))",
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
      "AND (mutations.status IN ('pending', 'applying') "
      "OR (mutations.status = 'failed' AND mutations.next_retry_at IS NOT NULL))) "
      "AND (local_task_lists.title IS NOT excluded.title "
      "OR local_task_lists.etag IS NOT excluded.etag "
      "OR local_task_lists.sort_order IS NOT excluded.sort_order "
      "OR local_task_lists.remote_updated_at IS NOT excluded.remote_updated_at "
      "OR local_task_lists.deleted_at IS NOT NULL)",
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
  const std::optional<QString> diagnostic = recurrenceDiagnostic(
      readStoredTaskRecurrence(handle, localListId, task.id), task);
  return execute(
      handle,
      "INSERT INTO local_tasks (id, task_list_id, remote_id, parent_task_id, title, notes, state, "
      "due_at, completed_at, remote_position, sort_order, is_hidden, etag, remote_updated_at, "
      "is_assigned, recurrence_diagnostic, created_at, updated_at, deleted_at) "
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17, "
      "?18) "
      "ON CONFLICT(task_list_id, remote_id) DO UPDATE SET "
      "parent_task_id = excluded.parent_task_id, title = excluded.title, notes = excluded.notes, "
      "state = excluded.state, due_at = excluded.due_at, completed_at = excluded.completed_at, "
      "remote_position = excluded.remote_position, sort_order = excluded.sort_order, "
      "is_hidden = excluded.is_hidden, is_assigned = excluded.is_assigned, "
      "recurrence_diagnostic = excluded.recurrence_diagnostic, etag = excluded.etag, "
      "remote_updated_at = excluded.remote_updated_at, updated_at = excluded.updated_at, "
      "deleted_at = excluded.deleted_at "
      "WHERE NOT EXISTS (SELECT 1 FROM local_pending_mutations AS mutations "
      "WHERE mutations.resource_type = 'task' "
      "AND mutations.resource_id = local_tasks.id "
      "AND (mutations.status IN ('pending', 'applying') "
      "OR (mutations.status = 'failed' AND mutations.next_retry_at IS NOT NULL))) "
      "AND (local_tasks.parent_task_id IS NOT excluded.parent_task_id "
      "OR local_tasks.title IS NOT excluded.title "
      "OR local_tasks.notes IS NOT excluded.notes "
      "OR local_tasks.state IS NOT excluded.state "
      "OR local_tasks.due_at IS NOT excluded.due_at "
      "OR local_tasks.completed_at IS NOT excluded.completed_at "
      "OR local_tasks.remote_position IS NOT excluded.remote_position "
      "OR local_tasks.sort_order IS NOT excluded.sort_order "
      "OR local_tasks.is_hidden IS NOT excluded.is_hidden "
      "OR local_tasks.is_assigned IS NOT excluded.is_assigned "
      "OR local_tasks.recurrence_diagnostic IS NOT excluded.recurrence_diagnostic "
      "OR local_tasks.etag IS NOT excluded.etag "
      "OR local_tasks.remote_updated_at IS NOT excluded.remote_updated_at "
      "OR local_tasks.deleted_at IS NOT excluded.deleted_at)",
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
       integerValue(task.isAssigned ? 1 : 0),
       optionalTextValue(diagnostic),
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
                 "WHERE account_id = ?2 AND deleted_at IS NULL "
                 "AND NOT EXISTS (SELECT 1 FROM local_calendar_events AS events "
                 "JOIN local_pending_mutations AS mutations ON mutations.resource_id = events.id "
                 "WHERE events.calendar_id = local_calendars.id "
                 "AND mutations.resource_type = 'event' "
                 "AND (mutations.status IN ('pending', 'applying') "
                 "OR (mutations.status = 'failed' AND mutations.next_retry_at IS NOT NULL)))",
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
                 "AND (mutations.status IN ('pending', 'applying') "
                 "OR (mutations.status = 'failed' AND mutations.next_retry_at IS NOT NULL)))",
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
      "updated_at = excluded.updated_at, "
      "deleted_at = CASE WHEN excluded.deleted_at IS NOT NULL AND EXISTS ("
      "SELECT 1 FROM local_calendar_events AS events "
      "JOIN local_pending_mutations AS mutations ON mutations.resource_id = events.id "
      "WHERE events.calendar_id = local_calendars.id "
      "AND mutations.resource_type = 'event' "
      "AND (mutations.status IN ('pending', 'applying') "
      "OR (mutations.status = 'failed' AND mutations.next_retry_at IS NOT NULL))) "
      "THEN local_calendars.deleted_at ELSE excluded.deleted_at END",
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
  const QString attendeeDetails =
      QString::fromUtf8(QJsonDocument(event.attendees).toJson(QJsonDocument::Compact));
  QJsonArray attendeeEmails;
  for (const QJsonValue& attendee : event.attendees) {
    const QJsonValue email = attendee.toObject().value(QStringLiteral("email"));
    if (email.isString()) {
      attendeeEmails.append(email.toString());
    }
  }
  const QString attendeeEmailJson =
      QString::fromUtf8(QJsonDocument(attendeeEmails).toJson(QJsonDocument::Compact));
  const QJsonArray reminderOverrides =
      event.reminders.value(QStringLiteral("overrides")).toArray();
  const QString reminderJson =
      QString::fromUtf8(QJsonDocument(reminderOverrides).toJson(QJsonDocument::Compact));
  QJsonArray reminderMinutes;
  for (const QJsonValue& reminder : reminderOverrides) {
    reminderMinutes.append(reminder.toObject().value(QStringLiteral("minutes")).toInteger());
  }
  const QString reminderMinuteJson =
      QString::fromUtf8(QJsonDocument(reminderMinutes).toJson(QJsonDocument::Compact));
  const QJsonValue useDefault = event.reminders.value(QStringLiteral("useDefault"));
  const bool remindersUseDefault = !useDefault.isBool() || useDefault.toBool();
  return execute(
      handle,
      "INSERT INTO local_calendar_events (id, calendar_id, remote_id, recurring_remote_id, "
      "original_start_at, status, title, description, location, start_at, start_time_zone, end_at, "
      "end_time_zone, is_all_day, recurrence_rule, color_id, transparency, visibility, time_zone, "
      "event_type, attendee_emails_json, attendee_details_json, reminder_minutes_json, "
      "reminders_json, "
      "reminders_use_default, etag, sequence, remote_updated_at, updated_at, deleted_at) "
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, "
      "?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30) "
      "ON CONFLICT(calendar_id, remote_id) WHERE remote_id IS NOT NULL DO UPDATE SET "
      "recurring_remote_id = excluded.recurring_remote_id, original_start_at = "
      "excluded.original_start_at, "
      "status = excluded.status, title = excluded.title, description = excluded.description, "
      "location = excluded.location, start_at = excluded.start_at, "
      "start_time_zone = excluded.start_time_zone, end_at = excluded.end_at, "
      "end_time_zone = excluded.end_time_zone, is_all_day = excluded.is_all_day, "
      "recurrence_rule = excluded.recurrence_rule, color_id = excluded.color_id, "
      "transparency = excluded.transparency, visibility = excluded.visibility, "
      "time_zone = excluded.time_zone, event_type = excluded.event_type, "
      "attendee_emails_json = excluded.attendee_emails_json, "
      "attendee_details_json = excluded.attendee_details_json, "
      "reminder_minutes_json = excluded.reminder_minutes_json, reminders_json = "
      "excluded.reminders_json, "
      "reminders_use_default = excluded.reminders_use_default, etag = excluded.etag, "
      "sequence = excluded.sequence, "
      "remote_updated_at = excluded.remote_updated_at, updated_at = excluded.updated_at, "
      "deleted_at = excluded.deleted_at "
      "WHERE NOT EXISTS (SELECT 1 FROM local_pending_mutations AS mutations "
      "WHERE mutations.resource_type = 'event' "
      "AND mutations.resource_id = local_calendar_events.id "
      "AND (mutations.status IN ('pending', 'applying') "
      "OR (mutations.status = 'failed' AND mutations.next_retry_at IS NOT NULL))) "
      "AND (local_calendar_events.recurring_remote_id IS NOT excluded.recurring_remote_id "
      "OR local_calendar_events.original_start_at IS NOT excluded.original_start_at "
      "OR local_calendar_events.status IS NOT excluded.status "
      "OR local_calendar_events.title IS NOT excluded.title "
      "OR local_calendar_events.description IS NOT excluded.description "
      "OR local_calendar_events.location IS NOT excluded.location "
      "OR local_calendar_events.start_at IS NOT excluded.start_at "
      "OR local_calendar_events.start_time_zone IS NOT excluded.start_time_zone "
      "OR local_calendar_events.end_at IS NOT excluded.end_at "
      "OR local_calendar_events.end_time_zone IS NOT excluded.end_time_zone "
      "OR local_calendar_events.is_all_day IS NOT excluded.is_all_day "
      "OR local_calendar_events.recurrence_rule IS NOT excluded.recurrence_rule "
      "OR local_calendar_events.color_id IS NOT excluded.color_id "
      "OR local_calendar_events.transparency IS NOT excluded.transparency "
      "OR local_calendar_events.visibility IS NOT excluded.visibility "
      "OR local_calendar_events.time_zone IS NOT excluded.time_zone "
      "OR local_calendar_events.event_type IS NOT excluded.event_type "
      "OR local_calendar_events.attendee_emails_json IS NOT excluded.attendee_emails_json "
      "OR local_calendar_events.attendee_details_json IS NOT excluded.attendee_details_json "
      "OR local_calendar_events.reminder_minutes_json IS NOT excluded.reminder_minutes_json "
      "OR local_calendar_events.reminders_json IS NOT excluded.reminders_json "
      "OR local_calendar_events.reminders_use_default IS NOT excluded.reminders_use_default "
      "OR local_calendar_events.etag IS NOT excluded.etag "
      "OR local_calendar_events.sequence IS NOT excluded.sequence "
      "OR local_calendar_events.remote_updated_at IS NOT excluded.remote_updated_at "
      "OR local_calendar_events.deleted_at IS NOT excluded.deleted_at)",
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
       nullValue(),
       optionalTextValue(event.eventType),
       textValue(attendeeEmailJson),
       textValue(attendeeDetails),
       textValue(reminderMinuteJson),
       textValue(reminderJson),
       integerValue(remindersUseDefault ? 1 : 0),
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
mergeStoredTaskLists(SqliteConnection& connection,
                     const QString& accountId,
                     const QList<GoogleTaskListMirror>& taskLists,
                     bool fullReconciliation,
                     const Clock& clock) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database, QStringLiteral("SQLite task mirror is unavailable"));
  }
  if (!validIdentifier(accountId)) {
    return validationError(QStringLiteral("Google account identifier is invalid"));
  }
  for (const GoogleTaskListMirror& taskList : taskLists) {
    if (!validIdentifier(taskList.id) || taskList.title.trimmed().isEmpty()) {
      return validationError(QStringLiteral("Google task list is invalid"));
    }
  }
  SqliteTransactionResult transactionResult = SqliteTransaction::begin(connection);
  if (std::holds_alternative<AppError>(transactionResult)) {
    return std::get<AppError>(std::move(transactionResult));
  }
  SqliteTransaction transaction = std::move(std::get<SqliteTransaction>(transactionResult));
  const QString now = timestamp(clock);
  if (fullReconciliation) {
    if (const std::optional<AppError> error = markTaskListsDeleted(handle, accountId, now);
        error.has_value()) {
      return *error;
    }
  }
  sqlite3_int64 sortOrder = 0;
  for (const GoogleTaskListMirror& taskList : taskLists) {
    if (const std::optional<AppError> error =
            upsertTaskList(handle, accountId, taskList, sortOrder++, now);
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
mergeStoredTasks(SqliteConnection& connection,
                 const QString& accountId,
                 const QString& taskListRemoteId,
                 const QList<GoogleTaskMirror>& tasks,
                 bool fullReconciliation,
                 const Clock& clock) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database, QStringLiteral("SQLite task mirror is unavailable"));
  }
  if (!validIdentifier(accountId) || !validIdentifier(taskListRemoteId)) {
    return validationError(QStringLiteral("Google task mirror identity is invalid"));
  }
  QSet<QString> taskIds;
  for (const GoogleTaskMirror& task : tasks) {
    if (!validIdentifier(task.id) || task.taskListId != taskListRemoteId ||
        task.title.trimmed().isEmpty()) {
      return validationError(QStringLiteral("Google task is invalid"));
    }
    taskIds.insert(task.id);
  }
  if (fullReconciliation) {
    for (const GoogleTaskMirror& task : tasks) {
      if (task.parentId.has_value() && !taskIds.contains(*task.parentId)) {
        return validationError(QStringLiteral("Google task parent is unavailable"));
      }
    }
  }
  SqliteTransactionResult transactionResult = SqliteTransaction::begin(connection);
  if (std::holds_alternative<AppError>(transactionResult)) {
    return std::get<AppError>(std::move(transactionResult));
  }
  SqliteTransaction transaction = std::move(std::get<SqliteTransaction>(transactionResult));
  const QString now = timestamp(clock);
  const QString localListId = taskListId(accountId, taskListRemoteId);
  if (fullReconciliation) {
    if (const std::optional<AppError> error = markTasksDeleted(handle, localListId, now);
        error.has_value()) {
      return *error;
    }
  }
  sqlite3_int64 sortOrder = 0;
  for (const GoogleTaskMirror& task : tasks) {
    if (const std::optional<AppError> error = upsertTask(handle, accountId, task, sortOrder++, now);
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

[[nodiscard]] GoogleMirrorWriteResult
mergeStoredCalendars(SqliteConnection& connection,
                     const QString& accountId,
                     const QList<GoogleCalendarMirror>& calendars,
                     bool fullReconciliation,
                     const Clock& clock) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite calendar mirror is unavailable"));
  }
  if (!validIdentifier(accountId)) {
    return validationError(QStringLiteral("Google account identifier is invalid"));
  }
  for (const GoogleCalendarMirror& calendar : calendars) {
    if (!validIdentifier(calendar.id) || calendar.title.trimmed().isEmpty()) {
      return validationError(QStringLiteral("Google calendar is invalid"));
    }
  }
  SqliteTransactionResult transactionResult = SqliteTransaction::begin(connection);
  if (std::holds_alternative<AppError>(transactionResult)) {
    return std::get<AppError>(std::move(transactionResult));
  }
  SqliteTransaction transaction = std::move(std::get<SqliteTransaction>(transactionResult));
  const QString now = timestamp(clock);
  if (fullReconciliation) {
    if (const std::optional<AppError> error = markCalendarsDeleted(handle, accountId, now);
        error.has_value()) {
      return *error;
    }
  }
  for (const GoogleCalendarMirror& calendar : calendars) {
    if (const std::optional<AppError> error = upsertCalendar(handle, accountId, calendar, now);
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
mergeStoredCalendarEvents(SqliteConnection& connection,
                          const QString& accountId,
                          const QString& calendarRemoteId,
                          const QList<GoogleCalendarEventMirror>& events,
                          bool fullReconciliation,
                          const Clock& clock) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite calendar mirror is unavailable"));
  }
  if (!validIdentifier(accountId) || !validIdentifier(calendarRemoteId)) {
    return validationError(QStringLiteral("Google calendar mirror identity is invalid"));
  }
  for (const GoogleCalendarEventMirror& event : events) {
    if (!validIdentifier(event.id) || event.calendarId != calendarRemoteId ||
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
  if (fullReconciliation) {
    if (const std::optional<AppError> error =
            markEventsDeleted(handle, calendarId(accountId, calendarRemoteId), now);
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
GoogleMirrorStore::mergeTaskLists(QString accountId,
                                  QList<GoogleTaskListMirror> taskLists,
                                  bool fullReconciliation) {
  return writerQueue_.enqueueResult([this,
                                     accountId = std::move(accountId),
                                     taskLists = std::move(taskLists),
                                     fullReconciliation](SqliteConnection& connection) {
    return mergeStoredTaskLists(connection, accountId, taskLists, fullReconciliation, clock_);
  });
}

std::future<GoogleMirrorWriteResult>
GoogleMirrorStore::mergeTasks(QString accountId,
                              QString taskListRemoteId,
                              QList<GoogleTaskMirror> tasks,
                              bool fullReconciliation) {
  return writerQueue_.enqueueResult([this,
                                     accountId = std::move(accountId),
                                     taskListRemoteId = std::move(taskListRemoteId),
                                     tasks = std::move(tasks),
                                     fullReconciliation](SqliteConnection& connection) {
    return mergeStoredTasks(
        connection, accountId, taskListRemoteId, tasks, fullReconciliation, clock_);
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

std::future<GoogleMirrorWriteResult>
GoogleMirrorStore::mergeCalendars(QString accountId,
                                  QList<GoogleCalendarMirror> calendars,
                                  bool fullReconciliation) {
  return writerQueue_.enqueueResult([this,
                                     accountId = std::move(accountId),
                                     calendars = std::move(calendars),
                                     fullReconciliation](SqliteConnection& connection) {
    return mergeStoredCalendars(connection, accountId, calendars, fullReconciliation, clock_);
  });
}

std::future<GoogleMirrorWriteResult>
GoogleMirrorStore::mergeCalendarEvents(QString accountId,
                                       QString calendarRemoteId,
                                       QList<GoogleCalendarEventMirror> events,
                                       bool fullReconciliation) {
  return writerQueue_.enqueueResult([this,
                                     accountId = std::move(accountId),
                                     calendarRemoteId = std::move(calendarRemoteId),
                                     events = std::move(events),
                                     fullReconciliation](SqliteConnection& connection) {
    return mergeStoredCalendarEvents(
        connection, accountId, calendarRemoteId, events, fullReconciliation, clock_);
  });
}

} // namespace hcb
