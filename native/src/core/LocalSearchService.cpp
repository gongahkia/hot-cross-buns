#include "core/LocalSearchService.h"

#include "sqlite3.h"

#include <QRegularExpression>

#include <algorithm>
#include <optional>
#include <stdexcept>
#include <utility>
#include <variant>

namespace hcb {
namespace {

constexpr int kMaximumPageSize = 100;
constexpr int kMaximumOffset = 10'000;
constexpr int kMaximumRankedResults = 200;
constexpr int kMaximumCandidatesPerResource = 250;

struct QuerySpec final {
  LocalSearchResource resource;
  const char* sql;
};

constexpr QuerySpec querySpecs[] = {
    {LocalSearchResource::TaskList,
     R"(SELECT f.task_list_id, lists.title, ''
         FROM local_task_lists_fts AS f
         INNER JOIN local_task_lists AS lists ON lists.id = f.task_list_id
         WHERE local_task_lists_fts MATCH ?1 AND lists.deleted_at IS NULL
         LIMIT ?2)"},
    {LocalSearchResource::Task,
     R"(SELECT f.task_id, tasks.title, COALESCE(tasks.notes, '')
         FROM local_tasks_fts AS f
         INNER JOIN local_tasks AS tasks ON tasks.id = f.task_id
         INNER JOIN local_task_lists AS lists ON lists.id = tasks.task_list_id
         WHERE local_tasks_fts MATCH ?1 AND tasks.deleted_at IS NULL AND lists.deleted_at IS NULL
         LIMIT ?2)"},
    {LocalSearchResource::Note,
     R"(SELECT f.note_id, f.title, f.body
         FROM local_notes_fts AS f
         WHERE local_notes_fts MATCH ?1
         LIMIT ?2)"},
    {LocalSearchResource::Calendar,
     R"(SELECT f.calendar_id, calendars.title, ''
         FROM local_calendars_fts AS f
         INNER JOIN local_calendars AS calendars ON calendars.id = f.calendar_id
         WHERE local_calendars_fts MATCH ?1 AND calendars.deleted_at IS NULL
         LIMIT ?2)"},
    {LocalSearchResource::Event,
     R"(SELECT f.calendar_event_id, events.title,
                TRIM(COALESCE(events.description, '') || ' ' || COALESCE(events.location, ''))
         FROM local_calendar_events_fts AS f
         INNER JOIN local_calendar_events AS events ON events.id = f.calendar_event_id
         INNER JOIN local_calendars AS calendars ON calendars.id = events.calendar_id
         WHERE local_calendar_events_fts MATCH ?1 AND events.deleted_at IS NULL AND events.status != 'cancelled'
               AND calendars.deleted_at IS NULL
         LIMIT ?2)"},
};

[[nodiscard]] AppError databaseError(const QString& message, int code) {
  return AppError(AppErrorCode::Database, message.arg(code));
}

[[nodiscard]] QString ftsQuery(const QString& query) {
  static const QRegularExpression word(QStringLiteral("[\\p{L}\\p{N}_]+"));
  QRegularExpressionMatchIterator matches = word.globalMatch(query);
  QStringList terms;
  while (matches.hasNext()) {
    terms.append(QStringLiteral("\"") + matches.next().captured() + QStringLiteral("\"*"));
  }
  return terms.join(QStringLiteral(" AND "));
}

[[nodiscard]] std::optional<QString> columnText(sqlite3_stmt* statement, int column) {
  const auto* value = reinterpret_cast<const char*>(sqlite3_column_text(statement, column));
  const int size = sqlite3_column_bytes(statement, column);
  return value == nullptr || size < 0 ? std::nullopt
                                      : std::optional<QString>(QString::fromUtf8(value, size));
}

[[nodiscard]] std::variant<QList<LocalSearchCandidate>, AppError>
readCandidates(SqliteConnection& connection, const QString& query) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite search connection is unavailable"));
  }
  QList<LocalSearchCandidate> candidates;
  candidates.reserve(static_cast<qsizetype>(std::size(querySpecs)) * kMaximumCandidatesPerResource);
  for (const QuerySpec& spec : querySpecs) {
    sqlite3_stmt* statement = nullptr;
    const int prepareResult =
        sqlite3_prepare_v3(handle, spec.sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
    if (prepareResult != SQLITE_OK) {
      sqlite3_finalize(statement);
      return databaseError(QStringLiteral("SQLite search preparation failed (%1)"), prepareResult);
    }
    const QByteArray encodedQuery = query.toUtf8();
    const int bindQueryResult = sqlite3_bind_text(statement,
                                                  1,
                                                  encodedQuery.constData(),
                                                  static_cast<int>(encodedQuery.size()),
                                                  SQLITE_TRANSIENT);
    const int bindLimitResult = sqlite3_bind_int(statement, 2, kMaximumCandidatesPerResource);
    if (bindQueryResult != SQLITE_OK || bindLimitResult != SQLITE_OK) {
      sqlite3_finalize(statement);
      return databaseError(QStringLiteral("SQLite search binding failed (%1)"),
                           bindQueryResult != SQLITE_OK ? bindQueryResult : bindLimitResult);
    }
    while (true) {
      const int stepResult = sqlite3_step(statement);
      if (stepResult == SQLITE_DONE) {
        break;
      }
      if (stepResult != SQLITE_ROW) {
        sqlite3_finalize(statement);
        return databaseError(QStringLiteral("SQLite search query failed (%1)"), stepResult);
      }
      const std::optional<QString> id = columnText(statement, 0);
      const std::optional<QString> title = columnText(statement, 1);
      const std::optional<QString> detail = columnText(statement, 2);
      if (!id.has_value() || !title.has_value() || !detail.has_value()) {
        sqlite3_finalize(statement);
        return AppError(AppErrorCode::Database, QStringLiteral("SQLite search row is invalid"));
      }
      candidates.append({.resource = spec.resource, .id = *id, .title = *title, .detail = *detail});
    }
    const int finalizeResult = sqlite3_finalize(statement);
    if (finalizeResult != SQLITE_OK) {
      return databaseError(QStringLiteral("SQLite search finalization failed (%1)"),
                           finalizeResult);
    }
  }
  return candidates;
}

[[nodiscard]] LocalSearchPage searchStored(SqliteConnection& connection,
                                           const LocalSearchRequest& request,
                                           const UnifiedLocalSearchRanker& ranker) {
  const QString query = ftsQuery(request.query);
  if (query.isEmpty()) {
    throw std::invalid_argument("search query is invalid");
  }
  const std::variant<QList<LocalSearchCandidate>, AppError> candidates =
      readCandidates(connection, query);
  if (std::holds_alternative<AppError>(candidates)) {
    throw std::runtime_error("SQLite search query failed");
  }
  const QList<LocalSearchRankedResult> ranked = ranker.rank(
      request.query, std::get<QList<LocalSearchCandidate>>(candidates), kMaximumRankedResults);
  const int rankedCount = static_cast<int>(ranked.size());
  const int start = std::min(request.offset, rankedCount);
  const int end = std::min(start + request.limit, rankedCount);
  QList<LocalSearchRankedResult> page;
  page.reserve(end - start);
  for (int index = start; index < end; ++index) {
    page.append(ranked.at(index));
  }
  return LocalSearchPage{
      .items = std::move(page), .totalKnown = rankedCount, .hasMore = end < rankedCount};
}

} // namespace

LocalSearchService::LocalSearchService(FilePath databasePath, std::size_t connectionCount)
    : readPool_(
          std::make_unique<SqliteReadConnectionPool>(std::move(databasePath), connectionCount)) {}

std::shared_future<std::optional<AppError>> LocalSearchService::ready() const {
  return readPool_->ready();
}

std::future<LocalSearchPageResult> LocalSearchService::search(LocalSearchRequest request) {
  if (request.query.trimmed().isEmpty() || request.offset < 0 || request.offset > kMaximumOffset ||
      request.limit < 1) {
    std::promise<LocalSearchPageResult> completion;
    std::future<LocalSearchPageResult> future = completion.get_future();
    completion.set_value(
        AppError(AppErrorCode::Validation, QStringLiteral("Search request is invalid")));
    return future;
  }
  request.limit = std::clamp(request.limit, 1, kMaximumPageSize);
  return readPool_->enqueue([this, request = std::move(request)](SqliteConnection& connection) {
    return searchStored(connection, request, ranker_);
  });
}

} // namespace hcb
