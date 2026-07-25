#include "core/SearchResultsModel.h"

#include <utility>

namespace hcb {

namespace {

[[nodiscard]] QString resourceName(LocalSearchResource resource) {
  switch (resource) {
  case LocalSearchResource::TaskList:
    return QStringLiteral("taskList");
  case LocalSearchResource::Task:
    return QStringLiteral("task");
  case LocalSearchResource::Note:
    return QStringLiteral("note");
  case LocalSearchResource::Calendar:
    return QStringLiteral("calendar");
  case LocalSearchResource::Event:
    return QStringLiteral("event");
  }
  return {};
}

} // namespace

SearchResultsModel::SearchResultsModel(QObject* parent) : QAbstractListModel(parent) {}

int SearchResultsModel::rowCount(const QModelIndex& parent) const {
  return parent.isValid() ? 0 : static_cast<int>(results_.size());
}

QVariant SearchResultsModel::data(const QModelIndex& index, int role) const {
  if (!index.isValid() || index.row() < 0 || index.row() >= static_cast<int>(results_.size())) {
    return {};
  }
  const LocalSearchRankedResult& result = results_.at(index.row());
  switch (role) {
  case Qt::DisplayRole:
  case TitleRole:
    return result.title;
  case IdRole:
    return result.id;
  case ResourceRole:
    return resourceName(result.resource);
  case DetailRole:
    return result.detail;
  case ScoreRole:
    return result.score;
  default:
    return {};
  }
}

QHash<int, QByteArray> SearchResultsModel::roleNames() const {
  return {{IdRole, "id"},
          {ResourceRole, "resource"},
          {TitleRole, "title"},
          {DetailRole, "detail"},
          {ScoreRole, "score"}};
}

void SearchResultsModel::setResults(QList<LocalSearchRankedResult> results) {
  beginResetModel();
  results_ = std::move(results);
  endResetModel();
}

} // namespace hcb
