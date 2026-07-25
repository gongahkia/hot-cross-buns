#include "core/NotesModel.h"
#include "core/ModelDiffPolicy.h"

#include <utility>

namespace hcb {

namespace {

[[nodiscard]] bool equivalentNote(const NoteSummary& left, const NoteSummary& right) {
  return left.id == right.id && left.taskListId == right.taskListId &&
         left.taskListTitle == right.taskListTitle && left.title == right.title &&
         left.body == right.body && left.updatedAt == right.updatedAt;
}

} // namespace

NotesModel::NotesModel(QObject* parent) : QAbstractListModel(parent) {}

int NotesModel::rowCount(const QModelIndex& parent) const {
  return parent.isValid() ? 0 : static_cast<int>(notes_.size());
}

QVariant NotesModel::data(const QModelIndex& index, int role) const {
  if (!index.isValid() || index.row() < 0 || index.row() >= static_cast<int>(notes_.size())) {
    return {};
  }
  const NoteSummary& note = notes_.at(index.row());
  switch (role) {
  case Qt::DisplayRole:
  case TitleRole:
    return note.title;
  case IdRole:
    return note.id;
  case TaskListIdRole:
    return note.taskListId;
  case TaskListTitleRole:
    return note.taskListTitle;
  case BodyRole:
    return note.body;
  case UpdatedAtRole:
    return note.updatedAt;
  default:
    return {};
  }
}

QHash<int, QByteArray> NotesModel::roleNames() const {
  return {{IdRole, "id"},
          {TaskListIdRole, "taskListId"},
          {TaskListTitleRole, "taskListTitle"},
          {TitleRole, "title"},
          {BodyRole, "body"},
          {UpdatedAtRole, "updatedAt"}};
}

void NotesModel::setNotes(QList<NoteSummary> notes) {
  const ModelDiffPlan plan = ModelDiffPolicy::plan(
      notes_,
      notes,
      [](const NoteSummary& note) -> const QString& { return note.id; },
      equivalentNote);
  if (plan.requiresReset) {
    beginResetModel();
    notes_ = std::move(notes);
    endResetModel();
    return;
  }
  notes_ = std::move(notes);
  for (const ModelDataChangeRange& range : plan.changedRanges) {
    emit dataChanged(index(range.firstRow, 0), index(range.lastRow, 0));
  }
}

} // namespace hcb
