#pragma once

#include "core/NoteService.h"

#include <QAbstractListModel>

#include <cstdint>

namespace hcb {

class NotesModel final : public QAbstractListModel {
  Q_OBJECT

public:
  enum Role : std::int32_t {
    IdRole = Qt::UserRole + 1,
    TaskListIdRole,
    TaskListTitleRole,
    TitleRole,
    BodyRole,
    UpdatedAtRole
  };
  Q_ENUM(Role)

  explicit NotesModel(QObject* parent = nullptr);

  [[nodiscard]] int rowCount(const QModelIndex& parent = QModelIndex()) const override;
  [[nodiscard]] QVariant data(const QModelIndex& index, int role = Qt::DisplayRole) const override;
  [[nodiscard]] QHash<int, QByteArray> roleNames() const override;

  void setNotes(QList<NoteSummary> notes);

private:
  QList<NoteSummary> notes_;
};

} // namespace hcb
