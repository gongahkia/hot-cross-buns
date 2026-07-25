#include "core/TaskModel.h"

#include <QHash>

#include <algorithm>
#include <utility>

namespace hcb {

struct TaskModel::Node final {
  TaskModelTask task;
  Node* parent{nullptr};
  QList<Node*> children;
};

namespace {

[[nodiscard]] bool isValidTask(const TaskModelTask& task) {
  return !task.id.isEmpty() && task.id == task.id.trimmed() && task.id.size() <= 256 &&
         !task.id.contains(QChar::Null) && !task.taskListId.isEmpty() &&
         task.taskListId == task.taskListId.trimmed() && task.taskListId.size() <= 256 &&
         !task.taskListId.contains(QChar::Null) && !task.title.isEmpty() &&
         task.title == task.title.trimmed() && task.title.size() <= 500 &&
         !task.title.contains(QChar::Null) && task.sortOrder >= 0;
}

[[nodiscard]] int rowOf(const QList<TaskModel::Node*>& siblings, const TaskModel::Node* node) {
  return siblings.indexOf(const_cast<TaskModel::Node*>(node));
}

[[nodiscard]] bool wouldCreateCycle(const TaskModel::Node* node,
                                    const TaskModel::Node* candidateParent,
                                    const QHash<QString, TaskModel::Node*>& byId) {
  const TaskModel::Node* current = candidateParent;
  while (current != nullptr) {
    if (current == node || !current->task.parentTaskId.has_value()) {
      return current == node;
    }
    current = byId.value(*current->task.parentTaskId, nullptr);
  }
  return false;
}

} // namespace

TaskModel::TaskModel(QObject* parent) : QAbstractItemModel(parent) {}

QModelIndex TaskModel::index(int row, int column, const QModelIndex& parentIndex) const {
  if (row < 0 || column != 0) {
    return {};
  }
  const Node* parentNode = parentIndex.isValid() ? static_cast<const Node*>(parentIndex.internalPointer())
                                                  : nullptr;
  const QList<Node*>& siblings = parentNode == nullptr ? roots_ : parentNode->children;
  return row >= siblings.size() ? QModelIndex() : createIndex(row, column, siblings.at(row));
}

QModelIndex TaskModel::parent(const QModelIndex& index) const {
  if (!index.isValid()) {
    return {};
  }
  const Node* node = static_cast<const Node*>(index.internalPointer());
  const Node* parentNode = node->parent;
  if (parentNode == nullptr) {
    return {};
  }
  const QList<Node*>& siblings = parentNode->parent == nullptr ? roots_ : parentNode->parent->children;
  const int row = rowOf(siblings, parentNode);
  return row < 0 ? QModelIndex() : createIndex(row, 0, const_cast<Node*>(parentNode));
}

int TaskModel::rowCount(const QModelIndex& parentIndex) const {
  if (parentIndex.isValid() && parentIndex.column() != 0) {
    return 0;
  }
  const Node* node = parentIndex.isValid() ? static_cast<const Node*>(parentIndex.internalPointer()) : nullptr;
  return node == nullptr ? roots_.size() : node->children.size();
}

int TaskModel::columnCount(const QModelIndex&) const { return 1; }

QVariant TaskModel::data(const QModelIndex& index, int role) const {
  if (!index.isValid() || index.column() != 0) {
    return {};
  }
  const Node* node = static_cast<const Node*>(index.internalPointer());
  const TaskModelTask& task = node->task;
  switch (role) {
  case Qt::DisplayRole:
  case TitleRole:
    return task.title;
  case IdRole:
    return task.id;
  case TaskListIdRole:
    return task.taskListId;
  case ParentTaskIdRole:
    return task.parentTaskId.value_or(QString());
  case NotesRole:
    return task.notes.value_or(QString());
  case DueAtRole:
    return task.due.has_value() ? task.due->at.value_or(QString()) : QString();
  case DueTimeZoneRole:
    return task.due.has_value() ? task.due->timeZone.value_or(QString()) : QString();
  case PriorityRole:
    return static_cast<int>(task.priority);
  case CompletedRole:
    return task.completed;
  case SortOrderRole:
    return task.sortOrder;
  default:
    return {};
  }
}

QHash<int, QByteArray> TaskModel::roleNames() const {
  return {{IdRole, "id"},
          {TaskListIdRole, "taskListId"},
          {ParentTaskIdRole, "parentTaskId"},
          {TitleRole, "title"},
          {NotesRole, "notes"},
          {DueAtRole, "dueAt"},
          {DueTimeZoneRole, "dueTimeZone"},
          {PriorityRole, "priority"},
          {CompletedRole, "completed"},
          {SortOrderRole, "sortOrder"}};
}

void TaskModel::setTasks(QList<TaskModelTask> tasks) {
  std::vector<std::unique_ptr<Node>> nodes;
  nodes.reserve(static_cast<std::size_t>(tasks.size()));
  QHash<QString, Node*> byId;
  for (TaskModelTask& task : tasks) {
    if (!isValidTask(task) || byId.contains(task.id)) {
      continue;
    }
    auto node = std::make_unique<Node>(Node{.task = std::move(task)});
    byId.insert(node->task.id, node.get());
    nodes.push_back(std::move(node));
  }
  QList<Node*> roots;
  for (const std::unique_ptr<Node>& node : nodes) {
    Node* parentNode = nullptr;
    if (node->task.parentTaskId.has_value()) {
      parentNode = byId.value(*node->task.parentTaskId, nullptr);
    }
    if (parentNode == nullptr || wouldCreateCycle(node.get(), parentNode, byId)) {
      roots.append(node.get());
    } else {
      node->parent = parentNode;
      parentNode->children.append(node.get());
    }
  }
  const auto order = [](const Node* left, const Node* right) {
    return left->task.sortOrder != right->task.sortOrder ? left->task.sortOrder < right->task.sortOrder
                                                          : left->task.id < right->task.id;
  };
  std::sort(roots.begin(), roots.end(), order);
  for (const std::unique_ptr<Node>& node : nodes) {
    std::sort(node->children.begin(), node->children.end(), order);
  }
  beginResetModel();
  roots_ = std::move(roots);
  nodes_ = std::move(nodes);
  endResetModel();
}

} // namespace hcb
