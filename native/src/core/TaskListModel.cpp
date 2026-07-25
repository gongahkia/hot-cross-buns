#include "core/TaskListModel.h"
#include "core/ModelDiffPolicy.h"

#include <utility>

namespace hcb {

namespace {

[[nodiscard]] bool equivalentTaskList(const TaskListSummary& left, const TaskListSummary& right) {
  return left.id == right.id && left.accountId == right.accountId &&
         left.remoteId == right.remoteId && left.title == right.title && left.etag == right.etag &&
         left.sortOrder == right.sortOrder && left.selected == right.selected &&
         left.remoteUpdatedAt == right.remoteUpdatedAt && left.updatedAt == right.updatedAt &&
         left.taskCount == right.taskCount && left.activeTaskCount == right.activeTaskCount;
}

} // namespace

TaskListModel::TaskListModel(QObject* parent) : QAbstractListModel(parent) {}

int TaskListModel::rowCount(const QModelIndex& parent) const {
  return parent.isValid() ? 0 : static_cast<int>(taskLists_.size());
}

QVariant TaskListModel::data(const QModelIndex& index, int role) const {
  if (!index.isValid() || index.row() < 0 || index.row() >= static_cast<int>(taskLists_.size())) {
    return {};
  }
  const TaskListSummary& taskList = taskLists_.at(index.row());
  switch (role) {
  case Qt::DisplayRole:
  case TitleRole:
    return taskList.title;
  case IdRole:
    return taskList.id;
  case AccountIdRole:
    return taskList.accountId;
  case SortOrderRole:
    return taskList.sortOrder;
  case SelectedRole:
    return taskList.selected;
  case TaskCountRole:
    return taskList.taskCount;
  case ActiveTaskCountRole:
    return taskList.activeTaskCount;
  default:
    return {};
  }
}

QHash<int, QByteArray> TaskListModel::roleNames() const {
  return {{IdRole, "id"},
          {AccountIdRole, "accountId"},
          {TitleRole, "title"},
          {SortOrderRole, "sortOrder"},
          {SelectedRole, "selected"},
          {TaskCountRole, "taskCount"},
          {ActiveTaskCountRole, "activeTaskCount"}};
}

void TaskListModel::setTaskLists(QList<TaskListSummary> taskLists) {
  const ModelDiffPlan plan = ModelDiffPolicy::plan(
      taskLists_,
      taskLists,
      [](const TaskListSummary& taskList) -> const QString& { return taskList.id; },
      equivalentTaskList);
  if (plan.requiresReset) {
    beginResetModel();
    taskLists_ = std::move(taskLists);
    endResetModel();
    return;
  }
  taskLists_ = std::move(taskLists);
  for (const ModelDataChangeRange& range : plan.changedRanges) {
    emit dataChanged(index(range.firstRow, 0), index(range.lastRow, 0));
  }
}

} // namespace hcb
