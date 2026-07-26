#include <QtTest/QTest>

#include "core/TaskRecurrenceMarker.h"

class TaskRecurrenceMarkerTest final : public QObject {
  Q_OBJECT

private slots:
  void roundTripsWithoutChangingUserNotes();
  void rejectsMalformedAndUnknownMarkersWithoutDiscardingNotes();
  void enforcesGoogleNotesLimit();
  void advancesDatesFromTheAnchorAcrossDstAndMonthEnds();
};

namespace {

[[nodiscard]] hcb::TaskRecurrenceMarker marker() {
  return {
      .seriesId = QStringLiteral("b5c71e7f-2cf6-4f49-9bcd-d46c56574492"),
      .occurrenceId = QStringLiteral("b5c71e7f-2cf6-4f49-9bcd-d46c56574492:3"),
      .ordinal = 3,
      .frequency = hcb::TaskRecurrenceFrequency::Weekly,
      .interval = 2,
      .anchorDate = QStringLiteral("2026-07-26"),
      .timeZone = QStringLiteral("Asia/Singapore"),
      .end = {.kind = hcb::TaskRecurrenceEndKind::Until, .untilDate = QStringLiteral("2026-12-31")},
      .templateTitle = QStringLiteral("Pay rent"),
      .templateDueDate = QStringLiteral("2026-07-26"),
      .templatePriority = QStringLiteral("high")};
}

} // namespace

void TaskRecurrenceMarkerTest::roundTripsWithoutChangingUserNotes() {
  const QString body = QStringLiteral("First line\n\nKeep every byte.\n");
  const hcb::TaskRecurrenceSerializationResult serialized =
      hcb::serializeTaskRecurrenceNotes(body, marker());
  QVERIFY(!serialized.error.has_value());
  QVERIFY(serialized.notes.contains(QStringLiteral("[HCB-RECURRENCE v1]")));

  const hcb::TaskRecurrenceNotes parsed = hcb::parseTaskRecurrenceNotes(serialized.notes);
  QCOMPARE(parsed.state, hcb::TaskRecurrenceNotesState::Managed);
  QCOMPARE(parsed.userNotes, body);
  QVERIFY(parsed.marker.has_value());
  if (!parsed.marker.has_value()) {
    return;
  }
  QCOMPARE(parsed.marker->seriesId, marker().seriesId);
  QCOMPARE(parsed.marker->occurrenceId, marker().occurrenceId);
  QCOMPARE(parsed.marker->ordinal, 3);
  QCOMPARE(hcb::taskRecurrenceSummary(*parsed.marker),
           QStringLiteral("Every 2 weeks until 2026-12-31"));

  const hcb::TaskRecurrenceSerializationResult repeated =
      hcb::serializeTaskRecurrenceNotes(parsed.userNotes, *parsed.marker);
  QVERIFY(!repeated.error.has_value());
  QCOMPARE(repeated.notes, serialized.notes);
}

void TaskRecurrenceMarkerTest::rejectsMalformedAndUnknownMarkersWithoutDiscardingNotes() {
  const QString body = QStringLiteral("User authored notes");
  const hcb::TaskRecurrenceSerializationResult serialized =
      hcb::serializeTaskRecurrenceNotes(body, marker());
  QVERIFY(!serialized.error.has_value());

  const QString malformed = serialized.notes + QStringLiteral("\nextra");
  const hcb::TaskRecurrenceNotes malformedParsed = hcb::parseTaskRecurrenceNotes(malformed);
  QCOMPARE(malformedParsed.state, hcb::TaskRecurrenceNotesState::Malformed);
  QCOMPARE(malformedParsed.userNotes, malformed);
  QVERIFY(!malformedParsed.diagnostic.isEmpty());

  QString unsupported = serialized.notes;
  unsupported.replace(QStringLiteral("[HCB-RECURRENCE v1]"), QStringLiteral("[HCB-RECURRENCE v2]"));
  const hcb::TaskRecurrenceNotes unsupportedParsed = hcb::parseTaskRecurrenceNotes(unsupported);
  QCOMPARE(unsupportedParsed.state, hcb::TaskRecurrenceNotesState::UnsupportedVersion);
  QCOMPARE(unsupportedParsed.userNotes, unsupported);
}

void TaskRecurrenceMarkerTest::enforcesGoogleNotesLimit() {
  const QString body(8'192, u'x');
  const hcb::TaskRecurrenceSerializationResult serialized =
      hcb::serializeTaskRecurrenceNotes(body, marker());
  QVERIFY(serialized.error.has_value());
  QVERIFY(serialized.notes.isEmpty());

  hcb::TaskRecurrenceMarker invalid = marker();
  invalid.occurrenceId = QStringLiteral("not-derived");
  const hcb::TaskRecurrenceSerializationResult invalidSerialized =
      hcb::serializeTaskRecurrenceNotes(QString(), invalid);
  QVERIFY(invalidSerialized.error.has_value());
}

void TaskRecurrenceMarkerTest::advancesDatesFromTheAnchorAcrossDstAndMonthEnds() {
  hcb::TaskRecurrenceMarker weekly = marker();
  weekly.interval = 1;
  weekly.anchorDate = QStringLiteral("2026-03-08");
  weekly.templateDueDate = weekly.anchorDate;
  weekly.timeZone = QStringLiteral("America/New_York");
  weekly.ordinal = 0;
  weekly.occurrenceId = weekly.seriesId + QStringLiteral(":0");
  const std::optional<hcb::TaskRecurrenceMarker> weeklySuccessor =
      hcb::taskRecurrenceSuccessor(weekly);
  QVERIFY(weeklySuccessor.has_value());
  if (!weeklySuccessor.has_value()) {
    return;
  }
  QCOMPARE(weeklySuccessor->templateDueDate, QStringLiteral("2026-03-15"));

  hcb::TaskRecurrenceMarker monthly = marker();
  monthly.frequency = hcb::TaskRecurrenceFrequency::Monthly;
  monthly.interval = 1;
  monthly.anchorDate = QStringLiteral("2024-01-31");
  monthly.templateDueDate = monthly.anchorDate;
  monthly.end = {.kind = hcb::TaskRecurrenceEndKind::Count, .count = 3};
  monthly.ordinal = 0;
  monthly.occurrenceId = monthly.seriesId + QStringLiteral(":0");
  const std::optional<hcb::TaskRecurrenceMarker> february =
      hcb::taskRecurrenceSuccessor(monthly);
  QVERIFY(february.has_value());
  if (!february.has_value()) {
    return;
  }
  QCOMPARE(february->templateDueDate, QStringLiteral("2024-02-29"));
  const std::optional<hcb::TaskRecurrenceMarker> march =
      hcb::taskRecurrenceSuccessor(*february);
  QVERIFY(march.has_value());
  if (!march.has_value()) {
    return;
  }
  QCOMPARE(march->templateDueDate, QStringLiteral("2024-03-31"));
  QVERIFY(!hcb::taskRecurrenceSuccessor(*march).has_value());
}

QTEST_GUILESS_MAIN(TaskRecurrenceMarkerTest)

#include "TaskRecurrenceMarkerTest.moc"
