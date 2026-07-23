#include "core/CommandRegistryModel.h"

#include <algorithm>

namespace hcb {

CommandRegistryModel::CommandRegistryModel(QObject* parent)
    : QAbstractListModel(parent),
      commands_{{QStringLiteral("navigation.tasks"), QStringLiteral("Tasks")},
                {QStringLiteral("navigation.calendar"), QStringLiteral("Calendar")},
                {QStringLiteral("navigation.notes"), QStringLiteral("Notes")},
                {QStringLiteral("navigation.settings"), QStringLiteral("Settings")}} {}

int CommandRegistryModel::rowCount(const QModelIndex& parent) const {
  return parent.isValid() ? 0 : static_cast<int>(commands_.size());
}

QVariant CommandRegistryModel::data(const QModelIndex& index, int role) const {
  if (!index.isValid() || index.row() < 0 || index.row() >= static_cast<int>(commands_.size())) {
    return {};
  }

  const Command& command = commands_.at(index.row());
  switch (role) {
  case Qt::DisplayRole:
  case CommandLabelRole:
    return command.label;
  case CommandIdRole:
    return command.id;
  default:
    return {};
  }
}

QHash<int, QByteArray> CommandRegistryModel::roleNames() const {
  return {{CommandIdRole, "commandId"}, {CommandLabelRole, "commandLabel"}};
}

bool CommandRegistryModel::containsLabel(const QString& label) const {
  return std::any_of(commands_.cbegin(), commands_.cend(), [&label](const Command& command) {
    return command.label == label;
  });
}

} // namespace hcb
