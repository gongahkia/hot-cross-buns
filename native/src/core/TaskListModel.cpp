#include "core/TaskListModel.h"

#include <utility>

namespace hcb {

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
  beginResetModel();
  taskLists_ = std::move(taskLists);
  endResetModel();
}

} // namespace hcb
