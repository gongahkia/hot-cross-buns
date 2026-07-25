#pragma once

#include "core/AppError.h"
#include "core/Clock.h"
#include "core/FilePath.h"
#include "data/SqliteWriterQueue.h"

#include <QList>
#include <QString>

#include <cstdint>
#include <future>
#include <optional>
#include <variant>

namespace hcb {

struct NoteSummary final {
  QString id;
  QString taskListId;
  QString taskListTitle;
  QString title;
  QString body;
  QString updatedAt;
};

struct NoteListRequest final {
  std::optional<QString> taskListId;
  std::int64_t limit{50};
  std::int64_t offset{0};
};

struct NotePage final {
  QList<NoteSummary> items;
  std::optional<std::int64_t> nextOffset;
  std::int64_t totalKnown;
};

struct NoteCreateInput final {
  QString taskListId;
  QString title;
  QString body;
};

struct NoteUpdateInput final {
  QString noteId;
  std::optional<QString> taskListId;
  std::optional<QString> title;
  std::optional<QString> body;
};

struct NoteMutationReceipt final {
  QString noteId;
  QString updatedAt;
};

using NoteLookupResult = std::variant<std::optional<NoteSummary>, AppError>;
using NotePageResult = std::variant<NotePage, AppError>;
using NoteMutationResult = std::variant<NoteMutationReceipt, AppError>;

class NoteService final {
public:
  NoteService(FilePath databasePath, const Clock& clock);
  NoteService(const NoteService&) = delete;
  NoteService& operator=(const NoteService&) = delete;

  [[nodiscard]] std::shared_future<SqliteWriteResult> ready() const;
  [[nodiscard]] std::future<NoteLookupResult> find(QString noteId);
  [[nodiscard]] std::future<NotePageResult> list(NoteListRequest request = {});
  [[nodiscard]] std::future<NoteMutationResult> create(NoteCreateInput input);
  [[nodiscard]] std::future<NoteMutationResult> update(NoteUpdateInput input);
  [[nodiscard]] std::future<NoteMutationResult> remove(QString noteId);

private:
  const Clock& clock_;
  SqliteWriterQueue writerQueue_;
  std::shared_future<SqliteWriteResult> initialization_;
};

} // namespace hcb
