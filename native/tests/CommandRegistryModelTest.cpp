#include <QtTest>

#include "core/CommandRegistryModel.h"

class CommandRegistryModelTest final : public QObject {
  Q_OBJECT

private slots:
  void exposesNativeNavigationCommands();
  void rejectsInvalidIndexesAndUnknownLabels();
};

void CommandRegistryModelTest::exposesNativeNavigationCommands() {
  hcb::CommandRegistryModel commands;

  QCOMPARE(commands.rowCount(), 4);
  QCOMPARE(commands.rowCount(commands.index(0, 0)), 0);
  QCOMPARE(commands.data(commands.index(0, 0), hcb::CommandRegistryModel::CommandIdRole).toString(),
           QStringLiteral("navigation.tasks"));
  QCOMPARE(
      commands.data(commands.index(0, 0), hcb::CommandRegistryModel::CommandLabelRole).toString(),
      QStringLiteral("Tasks"));
  QCOMPARE(commands.data(commands.index(1, 0), Qt::DisplayRole).toString(),
           QStringLiteral("Calendar"));
  QCOMPARE(commands.data(commands.index(3, 0), hcb::CommandRegistryModel::CommandIdRole).toString(),
           QStringLiteral("navigation.settings"));
  QCOMPARE(commands.data(commands.index(2, 0), hcb::CommandRegistryModel::CommandShortcutRole)
               .toString(),
           QStringLiteral("Ctrl+3"));
  QCOMPARE(commands.roleNames().value(hcb::CommandRegistryModel::CommandIdRole),
           QByteArrayLiteral("commandId"));
  QCOMPARE(commands.roleNames().value(hcb::CommandRegistryModel::CommandLabelRole),
           QByteArrayLiteral("commandLabel"));
  QCOMPARE(commands.roleNames().value(hcb::CommandRegistryModel::CommandShortcutRole),
           QByteArrayLiteral("commandShortcut"));
}

void CommandRegistryModelTest::rejectsInvalidIndexesAndUnknownLabels() {
  hcb::CommandRegistryModel commands;

  QVERIFY(!commands.data(QModelIndex(), Qt::DisplayRole).isValid());
  QVERIFY(!commands.data(commands.index(4, 0), Qt::DisplayRole).isValid());
  QVERIFY(commands.containsLabel(QStringLiteral("Notes")));
  QVERIFY(!commands.containsLabel(QStringLiteral("Unsupported")));
  QVERIFY(!commands.containsLabel(QStringLiteral("notes")));
}

QTEST_MAIN(CommandRegistryModelTest)
#include "CommandRegistryModelTest.moc"
