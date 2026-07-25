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

#include "core/CalendarMutationService.h"
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

struct EventSnapshot final {
  QString remoteId;
  QString calendarId;
  QString title;
  std::optional<QString> description;
  std::optional<QString> location;
  QString startAt;
  std::optional<QString> startTimeZone;
  QString endAt;
  std::optional<QString> endTimeZone;
  bool allDay;
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
    qFatal("calendar mutation service request timed out");
  }
  return future.get();
}

void verifyReady(hcb::CalendarMutationService& service) {
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
  execute(
      handle,
      "INSERT INTO local_calendars (id, account_id, remote_id, title, updated_at, deleted_at) "
      "VALUES "
      "('calendar-work', 'account-a', 'work', 'Work', '2026-07-25T00:00:00Z', NULL), "
      "('calendar-other', 'account-a', 'other', 'Other', '2026-07-25T00:00:00Z', NULL), "
      "('calendar-cross-account', 'account-b', 'cross', 'Cross', '2026-07-25T00:00:00Z', NULL), "
      "('calendar-deleted', 'account-a', 'deleted', 'Deleted', '2026-07-25T00:00:00Z', "
      "'2026-07-25T01:00:00Z')");
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

[[nodiscard]] std::optional<EventSnapshot> readEvent(sqlite3* handle, const QString& eventId) {
  constexpr char sql[] = R"(
SELECT remote_id, calendar_id, title, description, location, start_at, start_time_zone, end_at,
       end_time_zone, is_all_day, deleted_at, updated_at
FROM local_calendar_events
WHERE id = ?1
)";
  sqlite3_stmt* statement = nullptr;
  if (sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr) !=
      SQLITE_OK) {
    sqlite3_finalize(statement);
    return std::nullopt;
  }
  const QByteArray eventIdUtf8 = eventId.toUtf8();
  if (sqlite3_bind_text(statement,
                        1,
                        eventIdUtf8.constData(),
                        static_cast<int>(eventIdUtf8.size()),
                        SQLITE_TRANSIENT) != SQLITE_OK ||
      sqlite3_step(statement) != SQLITE_ROW) {
    sqlite3_finalize(statement);
    return std::nullopt;
  }
  const EventSnapshot snapshot{.remoteId = optionalText(statement, 0).value_or(QString()),
                               .calendarId = optionalText(statement, 1).value_or(QString()),
                               .title = optionalText(statement, 2).value_or(QString()),
                               .description = optionalText(statement, 3),
                               .location = optionalText(statement, 4),
                               .startAt = optionalText(statement, 5).value_or(QString()),
                               .startTimeZone = optionalText(statement, 6),
                               .endAt = optionalText(statement, 7).value_or(QString()),
                               .endTimeZone = optionalText(statement, 8),
                               .allDay = sqlite3_column_int(statement, 9) == 1,
                               .deletedAt = optionalText(statement, 10),
                               .updatedAt = optionalText(statement, 11).value_or(QString())};
  const int finalizeResult = sqlite3_finalize(statement);
  return finalizeResult == SQLITE_OK ? std::optional<EventSnapshot>(snapshot) : std::nullopt;
}

} // namespace

class CalendarMutationServiceTest final : public QObject {
  Q_OBJECT

private slots:
  void createsUpdatesMovesAndDeletesEvents();
  void rejectsInvalidAndUnavailableMutations();
};

void CalendarMutationServiceTest::createsUpdatesMovesAndDeletesEvents() {
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
  hcb::CalendarMutationService service(*databasePath, clock);
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

  std::future<hcb::CalendarEventMutationResult> create = service.create(
      hcb::CalendarEventCreateInput{.calendarId = QStringLiteral("calendar-work"),
                                    .title = QStringLiteral(" Planning "),
                                    .startAt = QStringLiteral("2026-07-26T09:30:00+08:00"),
                                    .endAt = QStringLiteral("2026-07-26T10:30:00+08:00"),
                                    .description = QStringLiteral("Quarterly review"),
                                    .location = QStringLiteral("Room 5"),
                                    .startTimeZone = QStringLiteral("Asia/Singapore"),
                                    .endTimeZone = QStringLiteral("Asia/Singapore")});
  const hcb::CalendarEventMutationResult createResult = awaitResult(create);
  QVERIFY(std::holds_alternative<hcb::CalendarEventMutationReceipt>(createResult));
  if (!std::holds_alternative<hcb::CalendarEventMutationReceipt>(createResult)) {
    return;
  }
  const hcb::CalendarEventMutationReceipt receipt =
      std::get<hcb::CalendarEventMutationReceipt>(createResult);
  QCOMPARE(receipt.updatedAt, expectedTimestamp);
  QVERIFY(receipt.eventId.startsWith(QStringLiteral("event:")));
  const std::optional<EventSnapshot> created = readEvent(handle, receipt.eventId);
  QVERIFY(created.has_value());
  if (!created.has_value()) {
    return;
  }
  QCOMPARE(created->remoteId, QStringLiteral("pending:") + receipt.eventId.mid(6));
  QCOMPARE(created->title, QStringLiteral("Planning"));
  QCOMPARE(created->startAt, QStringLiteral("2026-07-26T01:30:00.000Z"));
  QCOMPARE(created->endAt, QStringLiteral("2026-07-26T02:30:00.000Z"));
  QCOMPARE(created->updatedAt, expectedTimestamp);

  const std::optional<std::optional<QString>> clearText{std::optional<QString>{}};
  std::future<hcb::CalendarEventMutationResult> update = service.update(
      hcb::CalendarEventUpdateInput{.eventId = receipt.eventId,
                                    .calendarId = QStringLiteral("calendar-other"),
                                    .title = QStringLiteral(" Review "),
                                    .description = clearText,
                                    .location = clearText,
                                    .startAt = QStringLiteral("2026-07-26T02:00:00Z"),
                                    .allDay = true,
                                    .startTimeZone = clearText,
                                    .endTimeZone = clearText});
  const hcb::CalendarEventMutationResult updateResult = awaitResult(update);
  QVERIFY(std::holds_alternative<hcb::CalendarEventMutationReceipt>(updateResult));
  const std::optional<EventSnapshot> updated = readEvent(handle, receipt.eventId);
  QVERIFY(updated.has_value());
  if (!updated.has_value()) {
    return;
  }
  QCOMPARE(updated->calendarId, QStringLiteral("calendar-other"));
  QCOMPARE(updated->title, QStringLiteral("Review"));
  QVERIFY(!updated->description.has_value());
  QVERIFY(!updated->location.has_value());
  QCOMPARE(updated->startAt, QStringLiteral("2026-07-26T02:00:00.000Z"));
  QCOMPARE(updated->endAt, QStringLiteral("2026-07-26T02:30:00.000Z"));
  QVERIFY(updated->allDay);
  QVERIFY(!updated->startTimeZone.has_value());

  std::future<hcb::CalendarEventMutationResult> remove = service.remove(receipt.eventId);
  const hcb::CalendarEventMutationResult removeResult = awaitResult(remove);
  QVERIFY(std::holds_alternative<hcb::CalendarEventMutationReceipt>(removeResult));
  const std::optional<EventSnapshot> removed = readEvent(handle, receipt.eventId);
  QVERIFY(removed.has_value());
  if (!removed.has_value()) {
    return;
  }
  QCOMPARE(removed->deletedAt, std::optional<QString>(expectedTimestamp));
}

