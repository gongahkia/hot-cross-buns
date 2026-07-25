#include "core/NoteService.h"

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
#include <limits>
#include <optional>
#include <utility>
#include <variant>

namespace hcb {
namespace {

constexpr qsizetype kMaximumIdentifierLength = 256;
constexpr qsizetype kMaximumTitleLength = 500;
constexpr qsizetype kMaximumBodyLength = 10'000;
constexpr std::int64_t kMaximumPageLimit = 100;

using NoteDecodeResult = std::variant<NoteSummary, AppError>;

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

[[nodiscard]] bool isValidBody(const QString& value) {
  return value.size() <= kMaximumBodyLength && !value.contains(QChar::Null);
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
    return databaseError(QStringLiteral("SQLite note binding failed (%1)"), result);
  }
  return std::nullopt;
}

[[nodiscard]] std::optional<AppError>
bindOptionalText(sqlite3_stmt* statement, int index, const std::optional<QString>& value) {
  if (!value.has_value()) {
    const int result = sqlite3_bind_null(statement, index);
    if (result != SQLITE_OK) {
      return databaseError(QStringLiteral("SQLite note binding failed (%1)"), result);
    }
    return std::nullopt;
  }
  return bindText(statement, index, *value);
}

[[nodiscard]] std::optional<AppError>
bindInteger(sqlite3_stmt* statement, int index, std::int64_t value) {
  const int result = sqlite3_bind_int64(statement, index, value);
  if (result != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite note binding failed (%1)"), result);
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
  const int byteCount = sqlite3_column_bytes(statement, index);
  if (value == nullptr || byteCount < 0) {
    return std::nullopt;
  }
  return QString::fromUtf8(value, byteCount);
}

[[nodiscard]] std::optional<QString> requiredText(sqlite3_stmt* statement, int index) {
  return sqlite3_column_type(statement, index) == SQLITE_TEXT ? optionalText(statement, index)
                                                              : std::nullopt;
}

[[nodiscard]] NoteDecodeResult decodeNote(sqlite3_stmt* statement) {
  const std::optional<QString> id = requiredText(statement, 0);
  const std::optional<QString> taskListId = requiredText(statement, 1);
  const std::optional<QString> taskListTitle = requiredText(statement, 2);
  const std::optional<QString> title = requiredText(statement, 3);
  const std::optional<QString> body = requiredText(statement, 4);
  const std::optional<QString> updatedAt = requiredText(statement, 5);
  if (!id.has_value() || !taskListId.has_value() || !taskListTitle.has_value() ||
      !title.has_value() || !body.has_value() || !updatedAt.has_value()) {
    return AppError(AppErrorCode::Database, QStringLiteral("Stored note row is invalid"));
  }
  return NoteSummary{.id = *id,
                     .taskListId = *taskListId,
                     .taskListTitle = *taskListTitle,
                     .title = *title,
                     .body = *body,
                     .updatedAt = *updatedAt};
}

constexpr char noteProjectionSql[] = R"(
SELECT tasks.id, tasks.task_list_id, lists.title, tasks.title, COALESCE(tasks.notes, ''),
       tasks.updated_at
FROM local_tasks AS tasks
INNER JOIN local_task_lists AS lists ON lists.id = tasks.task_list_id
WHERE tasks.deleted_at IS NULL
  AND tasks.is_hidden = 0
  AND tasks.state = 'active'
  AND tasks.parent_task_id IS NULL
  AND tasks.due_at IS NULL
  AND lists.deleted_at IS NULL
)";

constexpr char noteCountSql[] = R"(
SELECT COUNT(*)
FROM local_tasks AS tasks
INNER JOIN local_task_lists AS lists ON lists.id = tasks.task_list_id
WHERE tasks.deleted_at IS NULL
  AND tasks.is_hidden = 0
  AND tasks.state = 'active'
  AND tasks.parent_task_id IS NULL
  AND tasks.due_at IS NULL
  AND lists.deleted_at IS NULL
)";

[[nodiscard]] NoteLookupResult readStoredNote(SqliteConnection& connection, const QString& noteId) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite note connection is unavailable"));
  }
  const QByteArray sql = QString::fromLatin1(noteProjectionSql)
                             .append(QStringLiteral(" AND tasks.id = ?1 LIMIT 1"))
                             .toUtf8();
  sqlite3_stmt* statement = nullptr;
  const int prepareResult = sqlite3_prepare_v3(
      handle, sql.constData(), -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite note lookup preparation failed (%1)"),
                         prepareResult);
  }
  if (const std::optional<AppError> error = bindText(statement, 1, noteId); error.has_value()) {
    sqlite3_finalize(statement);
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  if (stepResult == SQLITE_DONE) {
    const int finalizeResult = sqlite3_finalize(statement);
    return finalizeResult == SQLITE_OK
               ? NoteLookupResult(std::optional<NoteSummary>{})
               : NoteLookupResult(
                     databaseError(QStringLiteral("SQLite note lookup finalization failed (%1)"),
                                   finalizeResult));
  }
  if (stepResult != SQLITE_ROW) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite note lookup failed (%1)"), stepResult);
  }
  const NoteDecodeResult decoded = decodeNote(statement);
  const int finalizeResult = sqlite3_finalize(statement);
  if (std::holds_alternative<AppError>(decoded)) {
    return std::get<AppError>(decoded);
  }
  if (finalizeResult != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite note lookup finalization failed (%1)"),
                         finalizeResult);
  }
  return std::optional<NoteSummary>(std::get<NoteSummary>(decoded));
}

