#pragma once

#include "core/TaskListReadService.h"

#include <QAbstractListModel>

#include <cstdint>

namespace hcb {

class TaskListModel final : public QAbstractListModel {
  Q_OBJECT

public:
  enum Role : std::int32_t {
    IdRole = Qt::UserRole + 1,
    AccountIdRole,
    TitleRole,
    SortOrderRole,
    SelectedRole,
    TaskCountRole,
    ActiveTaskCountRole
  };
  Q_ENUM(Role)

  explicit TaskListModel(QObject* parent = nullptr);

  [[nodiscard]] int rowCount(const QModelIndex& parent = QModelIndex()) const override;
  [[nodiscard]] QVariant data(const QModelIndex& index, int role = Qt::DisplayRole) const override;
  [[nodiscard]] QHash<int, QByteArray> roleNames() const override;

  void setTaskLists(QList<TaskListSummary> taskLists);

private:
  QList<TaskListSummary> taskLists_;
};

} // namespace hcb
