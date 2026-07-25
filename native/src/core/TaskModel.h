#pragma once

#include "core/TaskMutationService.h"

#include <QAbstractItemModel>

#include <QList>
#include <QString>

#include <cstdint>
#include <memory>
#include <optional>
#include <vector>

namespace hcb {

struct TaskModelTask final {
  QString id;
  QString taskListId;
  std::optional<QString> parentTaskId;
  QString title;
  std::optional<QString> notes;
  std::optional<TaskDue> due;
  TaskPriority priority{TaskPriority::None};
  bool completed{false};
  std::int64_t sortOrder{0};
};

class TaskModel final : public QAbstractItemModel {
  Q_OBJECT

public:
  enum Role : std::int32_t {
    IdRole = Qt::UserRole + 1,
    TaskListIdRole,
    ParentTaskIdRole,
    TitleRole,
    NotesRole,
    DueAtRole,
    DueTimeZoneRole,
    PriorityRole,
    CompletedRole,
    SortOrderRole
  };
  Q_ENUM(Role)

  explicit TaskModel(QObject* parent = nullptr);

  [[nodiscard]] QModelIndex index(int row, int column,
                                  const QModelIndex& parent = QModelIndex()) const override;
  [[nodiscard]] QModelIndex parent(const QModelIndex& index) const override;
  [[nodiscard]] int rowCount(const QModelIndex& parent = QModelIndex()) const override;
  [[nodiscard]] int columnCount(const QModelIndex& parent = QModelIndex()) const override;
  [[nodiscard]] QVariant data(const QModelIndex& index, int role = Qt::DisplayRole) const override;
  [[nodiscard]] QHash<int, QByteArray> roleNames() const override;

  void setTasks(QList<TaskModelTask> tasks);

private:
  struct Node;

  QList<Node*> roots_;
  std::vector<std::unique_ptr<Node>> nodes_;
};

} // namespace hcb