[[nodiscard]] NotePageResult readStoredNotes(SqliteConnection& connection,
                                             const NoteListRequest& request) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite note connection is unavailable"));
  }
  const int limitIndex = request.taskListId.has_value() ? 2 : 1;
  const QByteArray sql =
      QString::fromLatin1(noteProjectionSql)
          .append(request.taskListId.has_value() ? QStringLiteral(" AND tasks.task_list_id = ?1")
                                                 : QString())
          .append(QStringLiteral(" ORDER BY tasks.updated_at DESC, tasks.id ASC"))
          .append(QStringLiteral(" LIMIT ?%1 OFFSET ?%2").arg(limitIndex).arg(limitIndex + 1))
          .toUtf8();
  sqlite3_stmt* statement = nullptr;
  const int prepareResult = sqlite3_prepare_v3(
      handle, sql.constData(), -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite note list preparation failed (%1)"), prepareResult);
  }
  if (request.taskListId.has_value()) {
    if (const std::optional<AppError> error = bindText(statement, 1, *request.taskListId);
        error.has_value()) {
      sqlite3_finalize(statement);
      return *error;
    }
  }
  if (const std::optional<AppError> error = bindInteger(statement, limitIndex, request.limit);
      error.has_value()) {
    sqlite3_finalize(statement);
    return *error;
  }
  if (const std::optional<AppError> error = bindInteger(statement, limitIndex + 1, request.offset);
      error.has_value()) {
    sqlite3_finalize(statement);
    return *error;
  }
  QList<NoteSummary> items;
  while (true) {
    const int stepResult = sqlite3_step(statement);
    if (stepResult == SQLITE_DONE) {
      break;
    }
    if (stepResult != SQLITE_ROW) {
      sqlite3_finalize(statement);
      return databaseError(QStringLiteral("SQLite note list failed (%1)"), stepResult);
    }
    const NoteDecodeResult decoded = decodeNote(statement);
    if (std::holds_alternative<AppError>(decoded)) {
      sqlite3_finalize(statement);
      return std::get<AppError>(decoded);
    }
    items.append(std::get<NoteSummary>(decoded));
  }
  const int finalizeResult = sqlite3_finalize(statement);
  if (finalizeResult != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite note list finalization failed (%1)"),
                         finalizeResult);
  }
  QString countSql = QString::fromLatin1(noteCountSql);
  if (request.taskListId.has_value()) {
    countSql.append(QStringLiteral(" AND tasks.task_list_id = ?1"));
  }
  const QByteArray countSqlUtf8 = countSql.toUtf8();
  sqlite3_stmt* countStatement = nullptr;
  const int countPrepareResult = sqlite3_prepare_v3(
      handle, countSqlUtf8.constData(), -1, SQLITE_PREPARE_PERSISTENT, &countStatement, nullptr);
  if (countPrepareResult != SQLITE_OK) {
    sqlite3_finalize(countStatement);
    return databaseError(QStringLiteral("SQLite note count preparation failed (%1)"),
                         countPrepareResult);
  }
  if (request.taskListId.has_value()) {
    if (const std::optional<AppError> error = bindText(countStatement, 1, *request.taskListId);
        error.has_value()) {
      sqlite3_finalize(countStatement);
      return *error;
    }
  }
  const int countStepResult = sqlite3_step(countStatement);
  const std::int64_t totalKnown = sqlite3_column_int64(countStatement, 0);
  const int countFinalizeResult = sqlite3_finalize(countStatement);
  if (countStepResult != SQLITE_ROW || totalKnown < 0) {
    return databaseError(QStringLiteral("SQLite note count failed (%1)"), countStepResult);
  }
  if (countFinalizeResult != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite note count finalization failed (%1)"),
                         countFinalizeResult);
  }
  const std::int64_t consumed = request.offset + static_cast<std::int64_t>(items.size());
  return NotePage{.items = std::move(items),
                  .nextOffset =
                      consumed < totalKnown ? std::optional<std::int64_t>(consumed) : std::nullopt,
                  .totalKnown = totalKnown};
}