void CalendarMutationServiceTest::rejectsInvalidAndUnavailableMutations() {
  QTemporaryDir temporaryDirectory;
  QVERIFY(temporaryDirectory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(temporaryDirectory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  const FixedClock clock(hcb::WallTimePoint{});
  hcb::CalendarMutationService service(*databasePath, clock);
  verifyReady(service);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);

  std::future<hcb::CalendarEventMutationResult> unavailableCreate = service.create(
      hcb::CalendarEventCreateInput{.calendarId = QStringLiteral("calendar-deleted"),
                                    .title = QStringLiteral("Unavailable"),
                                    .startAt = QStringLiteral("2026-07-26T09:00:00Z"),
                                    .endAt = QStringLiteral("2026-07-26T10:00:00Z")});
  const hcb::CalendarEventMutationResult unavailableCreateResult = awaitResult(unavailableCreate);
  QVERIFY(std::holds_alternative<hcb::AppError>(unavailableCreateResult));
  QCOMPARE(std::get<hcb::AppError>(unavailableCreateResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::CalendarEventMutationResult> invalidCreate = service.create(
      hcb::CalendarEventCreateInput{.calendarId = QStringLiteral("calendar-work"),
                                    .title = QStringLiteral("Invalid"),
                                    .startAt = QStringLiteral("2026-07-26T10:00:00Z"),
                                    .endAt = QStringLiteral("2026-07-26T09:00:00Z")});
  const hcb::CalendarEventMutationResult invalidCreateResult = awaitResult(invalidCreate);
  QVERIFY(std::holds_alternative<hcb::AppError>(invalidCreateResult));
  QCOMPARE(std::get<hcb::AppError>(invalidCreateResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::CalendarEventMutationResult> create = service.create(
      hcb::CalendarEventCreateInput{.calendarId = QStringLiteral("calendar-work"),
                                    .title = QStringLiteral("Existing"),
                                    .startAt = QStringLiteral("2026-07-26T09:00:00Z"),
                                    .endAt = QStringLiteral("2026-07-26T10:00:00Z")});
  const hcb::CalendarEventMutationResult createResult = awaitResult(create);
  QVERIFY(std::holds_alternative<hcb::CalendarEventMutationReceipt>(createResult));
  if (!std::holds_alternative<hcb::CalendarEventMutationReceipt>(createResult)) {
    return;
  }
  const QString eventId = std::get<hcb::CalendarEventMutationReceipt>(createResult).eventId;

  std::future<hcb::CalendarEventMutationResult> invalidRange =
      service.update(hcb::CalendarEventUpdateInput{
          .eventId = eventId, .endAt = QStringLiteral("2026-07-26T08:00:00Z")});
  const hcb::CalendarEventMutationResult invalidRangeResult = awaitResult(invalidRange);
  QVERIFY(std::holds_alternative<hcb::AppError>(invalidRangeResult));
  QCOMPARE(std::get<hcb::AppError>(invalidRangeResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::CalendarEventMutationResult> crossAccountMove =
      service.update(hcb::CalendarEventUpdateInput{
          .eventId = eventId, .calendarId = QStringLiteral("calendar-cross-account")});
  const hcb::CalendarEventMutationResult crossAccountMoveResult = awaitResult(crossAccountMove);
  QVERIFY(std::holds_alternative<hcb::AppError>(crossAccountMoveResult));
  QCOMPARE(std::get<hcb::AppError>(crossAccountMoveResult).code(), hcb::AppErrorCode::Validation);
}

QTEST_GUILESS_MAIN(CalendarMutationServiceTest)

#include "CalendarMutationServiceTest.moc"
