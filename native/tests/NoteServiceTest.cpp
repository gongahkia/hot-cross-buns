#include <QDateTime>
#include <QDir>
#include <QFileInfo>
#include <QTemporaryDir>
#include <QTimeZone>
#include <QtTest/QTest>

#include <chrono>
#include <future>
#include <optional>
#include <utility>
#include <variant>

#include "core/NoteService.h"
#include "data/SqliteConnection.h"
#include "sqlite3.h"

using namespace std::chrono_literals;

namespace {

class FixedClock final : public hcb::Clock {
public:
  explicit FixedClock(hcb::WallTimePoint wallTime) : wallTime_(wallTime) {}
  [[nodiscard]] hcb::WallTimePoint wallNow() const noexcept override { return wallTime_; }
  [[nodiscard]] hcb::MonotonicTimePoint monotonicNow() const noexcept override {
    return hcb::MonotonicTimePoint{};
  }

private:
  hcb::WallTimePoint wallTime_;
};

struct NoteSnapshot final {
  QString remoteId;
  QString taskListId;
  QString title;
  std::optional<QString> body;
  std::optional<QString> deletedAt;
  QString updatedAt;
};

[[nodiscard]] std::optional<hcb::FilePath>
databasePathFor(const QTemporaryDir& temporaryDirectory) {
  return hcb::FilePath::fromAbsolute(QDir(QFileInfo(temporaryDirectory.path()).canonicalFilePath())
                                         .filePath(QStringLiteral("hot-cross-buns.sqlite")));
}

template <typename Result> [[nodiscard]] Result awaitResult(std::future<Result>& future) {
  if (future.wait_for(2s) != std::future_status::ready) {
    qFatal("note service request timed out");
  }
  return future.get();
}

void verifyReady(hcb::NoteService& service) {
  const std::shared_future<hcb::SqliteWriteResult> ready = service.ready();
  QCOMPARE(ready.wait_for(2s), std::future_status::ready);
  const hcb::SqliteWriteResult& result = ready.get();
  QVERIFY2(!result.has_value(), qPrintable(result.has_value() ? result->message() : QString()));
}

void execute(sqlite3* handle, const char* sql) {
  char* errorMessage = nullptr;
  const int result = sqlite3_exec(handle, sql, nullptr, nullptr, &errorMessage);
  const QString message = errorMessage == nullptr ? QString() : QString::fromUtf8(errorMessage);
  sqlite3_free(errorMessage);
  QVERIFY2(result == SQLITE_OK, qPrintable(message));
}

void seed(hcb::SqliteConnection& connection) {
  sqlite3* const handle = connection.nativeHandle();
  QVERIFY(handle != nullptr);
  execute(handle,
          "INSERT INTO local_accounts (id, provider, connection_state, granted_scopes_json, "
          "missing_scopes_json, updated_at) VALUES "
          "('account-a', 'google', 'connected', '[]', '[]', '2026-07-25T00:00:00Z'), "
          "('account-b', 'google', 'connected', '[]', '[]', '2026-07-25T00:00:00Z')");
  execute(handle,
          "INSERT INTO local_task_lists (id, account_id, remote_id, title, updated_at, deleted_at) "
          "VALUES "
          "('list-notes', 'account-a', 'notes', 'Notes', '2026-07-25T00:00:00Z', NULL), "
          "('list-other', 'account-a', 'other', 'Other', '2026-07-25T00:00:00Z', NULL), "
          "('list-cross-account', 'account-b', 'cross', 'Cross', '2026-07-25T00:00:00Z', NULL), "
          "('list-deleted', 'account-a', 'deleted', 'Deleted', '2026-07-25T00:00:00Z', "
          "'2026-07-25T01:00:00Z')");
  execute(handle,
          "INSERT INTO local_tasks (id, task_list_id, remote_id, title, notes, state, due_at, "
          "is_hidden, updated_at, deleted_at) VALUES "
          "('note-existing', 'list-notes', 'existing', 'Existing', 'Existing body', 'active', "
          "NULL, 0, '2026-07-24T00:00:00Z', NULL), "
          "('task-due', 'list-notes', 'due', 'Due task', 'Task body', 'active', "
          "'2026-07-26T00:00:00Z', 0, '2026-07-24T00:00:00Z', NULL), "
          "('task-completed', 'list-notes', 'completed', 'Completed', 'Task body', 'completed', "
          "NULL, 0, '2026-07-24T00:00:00Z', NULL)");
}

[[nodiscard]] std::optional<QString> optionalText(sqlite3_stmt* statement, int index) {
  if (sqlite3_column_type(statement, index) == SQLITE_NULL) {
    return std::nullopt;
  }
  const auto* value = reinterpret_cast<const char*>(sqlite3_column_text(statement, index));
  const int byteCount = sqlite3_column_bytes(statement, index);
  return value == nullptr || byteCount < 0
             ? std::nullopt
             : std::optional<QString>(QString::fromUtf8(value, byteCount));
}

[[nodiscard]] std::optional<NoteSnapshot> readNote(sqlite3* handle, const QString& noteId) {
  constexpr char sql[] = R"(
SELECT remote_id, task_list_id, title, notes, deleted_at, updated_at
FROM local_tasks WHERE id = ?1
)";
  sqlite3_stmt* statement = nullptr;
  if (sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr) !=
      SQLITE_OK) {
    sqlite3_finalize(statement);
    return std::nullopt;
  }
  const QByteArray noteIdUtf8 = noteId.toUtf8();
  if (sqlite3_bind_text(statement,
                        1,
                        noteIdUtf8.constData(),
                        static_cast<int>(noteIdUtf8.size()),
                        SQLITE_TRANSIENT) != SQLITE_OK ||
      sqlite3_step(statement) != SQLITE_ROW) {
    sqlite3_finalize(statement);
    return std::nullopt;
  }
  const NoteSnapshot snapshot{.remoteId = optionalText(statement, 0).value_or(QString()),
                              .taskListId = optionalText(statement, 1).value_or(QString()),
                              .title = optionalText(statement, 2).value_or(QString()),
                              .body = optionalText(statement, 3),
                              .deletedAt = optionalText(statement, 4),
                              .updatedAt = optionalText(statement, 5).value_or(QString())};
  return sqlite3_finalize(statement) == SQLITE_OK ? std::optional<NoteSnapshot>(snapshot)
                                                  : std::nullopt;
}

} // namespace