[[nodiscard]] NoteMutationResult createStoredNote(SqliteConnection& connection,
                                                  const NoteCreateInput& input,
                                                  const QString& noteId,
                                                  const QString& remoteId,
                                                  const QString& updatedAt) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite note connection is unavailable"));
  }
  constexpr char sql[] = R"(
INSERT INTO local_tasks (
  id, task_list_id, remote_id, title, notes, state, sort_order, is_hidden, priority, created_at,
  updated_at
)
SELECT ?1, lists.id, ?3, ?4, ?5, 'active',
       COALESCE((SELECT MAX(tasks.sort_order) + 1 FROM local_tasks AS tasks
                 WHERE tasks.task_list_id = lists.id AND tasks.parent_task_id IS NULL
                   AND tasks.deleted_at IS NULL), 0),
       0, 'none', ?6, ?6
FROM local_task_lists AS lists
WHERE lists.id = ?2 AND lists.deleted_at IS NULL
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite note create preparation failed (%1)"),
                         prepareResult);
  }
  if (const std::optional<AppError> error = bindAll(statement,
                                                    {bindText(statement, 1, noteId),
                                                     bindText(statement, 2, input.taskListId),
                                                     bindText(statement, 3, remoteId),
                                                     bindText(statement, 4, input.title),
                                                     bindText(statement, 5, input.body),
                                                     bindText(statement, 6, updatedAt)});
      error.has_value()) {
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  const int changedRows = sqlite3_changes(handle);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite note create failed (%1)"), stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite note create finalization failed (%1)"),
                         finalizeResult);
  }
  return changedRows == 1
             ? NoteMutationResult(NoteMutationReceipt{.noteId = noteId, .updatedAt = updatedAt})
             : NoteMutationResult(
                   validationError(QStringLiteral("Task list is unavailable for note creation")));
}

[[nodiscard]] NoteMutationResult updateStoredNote(SqliteConnection& connection,
                                                  const NoteUpdateInput& input,
                                                  const QString& updatedAt) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite note connection is unavailable"));
  }
  constexpr char sql[] = R"(
UPDATE local_tasks
SET task_list_id = CASE WHEN ?2 = 1 THEN ?3 ELSE task_list_id END,
    sort_order = CASE WHEN ?2 = 1 THEN COALESCE((SELECT MAX(sibling.sort_order) + 1
                                                  FROM local_tasks AS sibling
                                                  WHERE sibling.task_list_id = ?3
                                                    AND sibling.parent_task_id IS NULL
                                                    AND sibling.id != local_tasks.id
                                                    AND sibling.deleted_at IS NULL), 0)
                      ELSE sort_order END,
    title = CASE WHEN ?4 = 1 THEN ?5 ELSE title END,
    notes = CASE WHEN ?6 = 1 THEN ?7 ELSE notes END,
    updated_at = ?8
WHERE id = ?1 AND deleted_at IS NULL AND is_hidden = 0 AND state = 'active'
  AND parent_task_id IS NULL AND due_at IS NULL
  AND EXISTS (SELECT 1 FROM local_task_lists AS source
              WHERE source.id = local_tasks.task_list_id AND source.deleted_at IS NULL)
  AND (?2 = 0 OR (NOT EXISTS (SELECT 1 FROM local_tasks AS child
                              WHERE child.parent_task_id = local_tasks.id
                                AND child.deleted_at IS NULL)
                 AND EXISTS (SELECT 1 FROM local_task_lists AS target
                             INNER JOIN local_task_lists AS source
                               ON source.id = local_tasks.task_list_id
                             WHERE target.id = ?3 AND target.deleted_at IS NULL
                               AND target.account_id = source.account_id)))
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite note update preparation failed (%1)"),
                         prepareResult);
  }
  if (const std::optional<AppError> error =
          bindAll(statement,
                  {bindText(statement, 1, input.noteId),
                   bindInteger(statement, 2, input.taskListId.has_value()),
                   bindOptionalText(statement, 3, input.taskListId),
                   bindInteger(statement, 4, input.title.has_value()),
                   bindOptionalText(statement, 5, input.title),
                   bindInteger(statement, 6, input.body.has_value()),
                   bindOptionalText(statement, 7, input.body),
                   bindText(statement, 8, updatedAt)});
      error.has_value()) {
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  const int changedRows = sqlite3_changes(handle);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite note update failed (%1)"), stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite note update finalization failed (%1)"),
                         finalizeResult);
  }
  return changedRows == 1 ? NoteMutationResult(
                                NoteMutationReceipt{.noteId = input.noteId, .updatedAt = updatedAt})
                          : NoteMutationResult(
                                validationError(QStringLiteral("Note is unavailable for update")));
}

