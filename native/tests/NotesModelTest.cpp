#include <QtTest/QTest>

#include "core/NotesModel.h"

class NotesModelTest final : public QObject {
  Q_OBJECT

private slots:
  void exposesNoteRolesAndResets();
  void rejectsInvalidIndexes();
};

void NotesModelTest::exposesNoteRolesAndResets() {
  hcb::NotesModel model;
  model.setNotes({{.id = QStringLiteral("note-a"),
                   .taskListId = QStringLiteral("list-a"),
                   .taskListTitle = QStringLiteral("Notes"),
                   .title = QStringLiteral("Release plan"),
                   .body = QStringLiteral("Ship the native models."),
                   .updatedAt = QStringLiteral("2026-07-25T00:00:00.000Z")}});

  QCOMPARE(model.rowCount(), 1);
  const QModelIndex index = model.index(0, 0);
  QCOMPARE(model.data(index, Qt::DisplayRole).toString(), QStringLiteral("Release plan"));
  QCOMPARE(model.data(index, hcb::NotesModel::IdRole).toString(), QStringLiteral("note-a"));
  QCOMPARE(model.data(index, hcb::NotesModel::TaskListIdRole).toString(), QStringLiteral("list-a"));
  QCOMPARE(model.data(index, hcb::NotesModel::TaskListTitleRole).toString(),
           QStringLiteral("Notes"));
  QCOMPARE(model.data(index, hcb::NotesModel::BodyRole).toString(),
           QStringLiteral("Ship the native models."));
  QCOMPARE(model.data(index, hcb::NotesModel::UpdatedAtRole).toString(),
           QStringLiteral("2026-07-25T00:00:00.000Z"));
  QCOMPARE(model.roleNames().value(hcb::NotesModel::TaskListTitleRole),
           QByteArrayLiteral("taskListTitle"));

  model.setNotes({});
  QCOMPARE(model.rowCount(), 0);
}

void NotesModelTest::rejectsInvalidIndexes() {
  hcb::NotesModel model;
  QVERIFY(!model.data(QModelIndex(), Qt::DisplayRole).isValid());
  QVERIFY(!model.data(model.index(0, 0), Qt::DisplayRole).isValid());
  QCOMPARE(model.rowCount(model.index(0, 0)), 0);
}

QTEST_GUILESS_MAIN(NotesModelTest)

#include "NotesModelTest.moc"
