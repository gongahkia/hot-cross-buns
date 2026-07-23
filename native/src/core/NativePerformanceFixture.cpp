#include "core/NativePerformanceFixture.h"

#include <QDateTime>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTimeZone>

#include <array>
#include <cstdint>

namespace hcb {
namespace {

constexpr NativePerformanceFixtureCounts kSmallCounts{50, 20, 10};
constexpr qint64 kBaseTimeMilliseconds = 1'767'603'600'000;
constexpr std::array<QStringView, 4> kTaskListIds{
    u"generated-inbox", u"generated-work", u"generated-personal", u"generated-later"};
constexpr std::array<QStringView, 3> kCalendarIds{
    u"generated-primary", u"generated-focus", u"generated-shared"};

QString padded(std::size_t value) {
  return QStringLiteral("%1").arg(static_cast<qulonglong>(value), 5, 10, QLatin1Char('0'));
}

QString timestamp(qint64 offsetMinutes) {
  const qint64 milliseconds = kBaseTimeMilliseconds + (offsetMinutes * 60'000);
  return QDateTime::fromMSecsSinceEpoch(milliseconds, QTimeZone::UTC).toString(Qt::ISODateWithMs);
}

QString taskId(std::size_t index) {
  return QStringLiteral("generated-small-task-%1").arg(padded(index + 1));
}

QString eventId(std::size_t index) {
  return QStringLiteral("generated-small-event-instance-%1").arg(padded(index + 1));
}

QString noteId(std::size_t index) {
  return QStringLiteral("generated-small-note-%1").arg(padded(index + 1));
}

QJsonValue optionalString(const std::optional<QString>& value) {
  return value.has_value() ? QJsonValue(*value) : QJsonValue(QJsonValue::Null);
}

} // namespace

NativePerformanceFixture NativePerformanceFixtureGenerator::small() {
  NativePerformanceFixture fixture{1,
                                   QStringLiteral("small"),
                                   QStringLiteral("hot-cross-buns-perf-small-v1"),
                                   true,
                                   timestamp(0),
                                   kSmallCounts,
                                   {},
                                   {},
                                   {},
                                   {},
                                   {}};
  fixture.taskLists.reserve(kTaskListIds.size());
  for (const QStringView id : kTaskListIds) {
    const QString idString = id.toString();
    fixture.taskLists.emplace_back(idString, idString.sliced(QStringLiteral("generated-").size()));
  }
  fixture.calendars.reserve(kCalendarIds.size());
  for (const QStringView id : kCalendarIds) {
    const QString idString = id.toString();
    fixture.calendars.emplace_back(idString, idString.sliced(QStringLiteral("generated-").size()));
  }

  fixture.tasks.reserve(fixture.counts.tasks);
  for (std::size_t index = 0; index < fixture.counts.tasks; ++index) {
    const bool completed = index % 9 == 0;
    fixture.tasks.push_back(
        {taskId(index),
         kTaskListIds[index % kTaskListIds.size()].toString(),
         index > 0 && index % 17 == 0 ? std::optional<QString>(taskId(index - 1)) : std::nullopt,
         QStringLiteral("Generated task %1").arg(padded(index + 1)),
         completed ? QStringLiteral("completed") : QStringLiteral("needsAction"),
         index % 5 == 0 ? std::nullopt
                        : std::optional<QString>(timestamp(static_cast<qint64>(index * 37))),
         completed ? std::optional<QString>(timestamp(static_cast<qint64>(index) - 120))
                   : std::nullopt,
         timestamp(static_cast<qint64>(index) - 240),
         index + 1});
  }

  fixture.eventInstances.reserve(fixture.counts.eventInstances);
  for (std::size_t index = 0; index < fixture.counts.eventInstances; ++index) {
    const qint64 startsAtOffset = static_cast<qint64>(index * 45);
    const qint64 durationMinutes = 30 + static_cast<qint64>(index % 4) * 15;
    fixture.eventInstances.push_back({eventId(index),
                                      kCalendarIds[index % kCalendarIds.size()].toString(),
                                      QStringLiteral("Generated event %1").arg(padded(index + 1)),
                                      timestamp(startsAtOffset),
                                      timestamp(startsAtOffset + durationMinutes),
                                      index % 31 == 0,
                                      timestamp(static_cast<qint64>(index) - 90)});
  }

  fixture.notes.reserve(fixture.counts.notes);
  for (std::size_t index = 0; index < fixture.counts.notes; ++index) {
    const bool linkedToTask = index % 3 == 0;
    const bool linkedToEvent = !linkedToTask && index % 5 == 0;
    fixture.notes.push_back(
        {noteId(index),
         linkedToTask    ? std::optional<QString>(QStringLiteral("task"))
         : linkedToEvent ? std::optional<QString>(QStringLiteral("event"))
                         : std::nullopt,
         linkedToTask    ? std::optional<QString>(taskId(index % fixture.counts.tasks))
         : linkedToEvent ? std::optional<QString>(eventId(index % fixture.counts.eventInstances))
                         : std::nullopt,
         QStringLiteral("Generated note %1").arg(padded(index + 1)),
         QStringLiteral("Generated note body %1 for deterministic performance fixtures.")
             .arg(padded(index + 1)),
         timestamp(static_cast<qint64>(index) - 360)});
  }
  return fixture;
}

QByteArray NativePerformanceFixtureGenerator::toJson(const NativePerformanceFixture& fixture) {
  QJsonArray taskLists;
  for (const auto& [id, title] : fixture.taskLists) {
    taskLists.append(QJsonObject{{QStringLiteral("id"), id}, {QStringLiteral("title"), title}});
  }
  QJsonArray calendars;
  for (const auto& [id, title] : fixture.calendars) {
    calendars.append(QJsonObject{{QStringLiteral("id"), id}, {QStringLiteral("title"), title}});
  }
  QJsonArray tasks;
  for (const NativePerformanceTaskFixture& task : fixture.tasks) {
    tasks.append(QJsonObject{{QStringLiteral("id"), task.id},
                             {QStringLiteral("taskListId"), task.taskListId},
                             {QStringLiteral("parentTaskId"), optionalString(task.parentTaskId)},
                             {QStringLiteral("title"), task.title},
                             {QStringLiteral("status"), task.status},
                             {QStringLiteral("dueAt"), optionalString(task.dueAt)},
                             {QStringLiteral("completedAt"), optionalString(task.completedAt)},
                             {QStringLiteral("updatedAt"), task.updatedAt},
                             {QStringLiteral("sortOrder"), static_cast<qint64>(task.sortOrder)}});
  }
  QJsonArray eventInstances;
  for (const NativePerformanceEventFixture& event : fixture.eventInstances) {
    eventInstances.append(QJsonObject{{QStringLiteral("id"), event.id},
                                      {QStringLiteral("calendarId"), event.calendarId},
                                      {QStringLiteral("title"), event.title},
                                      {QStringLiteral("startsAt"), event.startsAt},
                                      {QStringLiteral("endsAt"), event.endsAt},
                                      {QStringLiteral("isAllDay"), event.isAllDay},
                                      {QStringLiteral("updatedAt"), event.updatedAt}});
  }
  QJsonArray notes;
  for (const NativePerformanceNoteFixture& note : fixture.notes) {
    notes.append(
        QJsonObject{{QStringLiteral("id"), note.id},
                    {QStringLiteral("linkedResourceType"), optionalString(note.linkedResourceType)},
                    {QStringLiteral("linkedResourceId"), optionalString(note.linkedResourceId)},
                    {QStringLiteral("title"), note.title},
                    {QStringLiteral("body"), note.body},
                    {QStringLiteral("updatedAt"), note.updatedAt}});
  }

  const QJsonObject document{
      {QStringLiteral("schemaVersion"), static_cast<qint64>(fixture.schemaVersion)},
      {QStringLiteral("size"), fixture.size},
      {QStringLiteral("seed"), fixture.seed},
      {QStringLiteral("generatedDataOnly"), fixture.generatedDataOnly},
      {QStringLiteral("baseTime"), fixture.baseTime},
      {QStringLiteral("counts"),
       QJsonObject{
           {QStringLiteral("tasks"), static_cast<qint64>(fixture.counts.tasks)},
           {QStringLiteral("eventInstances"), static_cast<qint64>(fixture.counts.eventInstances)},
           {QStringLiteral("notes"), static_cast<qint64>(fixture.counts.notes)}}},
      {QStringLiteral("taskLists"), taskLists},
      {QStringLiteral("calendars"), calendars},
      {QStringLiteral("tasks"), tasks},
      {QStringLiteral("eventInstances"), eventInstances},
      {QStringLiteral("notes"), notes}};
  return QJsonDocument(document).toJson(QJsonDocument::Compact);
}

} // namespace hcb