[[nodiscard]] NoteMutationResult
removeStoredNote(SqliteConnection& connection, const QString& noteId, const QString& updatedAt) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite note connection is unavailable"));
  }
  constexpr char sql[] = R"(
UPDATE local_tasks
SET deleted_at = ?2, updated_at = ?2
WHERE id = ?1 AND deleted_at IS NULL AND is_hidden = 0 AND state = 'active'
  AND parent_task_id IS NULL AND due_at IS NULL
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite note deletion preparation failed (%1)"),
                         prepareResult);
  }
  if (const std::optional<AppError> error =
          bindAll(statement, {bindText(statement, 1, noteId), bindText(statement, 2, updatedAt)});
      error.has_value()) {
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  const int changedRows = sqlite3_changes(handle);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite note deletion failed (%1)"), stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite note deletion finalization failed (%1)"),
                         finalizeResult);
  }
  return changedRows == 1
             ? NoteMutationResult(NoteMutationReceipt{.noteId = noteId, .updatedAt = updatedAt})
             : NoteMutationResult(
                   validationError(QStringLiteral("Note is unavailable for deletion")));
}

} // namespace

NoteService::NoteService(FilePath databasePath, const Clock& clock)
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

std::shared_future<SqliteWriteResult> NoteService::ready() const { return initialization_; }

std::future<NoteLookupResult> NoteService::find(QString noteId) {
  if (!isValidRequiredText(noteId, kMaximumIdentifierLength)) {
    return readyFuture(
        NoteLookupResult(validationError(QStringLiteral("Note identifier is invalid"))));
  }
  return writerQueue_.enqueueResult([noteId = std::move(noteId)](SqliteConnection& connection) {
    return readStoredNote(connection, noteId);
  });
}

std::future<NotePageResult> NoteService::list(NoteListRequest request) {
  if ((request.taskListId.has_value() &&
       !isValidRequiredText(*request.taskListId, kMaximumIdentifierLength)) ||
      request.limit <= 0 || request.limit > kMaximumPageLimit || request.offset < 0 ||
      request.offset > std::numeric_limits<std::int64_t>::max() - request.limit) {
    return readyFuture(
        NotePageResult(validationError(QStringLiteral("Note list request is invalid"))));
  }
  return writerQueue_.enqueueResult([request = std::move(request)](SqliteConnection& connection) {
    return readStoredNotes(connection, request);
  });
}

std::future<NoteMutationResult> NoteService::create(NoteCreateInput input) {
  input.title = input.title.trimmed();
  if (!isValidRequiredText(input.taskListId, kMaximumIdentifierLength) ||
      !isValidRequiredText(input.title, kMaximumTitleLength) || !isValidBody(input.body)) {
    return readyFuture(
        NoteMutationResult(validationError(QStringLiteral("Note create input is invalid"))));
  }
  const QString localId = QUuid::createUuid().toString(QUuid::WithoutBraces);
  const QString noteId = QStringLiteral("note:") + localId;
  const QString remoteId = QStringLiteral("pending:") + localId;
  const QString updatedAt = timestamp(clock_);
  return writerQueue_.enqueueResult(
      [input = std::move(input), noteId, remoteId, updatedAt](SqliteConnection& connection) {
        return createStoredNote(connection, input, noteId, remoteId, updatedAt);
      });
}

std::future<NoteMutationResult> NoteService::update(NoteUpdateInput input) {
  if (input.title.has_value()) {
    *input.title = input.title->trimmed();
  }
  if (!isValidRequiredText(input.noteId, kMaximumIdentifierLength) ||
      (input.taskListId.has_value() &&
       !isValidRequiredText(*input.taskListId, kMaximumIdentifierLength)) ||
      (input.title.has_value() && !isValidRequiredText(*input.title, kMaximumTitleLength)) ||
      (input.body.has_value() && !isValidBody(*input.body)) ||
      (!input.taskListId.has_value() && !input.title.has_value() && !input.body.has_value())) {
    return readyFuture(
        NoteMutationResult(validationError(QStringLiteral("Note update input is invalid"))));
  }
  const QString updatedAt = timestamp(clock_);
  return writerQueue_.enqueueResult(
      [input = std::move(input), updatedAt](SqliteConnection& connection) {
        return updateStoredNote(connection, input, updatedAt);
      });
}

std::future<NoteMutationResult> NoteService::remove(QString noteId) {
  if (!isValidRequiredText(noteId, kMaximumIdentifierLength)) {
    return readyFuture(
        NoteMutationResult(validationError(QStringLiteral("Note deletion input is invalid"))));
  }
  const QString updatedAt = timestamp(clock_);
  return writerQueue_.enqueueResult(
      [noteId = std::move(noteId), updatedAt](SqliteConnection& connection) {
        return removeStoredNote(connection, noteId, updatedAt);
      });
}

} // namespace hcb
