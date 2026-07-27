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

} // namespace

TaskModel::TaskModel(QObject* parent) : QAbstractItemModel(parent) {}

TaskModel::~TaskModel() = default;

QModelIndex TaskModel::index(int row, int column, const QModelIndex& parentIndex) const {
  if (row < 0 || column != 0) {
    return {};
  }
  const Node* parentNode =
      parentIndex.isValid() ? static_cast<const Node*>(parentIndex.internalPointer()) : nullptr;
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
  const QList<Node*>& siblings =
      parentNode->parent == nullptr ? roots_ : parentNode->parent->children;
  const int row = static_cast<int>(siblings.indexOf(const_cast<Node*>(parentNode)));
  return row < 0 ? QModelIndex() : createIndex(row, 0, const_cast<Node*>(parentNode));
}

int TaskModel::rowCount(const QModelIndex& parentIndex) const {
  if (parentIndex.isValid() && parentIndex.column() != 0) {
    return 0;
  }
  const Node* node =
      parentIndex.isValid() ? static_cast<const Node*>(parentIndex.internalPointer()) : nullptr;
  return node == nullptr ? static_cast<int>(roots_.size())
                         : static_cast<int>(node->children.size());
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
  case ManagedRecurrenceRole:
    return task.managedRecurrence;
  case RecurrenceSummaryRole:
    return task.recurrenceSummary;
  case RecurrenceSeriesIdRole:
    return task.recurrenceSeriesId;
  case RecurrenceOccurrenceIdRole:
    return task.recurrenceOccurrenceId;
  case RecurrenceFrequencyRole:
    return task.recurrenceFrequency;
  case RecurrenceIntervalRole:
    return task.recurrenceInterval;
  case RecurrenceEndKindRole:
    return task.recurrenceEndKind;
  case RecurrenceEndUntilRole:
    return task.recurrenceEndUntil;
  case RecurrenceEndCountRole:
    return task.recurrenceEndCount;
  case RecurrenceDiagnosticRole:
    return task.recurrenceDiagnostic;
  case SortOrderRole:
    return static_cast<qlonglong>(task.sortOrder);
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
          {ManagedRecurrenceRole, "managedRecurrence"},
          {RecurrenceSummaryRole, "recurrenceSummary"},
          {RecurrenceSeriesIdRole, "recurrenceSeriesId"},
          {RecurrenceOccurrenceIdRole, "recurrenceOccurrenceId"},
          {RecurrenceFrequencyRole, "recurrenceFrequency"},
          {RecurrenceIntervalRole, "recurrenceInterval"},
          {RecurrenceEndKindRole, "recurrenceEndKind"},
          {RecurrenceEndUntilRole, "recurrenceEndUntil"},
          {RecurrenceEndCountRole, "recurrenceEndCount"},
          {RecurrenceDiagnosticRole, "recurrenceDiagnostic"},
          {SortOrderRole, "sortOrder"}};
}

QVariantList TaskModel::taskIds() const {
  QVariantList ids;
  ids.reserve(static_cast<qsizetype>(nodes_.size()));
  for (const std::unique_ptr<Node>& node : nodes_) {
    ids.append(node->task.id);
  }
  return ids;
}

QVariantList TaskModel::topLevelTasks() const {
  QVariantList tasks;
  tasks.reserve(roots_.size());
  for (const Node* root : roots_) {
    tasks.append(QVariantMap{{QStringLiteral("id"), root->task.id},
                             {QStringLiteral("title"), root->task.title},
                             {QStringLiteral("taskListId"), root->task.taskListId}});
  }
  return tasks;
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
  const auto order = [](const Node* left, const Node* right) {
    return left->task.sortOrder != right->task.sortOrder
               ? left->task.sortOrder < right->task.sortOrder
               : left->task.id < right->task.id;
  };
  const auto mustDetachForCycle = [&byId, &order](const Node* node, const Node* candidateParent) {
    const Node* current = candidateParent;
    const Node* cycleRoot = node;
    while (current != nullptr) {
      if (order(current, cycleRoot)) {
        cycleRoot = current;
      }
      if (current == node) {
        return cycleRoot == node;
      }
      current = current->task.parentTaskId.has_value()
                    ? byId.value(*current->task.parentTaskId, nullptr)
                    : nullptr;
    }
    return false;
  };
  for (const std::unique_ptr<Node>& node : nodes) {
    Node* parentNode = nullptr;
    if (node->task.parentTaskId.has_value()) {
      parentNode = byId.value(*node->task.parentTaskId, nullptr);
    }
    if (parentNode == nullptr || parentNode->task.taskListId != node->task.taskListId ||
        mustDetachForCycle(node.get(), parentNode)) {
      roots.append(node.get());
    } else {
      node->parent = parentNode;
      parentNode->children.append(node.get());
    }
  }
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