class NoteServiceTest final : public QObject {
  Q_OBJECT

private slots:
  void listsCreatesUpdatesMovesAndDeletesNotes();
  void rejectsInvalidAndUnavailableMutations();
};

void NoteServiceTest::listsCreatesUpdatesMovesAndDeletesNotes() {
  QTemporaryDir temporaryDirectory;
  QVERIFY(temporaryDirectory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(temporaryDirectory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  const FixedClock clock(hcb::WallTimePoint{std::chrono::milliseconds{1'753'408'000'123}});
  const QString expectedTimestamp =
      QDateTime::fromMSecsSinceEpoch(1'753'408'000'123, QTimeZone::UTC).toString(Qt::ISODateWithMs);
  hcb::NoteService service(*databasePath, clock);
  verifyReady(service);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);
  sqlite3* const handle = connection.nativeHandle();
  QVERIFY(handle != nullptr);

  std::future<hcb::NotePageResult> initial = service.list();
  const hcb::NotePageResult initialResult = awaitResult(initial);
  QVERIFY(std::holds_alternative<hcb::NotePage>(initialResult));
  QCOMPARE(std::get<hcb::NotePage>(initialResult).totalKnown, 1);
  QCOMPARE(std::get<hcb::NotePage>(initialResult).items.at(0).id, QStringLiteral("note-existing"));

  std::future<hcb::NoteMutationResult> create =
      service.create(hcb::NoteCreateInput{.taskListId = QStringLiteral("list-notes"),
                                          .title = QStringLiteral(" New note "),
                                          .body = QStringLiteral("Draft body")});
  const hcb::NoteMutationResult createResult = awaitResult(create);
  QVERIFY(std::holds_alternative<hcb::NoteMutationReceipt>(createResult));
  if (!std::holds_alternative<hcb::NoteMutationReceipt>(createResult)) {
    return;
  }
  const hcb::NoteMutationReceipt receipt = std::get<hcb::NoteMutationReceipt>(createResult);
  QVERIFY(receipt.noteId.startsWith(QStringLiteral("note:")));
  QCOMPARE(receipt.updatedAt, expectedTimestamp);
  const std::optional<NoteSnapshot> created = readNote(handle, receipt.noteId);
  QVERIFY(created.has_value());
  if (!created.has_value()) {
    return;
  }
  QCOMPARE(created->remoteId, QStringLiteral("pending:") + receipt.noteId.mid(5));
  QCOMPARE(created->title, QStringLiteral("New note"));
  QCOMPARE(created->body, std::optional<QString>(QStringLiteral("Draft body")));

  std::future<hcb::NoteMutationResult> update =
      service.update(hcb::NoteUpdateInput{.noteId = receipt.noteId,
                                          .taskListId = QStringLiteral("list-other"),
                                          .title = QStringLiteral(" Revised "),
                                          .body = QString()});
  const hcb::NoteMutationResult updateResult = awaitResult(update);
  QVERIFY(std::holds_alternative<hcb::NoteMutationReceipt>(updateResult));
  const std::optional<NoteSnapshot> updated = readNote(handle, receipt.noteId);
  QVERIFY(updated.has_value());
  if (!updated.has_value()) {
    return;
  }
  QCOMPARE(updated->taskListId, QStringLiteral("list-other"));
  QCOMPARE(updated->title, QStringLiteral("Revised"));
  QCOMPARE(updated->body, std::optional<QString>(QString()));
  QCOMPARE(updated->updatedAt, expectedTimestamp);

  std::future<hcb::NoteLookupResult> found = service.find(receipt.noteId);
  const hcb::NoteLookupResult foundResult = awaitResult(found);
  QVERIFY(std::holds_alternative<std::optional<hcb::NoteSummary>>(foundResult));
  QVERIFY(std::get<std::optional<hcb::NoteSummary>>(foundResult).has_value());

  std::future<hcb::NoteMutationResult> remove = service.remove(receipt.noteId);
  const hcb::NoteMutationResult removeResult = awaitResult(remove);
  QVERIFY(std::holds_alternative<hcb::NoteMutationReceipt>(removeResult));
  const std::optional<NoteSnapshot> removed = readNote(handle, receipt.noteId);
  QVERIFY(removed.has_value());
  if (!removed.has_value()) {
    return;
  }
  QCOMPARE(removed->deletedAt, std::optional<QString>(expectedTimestamp));
}

void NoteServiceTest::rejectsInvalidAndUnavailableMutations() {
  QTemporaryDir temporaryDirectory;
  QVERIFY(temporaryDirectory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(temporaryDirectory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  const FixedClock clock(hcb::WallTimePoint{});
  hcb::NoteService service(*databasePath, clock);
  verifyReady(service);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);

  std::future<hcb::NoteMutationResult> unavailableCreate =
      service.create(hcb::NoteCreateInput{.taskListId = QStringLiteral("list-deleted"),
                                          .title = QStringLiteral("Unavailable"),
                                          .body = QString()});
  const hcb::NoteMutationResult unavailableCreateResult = awaitResult(unavailableCreate);
  QVERIFY(std::holds_alternative<hcb::AppError>(unavailableCreateResult));
  QCOMPARE(std::get<hcb::AppError>(unavailableCreateResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::NoteMutationResult> invalidUpdate =
      service.update(hcb::NoteUpdateInput{.noteId = QStringLiteral("note-existing")});
  const hcb::NoteMutationResult invalidUpdateResult = awaitResult(invalidUpdate);
  QVERIFY(std::holds_alternative<hcb::AppError>(invalidUpdateResult));
  QCOMPARE(std::get<hcb::AppError>(invalidUpdateResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::NoteMutationResult> crossAccountMove =
      service.update(hcb::NoteUpdateInput{.noteId = QStringLiteral("note-existing"),
                                          .taskListId = QStringLiteral("list-cross-account")});
  const hcb::NoteMutationResult crossAccountMoveResult = awaitResult(crossAccountMove);
  QVERIFY(std::holds_alternative<hcb::AppError>(crossAccountMoveResult));
  QCOMPARE(std::get<hcb::AppError>(crossAccountMoveResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::NoteMutationResult> taskRemove = service.remove(QStringLiteral("task-due"));
  const hcb::NoteMutationResult taskRemoveResult = awaitResult(taskRemove);
  QVERIFY(std::holds_alternative<hcb::AppError>(taskRemoveResult));
  QCOMPARE(std::get<hcb::AppError>(taskRemoveResult).code(), hcb::AppErrorCode::Validation);
}

QTEST_GUILESS_MAIN(NoteServiceTest)

#include "NoteServiceTest.moc"
