#include "app/AppController.h"

#include "app/LinuxCredentialAdapter.h"
#include "app/MacOSCredentialAdapter.h"
#include "app/WindowsCredentialAdapter.h"

#include "core/AgendaModel.h"
#include "core/CalendarSourceModel.h"
#include "core/LocalSearchQuery.h"
#include "core/MonthGridModel.h"
#include "core/NotesModel.h"
#include "core/SearchResultsModel.h"
#include "core/ReminderService.h"
#include "core/TaskListModel.h"
#include "core/TaskModel.h"
#include "core/TaskRecurrenceMarker.h"
#include "core/TimelineModel.h"

#include <QDate>
#include <QDateTime>
#include <QColor>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QFontDatabase>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMetaType>
#include <QRegularExpression>
#include <QSet>
#include <QTimeZone>
#include <QTimer>
#include <QThread>
#include <QUrlQuery>
#include <QUuid>
#include <QVariantMap>

#include <algorithm>
#include <chrono>
#include <optional>
#include <thread>
#include <utility>
#include <variant>

namespace hcb {
namespace {

constexpr int kCalendarTimelineDays = 7;
constexpr int kVisibleAllDayLaneCount = 2;
constexpr char kGoogleAccountId[] = "google";
constexpr char kSyncSettingsScope[] = "sync";
constexpr char kConflictPolicySettingsKey[] = "conflict_policy";
constexpr char kPresentationSettingsScope[] = "presentation";
constexpr char kNotesEnabledSettingsKey[] = "notes_enabled";
constexpr char kNotesProjectionSettingsKey[] = "notes_projection";
constexpr char kAppearanceModeSettingsKey[] = "appearance_mode";
constexpr char kVisualDensitySettingsKey[] = "visual_density";
constexpr char kPaletteModeSettingsKey[] = "palette_mode";
constexpr char kAccentColorSettingsKey[] = "accent_color";
constexpr char kFontFamilySettingsKey[] = "font_family";
constexpr char kFontScaleSettingsKey[] = "font_scale";
constexpr char kBulkTextRecurrenceScopeSettingsKey[] = "bulk_text_recurrence_scope";
constexpr char kQuickCaptureDefaultTaskListSettingsKey[] = "quick_capture_default_task_list";
constexpr char kQuickCaptureDefaultCalendarSettingsKey[] = "quick_capture_default_calendar";
constexpr char kQuickCaptureEventDurationSettingsKey[] = "quick_capture_event_duration_minutes";
constexpr char kQuickCaptureRemoveParsedTextSettingsKey[] = "quick_capture_remove_parsed_text";
constexpr char kQuickCaptureTaskAliasesSettingsKey[] = "quick_capture_task_aliases";
constexpr char kQuickCaptureEventAliasesSettingsKey[] = "quick_capture_event_aliases";
constexpr char kQuickCaptureHighPriorityAliasesSettingsKey[] = "quick_capture_high_priority_aliases";
constexpr char kQuickCaptureMediumPriorityAliasesSettingsKey[] = "quick_capture_medium_priority_aliases";
constexpr char kQuickCaptureLowPriorityAliasesSettingsKey[] = "quick_capture_low_priority_aliases";
constexpr char kWeekStartDaySettingsKey[] = "week_start_day";
constexpr char kUse24HourTimeSettingsKey[] = "use_24_hour_time";
constexpr char kDisplayTimeZoneSettingsKey[] = "display_time_zone";
constexpr char kWorkdayStartHourSettingsKey[] = "workday_start_hour";
constexpr char kWorkdayEndHourSettingsKey[] = "workday_end_hour";
constexpr char kCalendarVisibilitySettingsKey[] = "calendar_visibility";
constexpr int kNotesOnlyProjection = 0;
constexpr int kMirrorNotesProjection = 1;
constexpr auto kGoogleSyncInterval = std::chrono::minutes(5);
constexpr int kSearchDebounceMilliseconds = 180;

[[nodiscard]] std::unique_ptr<OAuthCredentialStore> makeCredentialStore() {
#if defined(Q_OS_MACOS)
  return std::make_unique<MacOSCredentialAdapter>();
#elif defined(Q_OS_LINUX)
  return std::make_unique<LinuxCredentialAdapter>();
#elif defined(Q_OS_WIN)
  return std::make_unique<WindowsCredentialAdapter>();
#else
  return {};
#endif
}

[[nodiscard]] QStringList requiredGoogleScopes() {
  return {QStringLiteral("https://www.googleapis.com/auth/tasks"),
          QStringLiteral("https://www.googleapis.com/auth/calendar"),
          QStringLiteral("https://www.googleapis.com/auth/drive.metadata.readonly")};
}

[[nodiscard]] QString authenticationTimestamp(const Clock& clock) {
  const auto milliseconds =
      std::chrono::duration_cast<std::chrono::milliseconds>(clock.wallNow().time_since_epoch());
  return QDateTime::fromMSecsSinceEpoch(milliseconds.count(), QTimeZone::UTC)
      .toString(Qt::ISODateWithMs);
}

[[nodiscard]] QString errorMessage(const AppError& error) { return error.message(); }

[[nodiscard]] bool isValidAppearanceMode(int value) { return value >= 0 && value <= 2; }

[[nodiscard]] bool isValidVisualDensity(int value) { return value >= 0 && value <= 2; }

[[nodiscard]] bool isValidPaletteMode(int value) { return value >= 0 && value <= 5; }

[[nodiscard]] bool isValidFontScale(int value) { return value >= 0 && value <= 3; }

[[nodiscard]] bool isValidBulkTextRecurrenceScope(int value) { return value >= 0 && value <= 3; }

[[nodiscard]] bool isValidQuickCaptureKind(int value) {
  return value == static_cast<int>(QuickCaptureKind::Task) ||
         value == static_cast<int>(QuickCaptureKind::Event);
}

[[nodiscard]] bool isValidQuickCaptureDuration(int value) { return value >= 1 && value <= 1'440; }

[[nodiscard]] bool isValidQuickCaptureDestination(const QString& value) {
  return value.isEmpty() || (value == value.trimmed() && value.size() <= 256 &&
                             !value.contains(QChar::Null));
}

[[nodiscard]] bool isValidQuickCaptureAlias(const QString& value) {
  static const QRegularExpression expression(QStringLiteral("^[A-Za-z][A-Za-z0-9_-]{0,31}$"));
  return expression.match(value).hasMatch();
}

[[nodiscard]] std::optional<QStringList> quickCaptureAliasesFromText(const QString& text) {
  QStringList aliases;
  QSet<QString> seen;
  const QStringList parts = text.split(',', Qt::SkipEmptyParts);
  for (const QString& part : parts) {
    const QString alias = part.trimmed();
    if (!isValidQuickCaptureAlias(alias) || seen.contains(alias.toCaseFolded())) {
      return std::nullopt;
    }
    seen.insert(alias.toCaseFolded());
    aliases.append(alias);
  }
  return aliases.isEmpty() ? std::nullopt : std::optional<QStringList>(aliases);
}

[[nodiscard]] bool quickCaptureAliasesAreDistinct(const QStringList& task,
                                                   const QStringList& event,
                                                   const QStringList& high,
                                                   const QStringList& medium,
                                                   const QStringList& low) {
  QSet<QString> seen;
  for (const QStringList* values : {&task, &event, &high, &medium, &low}) {
    for (const QString& value : *values) {
      const QString normalized = value.toCaseFolded();
      if (seen.contains(normalized)) {
        return false;
      }
      seen.insert(normalized);
    }
  }
  return true;
}

[[nodiscard]] QString quickCaptureAliasesToText(const QStringList& aliases) {
  return aliases.join(QStringLiteral(", "));
}

[[nodiscard]] bool isValidAccentColor(const QString& value) {
  if (value.isEmpty()) {
    return true;
  }
  if (value.size() != 7 || value.front() != u'#') {
    return false;
  }
  const QColor color(value);
  return color.isValid() && color.name(QColor::HexRgb).compare(value, Qt::CaseInsensitive) == 0;
}

[[nodiscard]] QStringList installedFontFamilies() {
  QStringList families = QFontDatabase::families();
  families.removeDuplicates();
  std::sort(families.begin(), families.end(), [](const QString& left, const QString& right) {
    return left.compare(right, Qt::CaseInsensitive) < 0;
  });
  return families;
}

[[nodiscard]] bool isValidWeekStartDay(int value) { return value == 0 || value == 1; }

[[nodiscard]] bool isValidWorkdayHours(int startHour, int endHour) {
  return startHour >= 0 && startHour <= 23 && endHour >= 1 && endHour <= 24 && startHour < endHour;
}

[[nodiscard]] QTimeZone resolvedTimeZone(const QString& value) {
  const QTimeZone zone(value.toUtf8());
  return zone.isValid() ? zone : QTimeZone::systemTimeZone();
}

[[nodiscard]] std::optional<QString> jsonArrayString(const QString& value) {
  QJsonParseError error;
  const QJsonDocument document = QJsonDocument::fromJson(value.toUtf8(), &error);
  if (error.error != QJsonParseError::NoError || !document.isArray() || document.array().size() != 1 ||
      !document.array().at(0).isString()) {
    return std::nullopt;
  }
  return document.array().at(0).toString();
}

[[nodiscard]] QString jsonStringArray(const QString& value) {
  return QString::fromUtf8(QJsonDocument(QJsonArray{value}).toJson(QJsonDocument::Compact));
}

[[nodiscard]] std::optional<QStringList> jsonStringList(const QString& value) {
  QJsonParseError error;
  const QJsonDocument document = QJsonDocument::fromJson(value.toUtf8(), &error);
  if (error.error != QJsonParseError::NoError || !document.isArray() || document.array().isEmpty() ||
      document.array().size() > 32) {
    return std::nullopt;
  }
  QStringList values;
  values.reserve(document.array().size());
  for (const QJsonValue& item : document.array()) {
    if (!item.isString()) {
      return std::nullopt;
    }
    values.append(item.toString());
  }
  return values;
}

[[nodiscard]] QString jsonStringList(const QStringList& values) {
  QJsonArray array;
  for (const QString& value : values) {
    array.append(value);
  }
  return QString::fromUtf8(QJsonDocument(array).toJson(QJsonDocument::Compact));
}

[[nodiscard]] std::optional<TaskPriority> priorityForValue(int value) {
  switch (value) {
  case static_cast<int>(TaskPriority::None):
    return TaskPriority::None;
  case static_cast<int>(TaskPriority::Low):
    return TaskPriority::Low;
  case static_cast<int>(TaskPriority::Medium):
    return TaskPriority::Medium;
  case static_cast<int>(TaskPriority::High):
    return TaskPriority::High;
  default:
    return std::nullopt;
  }
}

[[nodiscard]] QString priorityText(TaskPriority priority) {
  switch (priority) {
  case TaskPriority::None:
    return QStringLiteral("none");
  case TaskPriority::Low:
    return QStringLiteral("low");
  case TaskPriority::Medium:
    return QStringLiteral("medium");
  case TaskPriority::High:
    return QStringLiteral("high");
  }
  return {};
}

[[nodiscard]] std::optional<TaskPriority> importPriority(const std::optional<QString>& value) {
  if (!value.has_value() || value->trimmed().isEmpty() || value->toCaseFolded() == QStringLiteral("none")) {
    return TaskPriority::None;
  }
  if (value->toCaseFolded() == QStringLiteral("low")) return TaskPriority::Low;
  if (value->toCaseFolded() == QStringLiteral("medium")) return TaskPriority::Medium;
  if (value->toCaseFolded() == QStringLiteral("high")) return TaskPriority::High;
  return std::nullopt;
}

[[nodiscard]] QVariantList importPreviewRowVariants(const ImportParseResult& parsed) {
  QVariantList rows;
  rows.reserve(parsed.rows.size());
  for (const ImportPreviewRow& row : parsed.rows) {
    rows.append(QVariantMap{{QStringLiteral("line"), row.sourceLine},
                            {QStringLiteral("kind"),
                             row.kind == ImportItemKind::Task ? QStringLiteral("Task")
                                                              : QStringLiteral("Event")},
                            {QStringLiteral("title"), row.title},
                            {QStringLiteral("accepted"), row.accepted},
                            {QStringLiteral("message"), row.message}});
  }
  return rows;
}

template <typename Summary>
[[nodiscard]] std::optional<QString> resolveImportTarget(const std::optional<QString>& name,
                                                          const QString& defaultId,
                                                          const QList<Summary>& candidates) {
  if (!name.has_value()) {
    const auto match = std::find_if(candidates.cbegin(), candidates.cend(), [&defaultId](const Summary& item) {
      return item.id == defaultId;
    });
    return match == candidates.cend() ? std::nullopt : std::optional<QString>(match->id);
  }
  std::optional<QString> found;
  for (const Summary& candidate : candidates) {
    if (candidate.title != *name) continue;
    if (found.has_value()) return std::nullopt;
    found = candidate.id;
  }
  return found;
}

[[nodiscard]] std::optional<QList<QString>> recurrenceDatesFromText(const QString& value);

[[nodiscard]] std::optional<QList<QString>> importRecurrenceDates(const std::optional<QString>& text) {
  if (!text.has_value()) return QList<QString>{};
  return recurrenceDatesFromText(*text);
}

struct ManagedTaskRecurrenceConfiguration final {
  TaskRecurrenceFrequency frequency;
  std::int32_t interval;
  TaskRecurrenceEndCondition end;
  QString defaultRule;
};

[[nodiscard]] std::optional<ManagedTaskRecurrenceConfiguration>
managedTaskRecurrenceConfiguration(int frequency,
                                   int interval,
                                   int endKind,
                                   const QString& endUntil,
                                   int endCount) {
  std::optional<TaskRecurrenceFrequency> parsedFrequency;
  switch (frequency) {
  case 0:
    parsedFrequency = TaskRecurrenceFrequency::Daily;
    break;
  case 1:
    parsedFrequency = TaskRecurrenceFrequency::Weekly;
    break;
  case 2:
    parsedFrequency = TaskRecurrenceFrequency::Monthly;
    break;
  case 3:
    parsedFrequency = TaskRecurrenceFrequency::Yearly;
    break;
  case 4:
    parsedFrequency = TaskRecurrenceFrequency::Daily;
    break;
  default:
    return std::nullopt;
  }
  if (interval < 1 || interval > 1'000) {
    return std::nullopt;
  }
  TaskRecurrenceEndCondition end;
  switch (endKind) {
  case 0:
    end.kind = TaskRecurrenceEndKind::Never;
    break;
  case 1: {
    const QDate until = QDate::fromString(endUntil.trimmed(), Qt::ISODate);
    if (!until.isValid()) {
      return std::nullopt;
    }
    end.kind = TaskRecurrenceEndKind::Until;
    end.untilDate = until.toString(Qt::ISODate);
    break;
  }
  case 2:
    if (endCount < 1 || endCount > 10'000) {
      return std::nullopt;
    }
    end.kind = TaskRecurrenceEndKind::Count;
    end.count = static_cast<std::int32_t>(endCount);
    break;
  default:
    return std::nullopt;
  }
  return ManagedTaskRecurrenceConfiguration{.frequency = *parsedFrequency,
                                            .interval = static_cast<std::int32_t>(interval),
                                            .end = std::move(end),
                                            .defaultRule = frequency == 4
                                                               ? QStringLiteral("FREQ=DAILY;INTERVAL=%1;BYDAY=MO,TU,WE,TH,FR").arg(interval)
                                                               : QString()};
}

[[nodiscard]] std::optional<QList<QString>> recurrenceDatesFromText(const QString& value) {
  QList<QString> dates;
  QSet<QString> seen;
  for (const QString& token : value.split(u',', Qt::SkipEmptyParts)) {
    const QDate date = QDate::fromString(token.trimmed(), Qt::ISODate);
    const QString normalized = date.toString(Qt::ISODate);
    if (!date.isValid() || seen.contains(normalized)) {
      return std::nullopt;
    }
    seen.insert(normalized);
    dates.append(normalized);
  }
  return dates;
}

[[nodiscard]] std::optional<QList<QString>> taskIdsFromVariantList(const QVariantList& values) {
  QList<QString> taskIds;
  taskIds.reserve(values.size());
  for (const QVariant& value : values) {
    if (value.metaType().id() != QMetaType::QString) {
      return std::nullopt;
    }
    taskIds.append(value.toString());
  }
  return taskIds;
}

[[nodiscard]] std::optional<QList<QString>>
eventAttendeesFromVariantList(const QVariantList& values) {
  QList<QString> attendees;
  attendees.reserve(values.size());
  for (const QVariant& value : values) {
    if (value.metaType().id() != QMetaType::QString) {
      return std::nullopt;
    }
    attendees.append(value.toString());
  }
  return attendees;
}

[[nodiscard]] std::optional<CalendarEventReminderSettings>
eventRemindersFromVariantList(bool useDefault, const QVariantList& values) {
  CalendarEventReminderSettings settings{.useDefault = useDefault};
  settings.overrides.reserve(values.size());
  for (const QVariant& value : values) {
    if (!value.canConvert<QVariantMap>()) {
      return std::nullopt;
    }
    const QVariantMap reminder = value.toMap();
    const QVariant method = reminder.value(QStringLiteral("method"));
    const QVariant minutes = reminder.value(QStringLiteral("minutes"));
    if (method.metaType().id() != QMetaType::QString || !minutes.canConvert<int>()) {
      return std::nullopt;
    }
    settings.overrides.append({.method = method.toString(), .minutes = minutes.toInt()});
  }
  return settings;
}

[[nodiscard]] std::optional<QString> normalizedDueAt(QString value) {
  value = value.trimmed();
  if (value.isEmpty()) {
    return std::nullopt;
  }
  const QDate date = QDate::fromString(value, Qt::ISODate);
  if (date.isValid()) {
    return QDateTime(date, QTime(0, 0), QTimeZone::UTC).toString(Qt::ISODateWithMs);
  }
  const QDateTime dateTime = QDateTime::fromString(value, Qt::ISODate);
  return dateTime.isValid() ? std::optional<QString>(dateTime.toUTC().toString(Qt::ISODateWithMs))
                            : std::nullopt;
}

[[nodiscard]] QString bulkTaskSummaryMessage(const TaskBulkMutationSummary& summary) {
  return QStringLiteral("%1 selected · %2 eligible · applied %3 · queued %4 · conflicted %5 · "
                        "failed %6 · skipped %7. Remote sync pending.")
      .arg(summary.requested)
      .arg(summary.eligible)
      .arg(summary.applied)
      .arg(summary.queued)
      .arg(summary.conflicted)
      .arg(summary.failed)
      .arg(summary.skipped);
}

[[nodiscard]] QString bulkEventSummaryMessage(const CalendarEventBulkMutationSummary& summary) {
  return QStringLiteral("%1 selected · %2 eligible · applied %3 · queued %4 · conflicted %5 · "
                        "failed %6 · skipped %7. Remote sync pending.")
      .arg(summary.requested)
      .arg(summary.eligible)
      .arg(summary.applied)
      .arg(summary.queued)
      .arg(summary.conflicted)
      .arg(summary.failed)
      .arg(summary.skipped);
}

[[nodiscard]] std::optional<SyncConflictPolicy> conflictPolicyForValue(int value) {
  switch (value) {
  case static_cast<int>(SyncConflictPolicy::PreferGoogle):
    return SyncConflictPolicy::PreferGoogle;
  case static_cast<int>(SyncConflictPolicy::PreferHcb):
    return SyncConflictPolicy::PreferHcb;
  case static_cast<int>(SyncConflictPolicy::AskEachTime):
    return SyncConflictPolicy::AskEachTime;
  default:
    return std::nullopt;
  }
}

[[nodiscard]] bool isValidNotesProjectionMode(int value) {
  return value == kNotesOnlyProjection || value == kMirrorNotesProjection;
}

[[nodiscard]] bool isUndatedTask(const TaskModelTask& task) {
  return !task.due.has_value() || !task.due->at.has_value();
}

[[nodiscard]] QList<TaskModelTask> taskPresentation(const QList<TaskModelTask>& tasks,
                                                    bool notesOnly) {
  if (!notesOnly) {
    return tasks;
  }
  QList<TaskModelTask> visible;
  visible.reserve(tasks.size());
  QSet<QString> visibleIds;
  for (const TaskModelTask& task : tasks) {
    if (!isUndatedTask(task)) {
      visible.append(task);
      visibleIds.insert(task.id);
    }
  }
  for (TaskModelTask& task : visible) {
    if (task.parentTaskId.has_value() && !visibleIds.contains(*task.parentTaskId)) {
      task.parentTaskId.reset();
    }
  }
  return visible;
}

[[nodiscard]] QList<LocalSearchRankedResult>
searchPresentation(QList<LocalSearchRankedResult> results, bool notesEnabled, int notesMode) {
  results.erase(std::remove_if(results.begin(),
                               results.end(),
                               [notesEnabled, notesMode](const LocalSearchRankedResult& result) {
                                 if (result.resource == LocalSearchResource::Note) {
                                   return !notesEnabled;
                                 }
                                 return notesEnabled && notesMode == kNotesOnlyProjection &&
                                        result.resource == LocalSearchResource::Task &&
                                        result.isUndatedTask;
                               }),
                results.end());
  return results;
}

[[nodiscard]] QString conflictResourceText(SyncConflictResource resource) {
  switch (resource) {
  case SyncConflictResource::Task:
    return QStringLiteral("Task");
  case SyncConflictResource::TaskList:
    return QStringLiteral("Task list");
  case SyncConflictResource::Event:
    return QStringLiteral("Calendar event");
  }
  return QStringLiteral("Google resource");
}

[[nodiscard]] QVariantList conflictRows(QList<SyncConflict> conflicts) {
  QVariantList rows;
  rows.reserve(conflicts.size());
  for (const SyncConflict& conflict : conflicts) {
    QVariantMap row;
    row.insert(QStringLiteral("id"), conflict.id);
    row.insert(QStringLiteral("resource"), conflictResourceText(conflict.resource));
    row.insert(QStringLiteral("message"), conflict.errorMessage);
    row.insert(QStringLiteral("canKeepLocal"),
               conflict.remoteEtag.has_value() &&
                   !conflict.remoteSnapshot.value(QStringLiteral("_deleted")).toBool());
    row.insert(QStringLiteral("resolution"),
               !conflict.resolution.has_value() ? QString()
               : *conflict.resolution == SyncConflictResolution::KeepLocal
                   ? QStringLiteral("Kept HCB")
                   : QStringLiteral("Kept Google"));
    row.insert(QStringLiteral("resolvedAt"), conflict.resolvedAt.value_or(QString()));
    rows.append(std::move(row));
  }
  return rows;
}

[[nodiscard]] QVariantList savedSearchRows(const QList<SavedSearch>& searches) {
  QVariantList rows;
  rows.reserve(searches.size());
  for (const SavedSearch& search : searches) {
    rows.append(QVariantMap{{QStringLiteral("id"), search.id},
                            {QStringLiteral("name"), search.name},
                            {QStringLiteral("query"), search.query}});
  }
  return rows;
}

[[nodiscard]] QDate weekStart(const QDate& date, int firstDay) {
  const int firstQtDay = firstDay == 0 ? 7 : 1;
  return date.addDays(-(date.dayOfWeek() - firstQtDay + 7) % 7);
}

[[nodiscard]] QDate monthGridStart(const QDate& date, int firstDayValue) {
  const QDate firstDay(date.year(), date.month(), 1);
  const int firstQtDay = firstDayValue == 0 ? 7 : 1;
  return firstDay.addDays(-(firstDay.dayOfWeek() - firstQtDay + 7) % 7);
}

[[nodiscard]] QString calendarRangeStart(const QDate& date, int firstDay) {
  return QDateTime(monthGridStart(date, firstDay), QTime(0, 0), QTimeZone::UTC)
      .toString(Qt::ISODateWithMs);
}

[[nodiscard]] QString calendarRangeEnd(const QDate& date, int firstDay) {
  return QDateTime(monthGridStart(date, firstDay).addDays(42), QTime(0, 0), QTimeZone::UTC)
      .toString(Qt::ISODateWithMs);
}

struct CalendarViewLayouts final {
  QList<CalendarEventSummary> agendaEvents;
  TimelineModel::Layout timeline;
  MonthGridModel::Layout month;
};

[[nodiscard]] QList<CalendarEventSummary>
calendarPresentation(QList<CalendarEventSummary> events) {
  QList<CalendarEventSummary> presentation;
  for (CalendarEventSummary& event : events) {
    if (event.recurringRemoteId.has_value() && event.originalStartAt.has_value()) {
      if (event.status != QStringLiteral("cancelled")) {
        presentation.append(std::move(event));
      }
    } else if (event.recurrenceRule.has_value()) {
    } else if (event.status != QStringLiteral("cancelled")) {
      presentation.append(std::move(event));
    }
  }
  std::sort(presentation.begin(), presentation.end(),
            [](const CalendarEventSummary& left, const CalendarEventSummary& right) {
              return left.startAt == right.startAt ? left.id < right.id : left.startAt < right.startAt;
            });
  return presentation;
}

[[nodiscard]] CalendarViewLayouts buildCalendarViewLayouts(QDate date,
                                                           QList<CalendarEventSummary> events,
                                                           const QTimeZone& displayTimeZone,
                                                           int firstDay) {
  events = calendarPresentation(std::move(events));
  return {
      .agendaEvents = events,
      .timeline = TimelineModel::buildLayout(
          weekStart(date, firstDay), kCalendarTimelineDays, events, displayTimeZone, kVisibleAllDayLaneCount),
      .month = MonthGridModel::buildLayout(date, events, displayTimeZone, firstDay)};
}

} // namespace

AppController::AppController(FilePath databasePath,
                             Clock& clock,
                             AgendaModel& agendaModel,
                             CalendarSourceModel& calendarSourceModel,
                             MonthGridModel& monthGridModel,
                             NotesModel& notesModel,
                             TaskListModel& taskListModel,
                             TaskModel& taskModel,
                             TimelineModel& timelineModel,
                             QObject* parent)
    : QObject(parent), clock_(clock), agendaModel_(agendaModel),
      calendarSourceModel_(calendarSourceModel), monthGridModel_(monthGridModel),
      notesModel_(notesModel), taskListModel_(taskListModel), taskModel_(taskModel),
      timelineModel_(timelineModel), oauthConfigurationStore_(databasePath, clock),
      accountStatusService_(databasePath, clock), credentialStore_(makeCredentialStore()),
      oauthLoopbackListener_(this), oauthTokenExchangeClient_(this), oauthTokenRefreshClient_(this),
      pkceStateRegistry_(clock), googleHttpClient_(this),
      googleTaskListPullClient_(googleHttpClient_), googleTaskPullClient_(googleHttpClient_),
      googleCalendarListPullClient_(googleHttpClient_),
      googleCalendarManagementClient_(googleHttpClient_),
      googleCalendarFreeBusyClient_(googleHttpClient_),
      googleDriveFilePickerClient_(googleHttpClient_),
      googleCalendarEventPullClient_(googleHttpClient_), googleMirrorStore_(databasePath, clock),
      settingsService_(databasePath, clock), savedSearchStore_(settingsService_),
      optimisticMutationCoordinator_(databasePath, clock),
      syncCheckpointStore_(databasePath, clock), syncConflictStore_(databasePath, clock),
      googleSyncConflictResolver_(
          optimisticMutationCoordinator_, syncConflictStore_, googleHttpClient_),
      taskMutationService_(databasePath, clock), taskBulkMutationService_(taskMutationService_),
      taskListMutationService_(databasePath, clock), calendarMutationService_(databasePath, clock),
      calendarEventBulkMutationService_(calendarMutationService_),
      googleSyncRecoveryService_(syncCheckpointStore_),
      googleTaskMutationPushService_(optimisticMutationCoordinator_,
                                     googleHttpClient_,
                                     clock,
                                     SyncBackoffPolicy(),
                                     &taskMutationService_,
                                     &taskListMutationService_,
                                     &googleSyncConflictResolver_),
      googleCalendarEventMutationPushService_(optimisticMutationCoordinator_,
                                              googleHttpClient_,
                                              clock,
                                              SyncBackoffPolicy(),
                                              &calendarMutationService_,
                                              &googleSyncConflictResolver_),
      taskListReadService_(databasePath), taskReadService_(databasePath),
      calendarReadService_(databasePath),
      googleCalendarInstanceCacheService_(
          googleCalendarEventPullClient_, calendarReadService_, googleMirrorStore_),
      localSearchService_(databasePath),
      googleTaskMirrorSyncService_(googleTaskListPullClient_,
                                   googleTaskPullClient_,
                                   googleMirrorStore_,
                                   syncCheckpointStore_,
                                   clock,
                                   &taskMutationService_),
      googleCalendarMirrorSyncService_(googleCalendarListPullClient_,
                                       googleCalendarEventPullClient_,
                                       calendarReadService_,
                                       googleMirrorStore_,
                                       syncCheckpointStore_,
                                       googleSyncRecoveryService_),
      syncScheduler_([this](const SyncSchedulerRequest& request) { return runGoogleSync(request); },
                     clock) {
  searchResultsModelPointer_ = new SearchResultsModel(this);
  searchDebounce_.setSingleShot(true);
  searchDebounce_.setInterval(kSearchDebounceMilliseconds);
  connect(&searchDebounce_, &QTimer::timeout, this, &AppController::runSearch);
  connect(&oauthLoopbackListener_,
          &OAuthLoopbackCallbackListener::callbackReceived,
          this,
          &AppController::handleOAuthCallback);
}

AppController::~AppController() {
  if (searchCancellation_ != nullptr) {
    static_cast<void>(searchCancellation_->requestStop());
  }
  syncScheduler_.stop();
}

QString AppController::clientId() const { return clientId_; }

bool AppController::googleConnected() const { return googleConnected_; }

QString AppController::statusMessage() const { return statusMessage_; }

QString AppController::taskListErrorMessage() const { return taskListErrorMessage_; }

QString AppController::syncStatus() const { return syncStatus_; }

int AppController::conflictPolicy() const { return conflictPolicy_; }

QVariantList AppController::unresolvedConflicts() const { return unresolvedConflicts_; }

QVariantList AppController::resolvedConflicts() const { return resolvedConflicts_; }

QString AppController::searchQuery() const { return searchQuery_; }

QString AppController::searchErrorMessage() const { return searchErrorMessage_; }

QVariantList AppController::searchFilterChips() const { return searchFilterChips_; }

QVariantList AppController::savedSearches() const { return savedSearchRows_; }

bool AppController::searchLoading() const { return searchLoading_; }

QString AppController::bulkTaskStatusMessage() const { return bulkTaskStatusMessage_; }

QString AppController::bulkEventStatusMessage() const { return bulkEventStatusMessage_; }

QString AppController::bulkTaskPreviewMessage() const { return bulkTaskPreviewMessage_; }

QString AppController::bulkEventPreviewMessage() const { return bulkEventPreviewMessage_; }

int AppController::bulkTaskPreviewRequestToken() const { return bulkTaskPreviewRequestToken_; }

int AppController::bulkEventPreviewRequestToken() const { return bulkEventPreviewRequestToken_; }

int AppController::bulkTextRecurrenceScope() const { return bulkTextRecurrenceScope_; }

QString AppController::calendarDate() const { return calendarDate_.toString(Qt::ISODate); }

int AppController::appearanceMode() const { return appearanceMode_; }

int AppController::visualDensity() const { return visualDensity_; }

int AppController::paletteMode() const { return paletteMode_; }

QString AppController::accentColor() const { return accentColor_; }

QString AppController::fontFamily() const { return fontFamily_; }

QVariantList AppController::availableFontFamilies() const {
  QVariantList families;
  const QStringList installed = installedFontFamilies();
  families.reserve(installed.size());
  for (const QString& family : installed) {
    families.append(family);
  }
  return families;
}

int AppController::fontScale() const { return fontScale_; }

QString AppController::quickCaptureDefaultTaskListId() const { return quickCaptureDefaultTaskListId_; }

QString AppController::quickCaptureDefaultCalendarId() const { return quickCaptureDefaultCalendarId_; }

int AppController::quickCaptureEventDurationMinutes() const {
  return quickCaptureEventDurationMinutes_;
}

bool AppController::quickCaptureRemoveParsedText() const { return quickCaptureRemoveParsedText_; }

QString AppController::quickCaptureTaskAliases() const {
  return quickCaptureAliasesToText(quickCaptureTaskAliases_);
}

QString AppController::quickCaptureEventAliases() const {
  return quickCaptureAliasesToText(quickCaptureEventAliases_);
}

QString AppController::quickCaptureHighPriorityAliases() const {
  return quickCaptureAliasesToText(quickCaptureHighPriorityAliases_);
}

QString AppController::quickCaptureMediumPriorityAliases() const {
  return quickCaptureAliasesToText(quickCaptureMediumPriorityAliases_);
}

QString AppController::quickCaptureLowPriorityAliases() const {
  return quickCaptureAliasesToText(quickCaptureLowPriorityAliases_);
}

int AppController::weekStartDay() const { return weekStartDay_; }

bool AppController::use24HourTime() const { return use24HourTime_; }

QString AppController::displayTimeZone() const { return displayTimeZone_; }

QVariantList AppController::availableTimeZones() const {
  QVariantList zones;
  const QList<QByteArray> identifiers = QTimeZone::availableTimeZoneIds();
  zones.reserve(identifiers.size() + 1);
  zones.append(QString());
  for (const QByteArray& identifier : identifiers) {
    zones.append(QString::fromUtf8(identifier));
  }
  return zones;
}

int AppController::workdayStartHour() const { return workdayStartHour_; }

int AppController::workdayEndHour() const { return workdayEndHour_; }

QVariantList AppController::visibleCalendarIds() const { return visibleCalendarIds_; }

bool AppController::calendarVisibilityConfigured() const { return calendarVisibilityConfigured_; }

QVariantList AppController::calendarManagementRows() const { return calendarManagementRows_; }

QVariantList AppController::importPreviewRows() const { return importPreviewRows_; }

QString AppController::importSourceName() const { return importSourceName_; }

bool AppController::notesEnabled() const { return notesEnabled_; }

int AppController::notesProjectionMode() const { return notesProjectionMode_; }

QVariantList AppController::freeBusyIntervals() const { return freeBusyIntervals_; }

QVariantList AppController::driveAttachmentCandidates() const { return driveAttachmentCandidates_; }

QVariantList AppController::invitations() const { return invitations_; }

int AppController::pendingInvitationCount() const { return static_cast<int>(invitations_.size()); }

QString AppController::reminderStatusMessage() const { return reminderStatusMessage_; }

bool AppController::busy() const { return busy_; }

SearchResultsModel& AppController::searchResultsModel() { return *searchResultsModelPointer_; }

void AppController::initialize() {
  loadSavedSearches();
  watch(settingsService_.readJson(QString::fromLatin1(kSyncSettingsScope),
                                  QString::fromLatin1(kConflictPolicySettingsKey)),
        [this](SettingsJsonReadResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          const std::optional<QString>& stored = std::get<std::optional<QString>>(result);
          if (!stored.has_value()) {
            return;
          }
          bool valid = false;
          const int storedValue = stored->toInt(&valid);
          const std::optional<SyncConflictPolicy> policy =
              valid ? conflictPolicyForValue(storedValue) : std::nullopt;
          if (!policy.has_value()) {
            setStatus(QStringLiteral("Stored sync conflict policy is invalid"));
            return;
          }
          conflictPolicy_ = storedValue;
          googleSyncConflictResolver_.setPolicy(*policy);
          emit conflictPolicyChanged();
        });
  watch(settingsService_.readJson(QString::fromLatin1(kPresentationSettingsScope),
                                  QString::fromLatin1(kNotesEnabledSettingsKey)),
        [this](SettingsJsonReadResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          const std::optional<QString>& stored = std::get<std::optional<QString>>(result);
          if (!stored.has_value()) {
            return;
          }
          const std::optional<bool> enabled =
              *stored == QStringLiteral("true")    ? std::optional<bool>(true)
              : *stored == QStringLiteral("false") ? std::optional<bool>(false)
                                                   : std::nullopt;
          if (!enabled.has_value()) {
            setStatus(QStringLiteral("Stored Notes setting is invalid"));
            return;
          }
          if (notesEnabled_ != *enabled) {
            notesEnabled_ = *enabled;
            applyTaskProjections(taskProjectionTasks_);
            refreshSearchProjection();
            emit notesEnabledChanged();
          }
        });
  watch(settingsService_.readJson(QString::fromLatin1(kPresentationSettingsScope),
                                  QString::fromLatin1(kNotesProjectionSettingsKey)),
        [this](SettingsJsonReadResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          const std::optional<QString>& stored = std::get<std::optional<QString>>(result);
          if (!stored.has_value()) {
            return;
          }
          bool valid = false;
          const int mode = stored->toInt(&valid);
          if (!valid || !isValidNotesProjectionMode(mode)) {
            setStatus(QStringLiteral("Stored Notes projection is invalid"));
            return;
          }
          if (notesProjectionMode_ != mode) {
            notesProjectionMode_ = mode;
            applyTaskProjections(taskProjectionTasks_);
            refreshSearchProjection();
            emit notesProjectionModeChanged();
          }
        });
  const auto loadPresentationInt = [this](const char* key,
                                          auto valid,
                                          auto apply,
                                          QString invalidMessage) {
    watch(settingsService_.readJson(QString::fromLatin1(kPresentationSettingsScope),
                                    QString::fromLatin1(key)),
          [this, valid, apply, invalidMessage = std::move(invalidMessage)](
              SettingsJsonReadResult result) mutable {
            if (std::holds_alternative<AppError>(result)) {
              setStatus(errorMessage(std::get<AppError>(result)));
              return;
            }
            const std::optional<QString>& stored = std::get<std::optional<QString>>(result);
            if (!stored.has_value()) {
              return;
            }
            bool parsed = false;
            const int value = stored->toInt(&parsed);
            if (!parsed || !valid(value)) {
              setStatus(std::move(invalidMessage));
              return;
            }
            apply(value);
          });
  };
  loadPresentationInt(kAppearanceModeSettingsKey,
                      isValidAppearanceMode,
                      [this](int value) {
                        if (appearanceMode_ != value) {
                          appearanceMode_ = value;
                          emit appearanceModeChanged();
                        }
                      },
                      QStringLiteral("Stored appearance mode is invalid"));
  loadPresentationInt(kVisualDensitySettingsKey,
                      isValidVisualDensity,
                      [this](int value) {
                        if (visualDensity_ != value) {
                          visualDensity_ = value;
                          emit visualDensityChanged();
                        }
                      },
                      QStringLiteral("Stored visual density is invalid"));
  loadPresentationInt(kPaletteModeSettingsKey,
                      isValidPaletteMode,
                      [this](int value) {
                        if (paletteMode_ != value) {
                          paletteMode_ = value;
                          emit paletteModeChanged();
                        }
                      },
                      QStringLiteral("Stored palette is invalid"));
  loadPresentationInt(kFontScaleSettingsKey,
                      isValidFontScale,
                      [this](int value) {
                        if (fontScale_ != value) {
                          fontScale_ = value;
                          emit fontScaleChanged();
                        }
                      },
                      QStringLiteral("Stored font scale is invalid"));
  loadPresentationInt(kBulkTextRecurrenceScopeSettingsKey,
                      isValidBulkTextRecurrenceScope,
                      [this](int value) {
                        if (bulkTextRecurrenceScope_ != value) {
                          bulkTextRecurrenceScope_ = value;
                          emit bulkTextRecurrenceScopeChanged();
                        }
                      },
                      QStringLiteral("Stored bulk text recurrence scope is invalid"));
  watch(settingsService_.readJson(QString::fromLatin1(kPresentationSettingsScope),
                                  QString::fromLatin1(kAccentColorSettingsKey)),
        [this](SettingsJsonReadResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          const std::optional<QString>& stored = std::get<std::optional<QString>>(result);
          if (!stored.has_value()) {
            return;
          }
          const std::optional<QString> value = jsonArrayString(*stored);
          if (!value.has_value() || !isValidAccentColor(*value)) {
            setStatus(QStringLiteral("Stored accent color is invalid"));
            return;
          }
          const QString normalized = value->toUpper();
          if (accentColor_ != normalized) {
            accentColor_ = normalized;
            emit accentColorChanged();
          }
        });
  watch(settingsService_.readJson(QString::fromLatin1(kPresentationSettingsScope),
                                  QString::fromLatin1(kFontFamilySettingsKey)),
        [this](SettingsJsonReadResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          const std::optional<QString>& stored = std::get<std::optional<QString>>(result);
          if (!stored.has_value()) {
            return;
          }
          const std::optional<QString> value = jsonArrayString(*stored);
          if (!value.has_value() || (!value->isEmpty() && !installedFontFamilies().contains(*value))) {
            setStatus(QStringLiteral("Stored font family is unavailable"));
            return;
          }
          if (fontFamily_ != *value) {
            fontFamily_ = *value;
            emit fontFamilyChanged();
          }
        });
  const auto loadQuickCaptureString = [this](const char* key, auto valid, auto apply, QString message) {
    watch(settingsService_.readJson(QString::fromLatin1(kPresentationSettingsScope),
                                    QString::fromLatin1(key)),
          [this, valid, apply, message = std::move(message)](SettingsJsonReadResult result) mutable {
            if (std::holds_alternative<AppError>(result)) {
              setStatus(errorMessage(std::get<AppError>(result)));
              return;
            }
            const std::optional<QString>& stored = std::get<std::optional<QString>>(result);
            if (!stored.has_value()) {
              return;
            }
            const std::optional<QString> value = jsonArrayString(*stored);
            if (!value.has_value() || !valid(*value)) {
              setStatus(std::move(message));
              return;
            }
            apply(*value);
          });
  };
  loadQuickCaptureString(kQuickCaptureDefaultTaskListSettingsKey,
                         isValidQuickCaptureDestination,
                         [this](const QString& value) {
                           if (quickCaptureDefaultTaskListId_ != value) {
                             quickCaptureDefaultTaskListId_ = value;
                             emit quickCaptureDefaultTaskListIdChanged();
                           }
                         },
                         QStringLiteral("Stored quick capture task list is invalid"));
  loadQuickCaptureString(kQuickCaptureDefaultCalendarSettingsKey,
                         isValidQuickCaptureDestination,
                         [this](const QString& value) {
                           if (quickCaptureDefaultCalendarId_ != value) {
                             quickCaptureDefaultCalendarId_ = value;
                             emit quickCaptureDefaultCalendarIdChanged();
                           }
                         },
                         QStringLiteral("Stored quick capture calendar is invalid"));
  loadPresentationInt(kQuickCaptureEventDurationSettingsKey,
                      isValidQuickCaptureDuration,
                      [this](int value) {
                        if (quickCaptureEventDurationMinutes_ != value) {
                          quickCaptureEventDurationMinutes_ = value;
                          emit quickCaptureEventDurationMinutesChanged();
                        }
                      },
                      QStringLiteral("Stored quick capture event duration is invalid"));
  watch(settingsService_.readJson(QString::fromLatin1(kPresentationSettingsScope),
                                  QString::fromLatin1(kQuickCaptureRemoveParsedTextSettingsKey)),
        [this](SettingsJsonReadResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          const std::optional<QString>& stored = std::get<std::optional<QString>>(result);
          if (!stored.has_value()) {
            return;
          }
          const std::optional<bool> value = *stored == QStringLiteral("true") ? std::optional<bool>(true)
                                            : *stored == QStringLiteral("false") ? std::optional<bool>(false)
                                                                                     : std::nullopt;
          if (!value.has_value()) {
            setStatus(QStringLiteral("Stored quick capture parsed-text preference is invalid"));
          } else if (quickCaptureRemoveParsedText_ != *value) {
            quickCaptureRemoveParsedText_ = *value;
            emit quickCaptureRemoveParsedTextChanged();
          }
        });
  const auto loadQuickCaptureAliases = [this](const char* key, auto apply, QString message) {
    watch(settingsService_.readJson(QString::fromLatin1(kPresentationSettingsScope),
                                    QString::fromLatin1(key)),
          [this, apply, message = std::move(message)](SettingsJsonReadResult result) mutable {
            if (std::holds_alternative<AppError>(result)) {
              setStatus(errorMessage(std::get<AppError>(result)));
              return;
            }
            const std::optional<QString>& stored = std::get<std::optional<QString>>(result);
            if (!stored.has_value()) {
              return;
            }
            const std::optional<QStringList> values = jsonStringList(*stored);
            if (!values.has_value() ||
                std::any_of(values->cbegin(), values->cend(), [](const QString& value) {
                  return !isValidQuickCaptureAlias(value);
                })) {
              setStatus(std::move(message));
              return;
            }
            apply(*values);
          });
  };
  const auto aliasesChanged = [this](QStringList values, QStringList& destination) {
    if (destination != values) {
      destination = std::move(values);
      emit quickCaptureAliasesChanged();
    }
  };
  loadQuickCaptureAliases(kQuickCaptureTaskAliasesSettingsKey,
                          [this, aliasesChanged](const QStringList& values) mutable {
                            aliasesChanged(values, quickCaptureTaskAliases_);
                          },
                          QStringLiteral("Stored quick capture task aliases are invalid"));
  loadQuickCaptureAliases(kQuickCaptureEventAliasesSettingsKey,
                          [this, aliasesChanged](const QStringList& values) mutable {
                            aliasesChanged(values, quickCaptureEventAliases_);
                          },
                          QStringLiteral("Stored quick capture event aliases are invalid"));
  loadQuickCaptureAliases(kQuickCaptureHighPriorityAliasesSettingsKey,
                          [this, aliasesChanged](const QStringList& values) mutable {
                            aliasesChanged(values, quickCaptureHighPriorityAliases_);
                          },
                          QStringLiteral("Stored quick capture high-priority aliases are invalid"));
  loadQuickCaptureAliases(kQuickCaptureMediumPriorityAliasesSettingsKey,
                          [this, aliasesChanged](const QStringList& values) mutable {
                            aliasesChanged(values, quickCaptureMediumPriorityAliases_);
                          },
                          QStringLiteral("Stored quick capture medium-priority aliases are invalid"));
  loadQuickCaptureAliases(kQuickCaptureLowPriorityAliasesSettingsKey,
                          [this, aliasesChanged](const QStringList& values) mutable {
                            aliasesChanged(values, quickCaptureLowPriorityAliases_);
                          },
                          QStringLiteral("Stored quick capture low-priority aliases are invalid"));
  loadPresentationInt(kWeekStartDaySettingsKey,
                      isValidWeekStartDay,
                      [this](int value) {
                        if (weekStartDay_ != value) {
                          weekStartDay_ = value;
                          emit weekStartDayChanged();
                          refreshCalendar();
                        }
                      },
                      QStringLiteral("Stored week start is invalid"));
  loadPresentationInt(kWorkdayStartHourSettingsKey,
                      [](int value) { return value >= 0 && value <= 23; },
                      [this](int value) {
                        if (isValidWorkdayHours(value, workdayEndHour_) && workdayStartHour_ != value) {
                          workdayStartHour_ = value;
                          emit workdayStartHourChanged();
                        }
                      },
                      QStringLiteral("Stored workday start is invalid"));
  loadPresentationInt(kWorkdayEndHourSettingsKey,
                      [](int value) { return value >= 1 && value <= 24; },
                      [this](int value) {
                        if (isValidWorkdayHours(workdayStartHour_, value) && workdayEndHour_ != value) {
                          workdayEndHour_ = value;
                          emit workdayEndHourChanged();
                        }
                      },
                      QStringLiteral("Stored workday end is invalid"));
  watch(settingsService_.readJson(QString::fromLatin1(kPresentationSettingsScope),
                                  QString::fromLatin1(kUse24HourTimeSettingsKey)),
        [this](SettingsJsonReadResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          const std::optional<QString>& stored = std::get<std::optional<QString>>(result);
          const std::optional<bool> value = !stored.has_value() ? std::optional<bool>{}
              : *stored == QStringLiteral("true") ? std::optional<bool>(true)
              : *stored == QStringLiteral("false") ? std::optional<bool>(false)
                                                 : std::nullopt;
          if (!value.has_value() && stored.has_value()) {
            setStatus(QStringLiteral("Stored time format is invalid"));
          } else if (value.has_value() && use24HourTime_ != *value) {
            use24HourTime_ = *value;
            emit use24HourTimeChanged();
          }
        });
  watch(settingsService_.readJson(QString::fromLatin1(kPresentationSettingsScope),
                                  QString::fromLatin1(kDisplayTimeZoneSettingsKey)),
        [this](SettingsJsonReadResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          const std::optional<QString>& stored = std::get<std::optional<QString>>(result);
          if (!stored.has_value()) {
            return;
          }
          const std::optional<QString> value = jsonArrayString(*stored);
          if (!value.has_value() || !QTimeZone(value->toUtf8()).isValid()) {
            setStatus(QStringLiteral("Stored display time zone is invalid"));
            return;
          }
          if (displayTimeZone_ != *value) {
            displayTimeZone_ = *value;
            emit displayTimeZoneChanged();
            refreshCalendar();
          }
        });
  watch(settingsService_.readJson(QString::fromLatin1(kPresentationSettingsScope),
                                  QString::fromLatin1(kCalendarVisibilitySettingsKey)),
        [this](SettingsJsonReadResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          QVariantList values;
          const std::optional<QString>& stored = std::get<std::optional<QString>>(result);
          if (stored.has_value()) {
            QJsonParseError error;
            const QJsonDocument document = QJsonDocument::fromJson(stored->toUtf8(), &error);
            if (error.error != QJsonParseError::NoError || !document.isArray() ||
                document.array().size() > 20'000) {
              setStatus(QStringLiteral("Stored calendar visibility is invalid"));
              return;
            }
            QSet<QString> seen;
            for (const QJsonValue& item : document.array()) {
              if (!item.isString() || item.toString().isEmpty() || item.toString().size() > 256 ||
                  item.toString() != item.toString().trimmed() || seen.contains(item.toString())) {
                setStatus(QStringLiteral("Stored calendar visibility is invalid"));
                return;
              }
              seen.insert(item.toString());
              values.append(item.toString());
            }
          }
          if (visibleCalendarIds_ != values) {
            visibleCalendarIds_ = std::move(values);
            emit visibleCalendarIdsChanged();
          }
          if (!calendarVisibilityConfigured_) {
            calendarVisibilityConfigured_ = true;
            emit calendarVisibilityConfiguredChanged();
          }
        });
  watch(syncConflictStore_.listUnresolved(), [this](SyncConflictListResult result) {
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(result)));
      return;
    }
    setUnresolvedConflicts(std::get<QList<SyncConflict>>(std::move(result)));
  });
  watch(syncConflictStore_.listResolved(), [this](SyncConflictListResult result) {
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(result)));
      return;
    }
    setResolvedConflicts(std::get<QList<SyncConflict>>(std::move(result)));
  });
  watch(oauthConfigurationStore_.load(), [this](OAuthClientConfigurationReadResult result) {
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(result)));
    } else if (const std::optional<OAuthClientConfiguration>& configuration =
                   std::get<std::optional<OAuthClientConfiguration>>(result);
               configuration.has_value()) {
      clientId_ = configuration->clientId;
      {
        std::lock_guard<std::mutex> lock(syncConfigurationMutex_);
        syncClientId_ = clientId_;
      }
      emit clientIdChanged();
      if (googleConnected_) {
        requestGoogleSync(SyncScheduleTrigger::Startup);
        startPeriodicGoogleSync();
      }
    }
  });
  watch(accountStatusService_.find(QString::fromLatin1(kGoogleAccountId)),
        [this](AccountStatusLookupResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          const std::optional<AccountStatus>& account =
              std::get<std::optional<AccountStatus>>(result);
          if (account.has_value() &&
              account->connectionState == AccountConnectionState::Connected) {
            googleConnected_ = true;
            emit googleConnectedChanged();
            if (!clientId_.isEmpty()) {
              requestGoogleSync(SyncScheduleTrigger::Startup);
              startPeriodicGoogleSync();
            }
          }
        });
  refresh();
}

void AppController::setReminderService(ReminderService* service) {
  if (reminderService_ == service) {
    return;
  }
  if (reminderService_ != nullptr) {
    disconnect(reminderService_, nullptr, this, nullptr);
  }
  reminderService_ = service;
  if (reminderService_ == nullptr) {
    setReminderStatusMessage(QStringLiteral("Calendar reminders are unavailable"));
    return;
  }
  connect(reminderService_, &ReminderService::statusMessageChanged, this, [this] {
    setReminderStatusMessage(reminderService_->statusMessage());
  });
  setReminderStatusMessage(reminderService_->statusMessage());
}

void AppController::refresh() {
  refreshTasks();
  refreshCalendar();
}

void AppController::setCalendarDate(QString date) {
  const QDate parsed = QDate::fromString(date, Qt::ISODate);
  if (!parsed.isValid()) {
    setStatus(QStringLiteral("Calendar date is invalid"));
    return;
  }
  if (calendarDate_ == parsed) {
    return;
  }
  calendarDate_ = parsed;
  emit calendarDateChanged();
  refreshCalendar();
}

void AppController::saveAppearanceMode(int mode) {
  if (!isValidAppearanceMode(mode)) {
    setStatus(QStringLiteral("Appearance mode is invalid"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kAppearanceModeSettingsKey),
                                   QString::number(mode)),
        [this, mode](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (appearanceMode_ != mode) {
            appearanceMode_ = mode;
            emit appearanceModeChanged();
          }
        });
}

void AppController::saveVisualDensity(int density) {
  if (!isValidVisualDensity(density)) {
    setStatus(QStringLiteral("Visual density is invalid"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kVisualDensitySettingsKey),
                                   QString::number(density)),
        [this, density](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (visualDensity_ != density) {
            visualDensity_ = density;
            emit visualDensityChanged();
          }
        });
}

void AppController::savePaletteMode(int mode) {
  if (!isValidPaletteMode(mode)) {
    setStatus(QStringLiteral("Palette is invalid"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kPaletteModeSettingsKey),
                                   QString::number(mode)),
        [this, mode](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (paletteMode_ != mode) {
            paletteMode_ = mode;
            emit paletteModeChanged();
          }
        });
}

void AppController::saveAccentColor(QString color) {
  color = color.trimmed().toUpper();
  if (!isValidAccentColor(color)) {
    setStatus(QStringLiteral("Accent color must be #RRGGBB"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kAccentColorSettingsKey),
                                   jsonStringArray(color)),
        [this, color = std::move(color)](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (accentColor_ != color) {
            accentColor_ = color;
            emit accentColorChanged();
          }
        });
}

void AppController::saveFontFamily(QString family) {
  family = family.trimmed();
  if (!family.isEmpty() && !installedFontFamilies().contains(family)) {
    setStatus(QStringLiteral("Font family is unavailable"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kFontFamilySettingsKey),
                                   jsonStringArray(family)),
        [this, family = std::move(family)](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (fontFamily_ != family) {
            fontFamily_ = family;
            emit fontFamilyChanged();
          }
        });
}

void AppController::saveFontScale(int scale) {
  if (!isValidFontScale(scale)) {
    setStatus(QStringLiteral("Font scale is invalid"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kFontScaleSettingsKey),
                                   QString::number(scale)),
        [this, scale](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (fontScale_ != scale) {
            fontScale_ = scale;
            emit fontScaleChanged();
          }
        });
}

void AppController::saveBulkTextRecurrenceScope(int scope) {
  if (!isValidBulkTextRecurrenceScope(scope)) {
    setStatus(QStringLiteral("Bulk text recurrence scope is invalid"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kBulkTextRecurrenceScopeSettingsKey),
                                   QString::number(scope)),
        [this, scope](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (bulkTextRecurrenceScope_ != scope) {
            bulkTextRecurrenceScope_ = scope;
            emit bulkTextRecurrenceScopeChanged();
          }
        });
}

void AppController::resetVisualPreferences() {
  saveAppearanceMode(0);
  saveVisualDensity(1);
  savePaletteMode(0);
  saveAccentColor({});
  saveFontFamily({});
  saveFontScale(1);
}

QuickCaptureAliases AppController::quickCaptureAliasesConfiguration() const {
  return {.task = quickCaptureTaskAliases_,
          .event = quickCaptureEventAliases_,
          .highPriority = quickCaptureHighPriorityAliases_,
          .mediumPriority = quickCaptureMediumPriorityAliases_,
          .lowPriority = quickCaptureLowPriorityAliases_};
}

QuickCaptureParseResult AppController::quickCaptureParse(QString text,
                                                         int kind,
                                                         QVariantList disabledRecognitionIds) const {
  QStringList disabled;
  disabled.reserve(disabledRecognitionIds.size());
  for (const QVariant& value : disabledRecognitionIds) {
    const QString id = value.toString();
    if (!id.isEmpty() && id.size() <= 128) {
      disabled.append(id);
    }
  }
  const auto milliseconds =
      std::chrono::duration_cast<std::chrono::milliseconds>(clock_.wallNow().time_since_epoch());
  return QuickCaptureParser::parse(
      {.text = std::move(text),
       .kind = isValidQuickCaptureKind(kind) ? static_cast<QuickCaptureKind>(kind)
                                             : QuickCaptureKind::Event,
       .now = QDateTime::fromMSecsSinceEpoch(milliseconds.count(), QTimeZone::UTC),
       .timeZone = resolvedTimeZone(displayTimeZone_),
       .defaultEventDurationMinutes = quickCaptureEventDurationMinutes_,
       .aliases = quickCaptureAliasesConfiguration(),
       .disabledRecognitionIds = std::move(disabled)});
}

QVariantMap AppController::previewQuickCapture(QString text,
                                               int kind,
                                               QVariantList disabledRecognitionIds) const {
  QVariantMap preview;
  if (!isValidQuickCaptureKind(kind)) {
    preview.insert(QStringLiteral("error"), QStringLiteral("Quick capture type is invalid"));
    return preview;
  }
  const QuickCaptureParseResult parsed =
      quickCaptureParse(std::move(text), kind, std::move(disabledRecognitionIds));
  QVariantList recognitions;
  recognitions.reserve(parsed.recognitions.size());
  for (const QuickCaptureRecognition& recognition : parsed.recognitions) {
    recognitions.append(QVariantMap{{QStringLiteral("id"), recognition.id},
                                    {QStringLiteral("label"), recognition.label},
                                    {QStringLiteral("removable"), recognition.removable}});
  }
  preview.insert(QStringLiteral("kind"), static_cast<int>(parsed.kind));
  preview.insert(QStringLiteral("rawTitle"), parsed.rawTitle);
  preview.insert(QStringLiteral("parsedTitle"), parsed.parsedTitle);
  preview.insert(QStringLiteral("savedTitle"),
                 quickCaptureRemoveParsedText_ ? parsed.parsedTitle : parsed.rawTitle);
  preview.insert(QStringLiteral("date"), parsed.date.has_value() ? parsed.date->toString(Qt::ISODate)
                                                                    : QString());
  preview.insert(QStringLiteral("time"), parsed.time.has_value() ? parsed.time->toString(QStringLiteral("HH:mm"))
                                                                    : QString());
  preview.insert(QStringLiteral("allDay"), parsed.allDay);
  preview.insert(QStringLiteral("eventDurationMinutes"), parsed.eventDurationMinutes);
  preview.insert(QStringLiteral("taskPriority"), parsed.taskPriority);
  preview.insert(QStringLiteral("recurrenceEnabled"), parsed.recurrence.enabled);
  preview.insert(QStringLiteral("recurrenceFrequency"), parsed.recurrence.frequency);
  preview.insert(QStringLiteral("recurrenceInterval"), parsed.recurrence.interval);
  preview.insert(QStringLiteral("recurrenceRule"), parsed.recurrence.rrule);
  preview.insert(QStringLiteral("eventReady"), parsed.eventReady);
  preview.insert(QStringLiteral("recognitions"), std::move(recognitions));
  return preview;
}

void AppController::createQuickCapture(QString text,
                                       int kind,
                                       QString destinationId,
                                       QVariantList disabledRecognitionIds) {
  if (!isValidQuickCaptureKind(kind)) {
    setStatus(QStringLiteral("Quick capture type is invalid"));
    return;
  }
  destinationId = destinationId.trimmed();
  if (destinationId.isEmpty()) {
    setStatus(QStringLiteral("Quick capture needs a destination"));
    return;
  }
  const QuickCaptureParseResult parsed =
      quickCaptureParse(std::move(text), kind, std::move(disabledRecognitionIds));
  const QString title = (quickCaptureRemoveParsedText_ ? parsed.parsedTitle : parsed.rawTitle).trimmed();
  if (title.isEmpty()) {
    setStatus(QStringLiteral("Quick capture needs a title after parsing"));
    return;
  }
  if (parsed.kind == QuickCaptureKind::Task) {
    const QVariantList selectedLists = taskListModel_.selectedTaskLists();
    const bool exists = std::any_of(selectedLists.cbegin(), selectedLists.cend(), [&destinationId](const QVariant& row) {
      return row.toMap().value(QStringLiteral("id")).toString() == destinationId;
    });
    if (!exists) {
      setStatus(QStringLiteral("Choose an active Google Task list for Quick Capture"));
      return;
    }
    createTaskDetailed(destinationId,
                       {},
                       title,
                       {},
                       parsed.date.has_value() ? parsed.date->toString(Qt::ISODate) : QString(),
                       displayTimeZone_,
                       parsed.taskPriority,
                       parsed.recurrence.enabled,
                       parsed.recurrence.frequency,
                       parsed.recurrence.interval,
                       0,
                       {},
                       1,
                       parsed.recurrence.rrule,
                       {},
                       {});
    return;
  }

  if (!calendarSourceModel_.calendarIds().contains(destinationId)) {
    setStatus(QStringLiteral("Choose an available Google Calendar for Quick Capture"));
    return;
  }
  if (!parsed.eventReady || !parsed.date.has_value()) {
    setStatus(QStringLiteral("Events need a date or time; switch to Task for an unscheduled item"));
    return;
  }
  const QTimeZone timeZone = resolvedTimeZone(displayTimeZone_);
  const QDateTime start = QDateTime(*parsed.date,
                                    parsed.allDay ? QTime(0, 0) : parsed.time.value_or(QTime(0, 0)),
                                    timeZone);
  const QDateTime end = parsed.allDay ? start.addDays(1)
                                      : start.addSecs(parsed.eventDurationMinutes * 60);
  if (!start.isValid() || !end.isValid() || end <= start) {
    setStatus(QStringLiteral("Quick capture event time is invalid in the selected time zone"));
    return;
  }
  createEventDetailed(destinationId,
                      title,
                      start.toUTC().toString(Qt::ISODateWithMs),
                      end.toUTC().toString(Qt::ISODateWithMs),
                      parsed.allDay,
                      {},
                      {},
                      QString::fromUtf8(timeZone.id()),
                      {},
                      false,
                      QStringLiteral("default"),
                      {},
                      true,
                      {},
                      parsed.recurrence.enabled ? parsed.recurrence.rrule : QString(),
                      false,
                      QStringLiteral("[]"),
                      QStringLiteral("{}"),
                      QStringLiteral("default"),
                      QStringLiteral("{}"),
                      QStringLiteral("all"));
}

void AppController::saveQuickCaptureDefaultTaskListId(QString taskListId) {
  taskListId = taskListId.trimmed();
  if (!isValidQuickCaptureDestination(taskListId)) {
    setStatus(QStringLiteral("Quick capture task list is invalid"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kQuickCaptureDefaultTaskListSettingsKey),
                                   jsonStringArray(taskListId)),
        [this, taskListId = std::move(taskListId)](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (quickCaptureDefaultTaskListId_ != taskListId) {
            quickCaptureDefaultTaskListId_ = taskListId;
            emit quickCaptureDefaultTaskListIdChanged();
          }
        });
}

void AppController::saveQuickCaptureDefaultCalendarId(QString calendarId) {
  calendarId = calendarId.trimmed();
  if (!isValidQuickCaptureDestination(calendarId)) {
    setStatus(QStringLiteral("Quick capture calendar is invalid"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kQuickCaptureDefaultCalendarSettingsKey),
                                   jsonStringArray(calendarId)),
        [this, calendarId = std::move(calendarId)](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (quickCaptureDefaultCalendarId_ != calendarId) {
            quickCaptureDefaultCalendarId_ = calendarId;
            emit quickCaptureDefaultCalendarIdChanged();
          }
        });
}

void AppController::saveQuickCaptureEventDurationMinutes(int minutes) {
  if (!isValidQuickCaptureDuration(minutes)) {
    setStatus(QStringLiteral("Quick capture event duration must be between 1 and 1440 minutes"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kQuickCaptureEventDurationSettingsKey),
                                   QString::number(minutes)),
        [this, minutes](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (quickCaptureEventDurationMinutes_ != minutes) {
            quickCaptureEventDurationMinutes_ = minutes;
            emit quickCaptureEventDurationMinutesChanged();
          }
        });
}

void AppController::saveQuickCaptureRemoveParsedText(bool enabled) {
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kQuickCaptureRemoveParsedTextSettingsKey),
                                   enabled ? QStringLiteral("true") : QStringLiteral("false")),
        [this, enabled](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (quickCaptureRemoveParsedText_ != enabled) {
            quickCaptureRemoveParsedText_ = enabled;
            emit quickCaptureRemoveParsedTextChanged();
          }
        });
}

void AppController::saveQuickCaptureAliases(QString taskAliases,
                                             QString eventAliases,
                                             QString highPriorityAliases,
                                             QString mediumPriorityAliases,
                                             QString lowPriorityAliases) {
  const std::optional<QStringList> task = quickCaptureAliasesFromText(taskAliases);
  const std::optional<QStringList> event = quickCaptureAliasesFromText(eventAliases);
  const std::optional<QStringList> high = quickCaptureAliasesFromText(highPriorityAliases);
  const std::optional<QStringList> medium = quickCaptureAliasesFromText(mediumPriorityAliases);
  const std::optional<QStringList> low = quickCaptureAliasesFromText(lowPriorityAliases);
  if (!task.has_value() || !event.has_value() || !high.has_value() || !medium.has_value() ||
      !low.has_value() || !quickCaptureAliasesAreDistinct(*task, *event, *high, *medium, *low)) {
    setStatus(QStringLiteral("Quick capture aliases must be unique words of up to 32 characters"));
    return;
  }
  const auto save = [this](const char* key, QStringList values, QStringList AppController::*property) {
    watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                     QString::fromLatin1(key),
                                     jsonStringList(values)),
          [this, values = std::move(values), property](SettingsMutationResultOrError result) {
            if (std::holds_alternative<AppError>(result)) {
              setStatus(errorMessage(std::get<AppError>(result)));
            } else if ((this->*property) != values) {
              (this->*property) = values;
              emit quickCaptureAliasesChanged();
            }
          });
  };
  save(kQuickCaptureTaskAliasesSettingsKey, *task, &AppController::quickCaptureTaskAliases_);
  save(kQuickCaptureEventAliasesSettingsKey, *event, &AppController::quickCaptureEventAliases_);
  save(kQuickCaptureHighPriorityAliasesSettingsKey, *high, &AppController::quickCaptureHighPriorityAliases_);
  save(kQuickCaptureMediumPriorityAliasesSettingsKey, *medium, &AppController::quickCaptureMediumPriorityAliases_);
  save(kQuickCaptureLowPriorityAliasesSettingsKey, *low, &AppController::quickCaptureLowPriorityAliases_);
}

void AppController::saveWeekStartDay(int day) {
  if (!isValidWeekStartDay(day)) {
    setStatus(QStringLiteral("Week start is invalid"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kWeekStartDaySettingsKey),
                                   QString::number(day)),
        [this, day](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (weekStartDay_ != day) {
            weekStartDay_ = day;
            emit weekStartDayChanged();
            refreshCalendar();
          }
        });
}

void AppController::saveUse24HourTime(bool enabled) {
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kUse24HourTimeSettingsKey),
                                   enabled ? QStringLiteral("true") : QStringLiteral("false")),
        [this, enabled](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (use24HourTime_ != enabled) {
            use24HourTime_ = enabled;
            emit use24HourTimeChanged();
          }
        });
}

void AppController::saveDisplayTimeZone(QString timeZone) {
  timeZone = timeZone.trimmed();
  if (!QTimeZone(timeZone.toUtf8()).isValid()) {
    setStatus(QStringLiteral("Display time zone is invalid"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kDisplayTimeZoneSettingsKey),
                                   jsonStringArray(timeZone)),
        [this, timeZone = std::move(timeZone)](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (displayTimeZone_ != timeZone) {
            displayTimeZone_ = timeZone;
            emit displayTimeZoneChanged();
            refreshCalendar();
          }
        });
}

QVariantMap AppController::dateTimeComponents(QString value, QString timeZone) const {
  const QDateTime parsed = QDateTime::fromString(value, Qt::ISODate);
  if (!parsed.isValid()) {
    return {};
  }
  const QDateTime local = parsed.toTimeZone(resolvedTimeZone(timeZone));
  return {{QStringLiteral("year"), local.date().year()},
          {QStringLiteral("month"), local.date().month()},
          {QStringLiteral("day"), local.date().day()},
          {QStringLiteral("hour"), local.time().hour()},
          {QStringLiteral("minute"), local.time().minute()}};
}

QString AppController::dateTimeFromComponents(int year,
                                              int month,
                                              int day,
                                              int hour,
                                              int minute,
                                              QString timeZone) const {
  const QDate date(year, month, day);
  const QTime time(hour, minute);
  const QDateTime local(date, time, resolvedTimeZone(timeZone));
  return local.isValid() ? local.toUTC().toString(Qt::ISODateWithMs) : QString();
}

void AppController::saveWorkdayHours(int startHour, int endHour) {
  if (!isValidWorkdayHours(startHour, endHour)) {
    setStatus(QStringLiteral("Workday hours are invalid"));
    return;
  }
  const QString start = QString::number(startHour);
  const QString end = QString::number(endHour);
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kWorkdayStartHourSettingsKey), start),
        [this, startHour](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (workdayStartHour_ != startHour) {
            workdayStartHour_ = startHour;
            emit workdayStartHourChanged();
          }
        });
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kWorkdayEndHourSettingsKey), end),
        [this, endHour](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else if (workdayEndHour_ != endHour) {
            workdayEndHour_ = endHour;
            emit workdayEndHourChanged();
          }
        });
}

void AppController::saveCalendarVisibility(QVariantList calendarIds) {
  if (calendarIds.size() > 20'000) {
    setStatus(QStringLiteral("Calendar visibility is invalid"));
    return;
  }
  QJsonArray stored;
  QVariantList values;
  QSet<QString> seen;
  for (const QVariant& value : calendarIds) {
    if (!value.canConvert<QString>()) {
      setStatus(QStringLiteral("Calendar visibility is invalid"));
      return;
    }
    const QString id = value.toString();
    if (id.isEmpty() || id.size() > 256 || id != id.trimmed() || id.contains(QChar::Null) ||
        seen.contains(id)) {
      setStatus(QStringLiteral("Calendar visibility is invalid"));
      return;
    }
    seen.insert(id);
    stored.append(id);
    values.append(id);
  }
  const QString json = QString::fromUtf8(QJsonDocument(stored).toJson(QJsonDocument::Compact));
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kCalendarVisibilitySettingsKey), json),
        [this, values = std::move(values)](SettingsMutationResultOrError result) mutable {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          if (visibleCalendarIds_ != values) {
            visibleCalendarIds_ = std::move(values);
            emit visibleCalendarIdsChanged();
          }
          if (!calendarVisibilityConfigured_) {
            calendarVisibilityConfigured_ = true;
            emit calendarVisibilityConfiguredChanged();
          }
        });
}

void AppController::createGoogleCalendar(QString title, QString description, QString timeZone) {
  if (!googleConnected_ || credentialStore_ == nullptr) {
    setStatus(QStringLiteral("Connect Google before creating a calendar"));
    return;
  }
  const GoogleCalendarCreateRequest request{
      .title = std::move(title),
      .description = description.trimmed().isEmpty() ? std::optional<QString>{}
                                                  : std::optional<QString>(std::move(description)),
      .timeZone = timeZone.trimmed().isEmpty() ? std::optional<QString>{}
                                              : std::optional<QString>(std::move(timeZone))};
  watch(std::async(std::launch::async,
                   [this, request]() -> std::variant<GoogleCalendarManagementResult, AppError> {
                     OAuthCredentialReadResult read =
                         credentialStore_->read(QString::fromLatin1(kGoogleAccountId)).get();
                     if (std::holds_alternative<AppError>(read)) {
                       return std::get<AppError>(std::move(read));
                     }
                     const std::optional<OAuthStoredCredential>& credential =
                         std::get<std::optional<OAuthStoredCredential>>(read);
                     if (!credential.has_value() || credential->accessToken.isEmpty()) {
                       return AppError(AppErrorCode::Configuration,
                                       QStringLiteral("Google authorization must be renewed"));
                     }
                     GoogleCalendarManagementResultOrError created =
                         googleCalendarManagementClient_.create(request, credential->accessToken).get();
                     return std::holds_alternative<GoogleApiError>(created)
                                ? std::variant<GoogleCalendarManagementResult, AppError>(AppError(
                                      AppErrorCode::Network,
                                      std::get<GoogleApiError>(std::move(created)).message()))
                                : std::variant<GoogleCalendarManagementResult, AppError>(
                                      std::get<GoogleCalendarManagementResult>(std::move(created)));
                   }),
        [this](std::variant<GoogleCalendarManagementResult, AppError> result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(std::move(result))));
            return;
          }
          setStatus(QStringLiteral("Google calendar created"));
          requestGoogleSync(SyncScheduleTrigger::Manual);
        });
}

void AppController::subscribeGoogleCalendar(QString calendarId) {
  if (!googleConnected_ || credentialStore_ == nullptr) {
    setStatus(QStringLiteral("Connect Google before subscribing to a calendar"));
    return;
  }
  const GoogleCalendarSubscribeRequest request{.calendarId = std::move(calendarId)};
  watch(std::async(std::launch::async,
                   [this, request]() -> std::variant<GoogleCalendarManagementResult, AppError> {
                     OAuthCredentialReadResult read =
                         credentialStore_->read(QString::fromLatin1(kGoogleAccountId)).get();
                     if (std::holds_alternative<AppError>(read)) {
                       return std::get<AppError>(std::move(read));
                     }
                     const std::optional<OAuthStoredCredential>& credential =
                         std::get<std::optional<OAuthStoredCredential>>(read);
                     if (!credential.has_value() || credential->accessToken.isEmpty()) {
                       return AppError(AppErrorCode::Configuration,
                                       QStringLiteral("Google authorization must be renewed"));
                     }
                     GoogleCalendarManagementResultOrError subscribed =
                         googleCalendarManagementClient_.subscribe(request, credential->accessToken).get();
                     return std::holds_alternative<GoogleApiError>(subscribed)
                                ? std::variant<GoogleCalendarManagementResult, AppError>(AppError(
                                      AppErrorCode::Network,
                                      std::get<GoogleApiError>(std::move(subscribed)).message()))
                                : std::variant<GoogleCalendarManagementResult, AppError>(
                                      std::get<GoogleCalendarManagementResult>(std::move(subscribed)));
                   }),
        [this](std::variant<GoogleCalendarManagementResult, AppError> result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(std::move(result))));
            return;
          }
          setStatus(QStringLiteral("Google calendar subscribed"));
          requestGoogleSync(SyncScheduleTrigger::Manual);
        });
}

void AppController::updateGoogleCalendar(QString calendarId,
                                         QString title,
                                         QString description,
                                         QString timeZone) {
  if (!googleConnected_ || credentialStore_ == nullptr) {
    setStatus(QStringLiteral("Connect Google before editing a calendar"));
    return;
  }
  watch(calendarReadService_.findCalendar(std::move(calendarId)),
        [this,
         title = std::move(title),
         description = std::move(description),
         timeZone = std::move(timeZone)](CalendarLookupResult result) mutable {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(std::move(result))));
            return;
          }
          const std::optional<CalendarSummary>& calendar =
              std::get<std::optional<CalendarSummary>>(result);
          if (!calendar.has_value() || calendar->primary ||
              calendar->accessRole.value_or(QString()) != QStringLiteral("owner")) {
            setStatus(QStringLiteral("Only owned secondary calendars can be edited"));
            return;
          }
          const GoogleCalendarUpdateRequest request{
              .calendarId = calendar->remoteId,
              .title = std::move(title),
              .description = std::optional<QString>(std::move(description)),
              .timeZone = timeZone.trimmed().isEmpty() ? std::optional<QString>{}
                                                        : std::optional<QString>(std::move(timeZone))};
          watch(std::async(std::launch::async,
                           [this, request]()
                               -> std::variant<GoogleCalendarManagementResult, AppError> {
                             OAuthCredentialReadResult read =
                                 credentialStore_->read(QString::fromLatin1(kGoogleAccountId)).get();
                             if (std::holds_alternative<AppError>(read)) {
                               return std::get<AppError>(std::move(read));
                             }
                             const std::optional<OAuthStoredCredential>& credential =
                                 std::get<std::optional<OAuthStoredCredential>>(read);
                             if (!credential.has_value() || credential->accessToken.isEmpty()) {
                               return AppError(AppErrorCode::Configuration,
                                               QStringLiteral("Google authorization must be renewed"));
                             }
                             GoogleCalendarManagementResultOrError updated =
                                 googleCalendarManagementClient_.update(request, credential->accessToken).get();
                             return std::holds_alternative<GoogleApiError>(updated)
                                        ? std::variant<GoogleCalendarManagementResult, AppError>(AppError(
                                              AppErrorCode::Network,
                                              std::get<GoogleApiError>(std::move(updated)).message()))
                                        : std::variant<GoogleCalendarManagementResult, AppError>(
                                              std::get<GoogleCalendarManagementResult>(std::move(updated)));
                           }),
                [this](std::variant<GoogleCalendarManagementResult, AppError> updated) {
                  if (std::holds_alternative<AppError>(updated)) {
                    setStatus(errorMessage(std::get<AppError>(std::move(updated))));
                    return;
                  }
                  setStatus(QStringLiteral("Google calendar updated"));
                  requestGoogleSync(SyncScheduleTrigger::Manual);
                });
        });
}

void AppController::deleteGoogleCalendar(QString calendarId) {
  if (!googleConnected_ || credentialStore_ == nullptr) {
    setStatus(QStringLiteral("Connect Google before deleting a calendar"));
    return;
  }
  watch(calendarReadService_.findCalendar(std::move(calendarId)),
        [this](CalendarLookupResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(std::move(result))));
            return;
          }
          const std::optional<CalendarSummary>& calendar =
              std::get<std::optional<CalendarSummary>>(result);
          if (!calendar.has_value() || calendar->primary ||
              calendar->accessRole.value_or(QString()) != QStringLiteral("owner")) {
            setStatus(QStringLiteral("Only owned secondary calendars can be deleted"));
            return;
          }
          const QString remoteId = calendar->remoteId;
          watch(std::async(std::launch::async,
                           [this, remoteId]()
                               -> std::variant<GoogleCalendarManagementResult, AppError> {
                             OAuthCredentialReadResult read =
                                 credentialStore_->read(QString::fromLatin1(kGoogleAccountId)).get();
                             if (std::holds_alternative<AppError>(read)) {
                               return std::get<AppError>(std::move(read));
                             }
                             const std::optional<OAuthStoredCredential>& credential =
                                 std::get<std::optional<OAuthStoredCredential>>(read);
                             if (!credential.has_value() || credential->accessToken.isEmpty()) {
                               return AppError(AppErrorCode::Configuration,
                                               QStringLiteral("Google authorization must be renewed"));
                             }
                             GoogleCalendarManagementResultOrError removed =
                                 googleCalendarManagementClient_.remove(remoteId, credential->accessToken).get();
                             return std::holds_alternative<GoogleApiError>(removed)
                                        ? std::variant<GoogleCalendarManagementResult, AppError>(AppError(
                                              AppErrorCode::Network,
                                              std::get<GoogleApiError>(std::move(removed)).message()))
                                        : std::variant<GoogleCalendarManagementResult, AppError>(
                                              std::get<GoogleCalendarManagementResult>(std::move(removed)));
                           }),
                [this](std::variant<GoogleCalendarManagementResult, AppError> removed) {
                  if (std::holds_alternative<AppError>(removed)) {
                    setStatus(errorMessage(std::get<AppError>(std::move(removed))));
                    return;
                  }
                  setStatus(QStringLiteral("Google calendar deleted"));
                  requestGoogleSync(SyncScheduleTrigger::Manual);
                });
        });
}

void AppController::updateGoogleCalendarListEntry(QString calendarId,
                                                   bool selected,
                                                   bool hidden,
                                                   QString colorId) {
  if (!googleConnected_ || credentialStore_ == nullptr) {
    setStatus(QStringLiteral("Connect Google before editing calendar preferences"));
    return;
  }
  watch(calendarReadService_.findCalendar(std::move(calendarId)),
        [this, selected, hidden, colorId = std::move(colorId)](CalendarLookupResult result) mutable {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(std::move(result))));
            return;
          }
          const std::optional<CalendarSummary>& calendar =
              std::get<std::optional<CalendarSummary>>(result);
          if (!calendar.has_value()) {
            setStatus(QStringLiteral("Calendar is unavailable"));
            return;
          }
          const GoogleCalendarListUpdateRequest request{
              .calendarId = calendar->remoteId,
              .selected = selected,
              .hidden = hidden,
              .colorId = colorId.trimmed().isEmpty() ? std::optional<QString>{}
                                                       : std::optional<QString>(std::move(colorId))};
          watch(std::async(std::launch::async,
                           [this, request]()
                               -> std::variant<GoogleCalendarManagementResult, AppError> {
                             OAuthCredentialReadResult read =
                                 credentialStore_->read(QString::fromLatin1(kGoogleAccountId)).get();
                             if (std::holds_alternative<AppError>(read)) {
                               return std::get<AppError>(std::move(read));
                             }
                             const std::optional<OAuthStoredCredential>& credential =
                                 std::get<std::optional<OAuthStoredCredential>>(read);
                             if (!credential.has_value() || credential->accessToken.isEmpty()) {
                               return AppError(AppErrorCode::Configuration,
                                               QStringLiteral("Google authorization must be renewed"));
                             }
                             GoogleCalendarManagementResultOrError updated =
                                 googleCalendarManagementClient_.updateListEntry(request,
                                                                                  credential->accessToken).get();
                             return std::holds_alternative<GoogleApiError>(updated)
                                        ? std::variant<GoogleCalendarManagementResult, AppError>(AppError(
                                              AppErrorCode::Network,
                                              std::get<GoogleApiError>(std::move(updated)).message()))
                                        : std::variant<GoogleCalendarManagementResult, AppError>(
                                              std::get<GoogleCalendarManagementResult>(std::move(updated)));
                           }),
                [this](std::variant<GoogleCalendarManagementResult, AppError> updated) {
                  if (std::holds_alternative<AppError>(updated)) {
                    setStatus(errorMessage(std::get<AppError>(std::move(updated))));
                    return;
                  }
                  setStatus(QStringLiteral("Google calendar preferences updated"));
                  requestGoogleSync(SyncScheduleTrigger::Manual);
                });
        });
}

void AppController::unsubscribeGoogleCalendar(QString calendarId) {
  if (!googleConnected_ || credentialStore_ == nullptr) {
    setStatus(QStringLiteral("Connect Google before unsubscribing from a calendar"));
    return;
  }
  watch(calendarReadService_.findCalendar(std::move(calendarId)),
        [this](CalendarLookupResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(std::move(result))));
            return;
          }
          const std::optional<CalendarSummary>& calendar =
              std::get<std::optional<CalendarSummary>>(result);
          if (!calendar.has_value() || calendar->primary) {
            setStatus(QStringLiteral("The primary calendar cannot be unsubscribed"));
            return;
          }
          const QString remoteId = calendar->remoteId;
          watch(std::async(std::launch::async,
                           [this, remoteId]()
                               -> std::variant<GoogleCalendarManagementResult, AppError> {
                             OAuthCredentialReadResult read =
                                 credentialStore_->read(QString::fromLatin1(kGoogleAccountId)).get();
                             if (std::holds_alternative<AppError>(read)) {
                               return std::get<AppError>(std::move(read));
                             }
                             const std::optional<OAuthStoredCredential>& credential =
                                 std::get<std::optional<OAuthStoredCredential>>(read);
                             if (!credential.has_value() || credential->accessToken.isEmpty()) {
                               return AppError(AppErrorCode::Configuration,
                                               QStringLiteral("Google authorization must be renewed"));
                             }
                             GoogleCalendarManagementResultOrError removed =
                                 googleCalendarManagementClient_.removeListEntry(remoteId,
                                                                                  credential->accessToken).get();
                             return std::holds_alternative<GoogleApiError>(removed)
                                        ? std::variant<GoogleCalendarManagementResult, AppError>(AppError(
                                              AppErrorCode::Network,
                                              std::get<GoogleApiError>(std::move(removed)).message()))
                                        : std::variant<GoogleCalendarManagementResult, AppError>(
                                              std::get<GoogleCalendarManagementResult>(std::move(removed)));
                           }),
                [this](std::variant<GoogleCalendarManagementResult, AppError> removed) {
                  if (std::holds_alternative<AppError>(removed)) {
                    setStatus(errorMessage(std::get<AppError>(std::move(removed))));
                    return;
                  }
                  setStatus(QStringLiteral("Google calendar unsubscribed"));
                  requestGoogleSync(SyncScheduleTrigger::Manual);
                });
        });
}

void AppController::chooseImportFile() {
  const QString path = QFileDialog::getOpenFileName(
      nullptr,
      QStringLiteral("Import Tasks and events"),
      {},
      QStringLiteral("HCB delimited import (*.hcb *.hcbimport *.txt);;CSV (*.csv);;All files (*)"));
  if (path.isEmpty()) {
    return;
  }
  QFile file(path);
  if (!file.open(QIODevice::ReadOnly)) {
    setStatus(QStringLiteral("Import file could not be read"));
    return;
  }
  const ImportParseResult parsed =
      ImportService::parse(ImportService::detectFormat(path), file.readAll());
  importItems_ = parsed.items;
  setImportPreviewRows(importPreviewRowVariants(parsed));
  setImportSourceName(QFileInfo(path).fileName());
  const qsizetype accepted = static_cast<qsizetype>(parsed.items.size());
  const qsizetype skipped = parsed.rows.size() - accepted;
  setStatus(QStringLiteral("Import preview: %1 ready, %2 skipped").arg(accepted).arg(skipped));
}

void AppController::runImport(QString defaultTaskListId, QString defaultCalendarId) {
  if (importItems_.isEmpty()) {
    setStatus(QStringLiteral("Choose an import file with at least one valid row"));
    return;
  }
  loadImportTaskLists(std::move(defaultTaskListId), std::move(defaultCalendarId), 0, {});
}

void AppController::loadImportTaskLists(QString defaultTaskListId,
                                        QString defaultCalendarId,
                                        std::int64_t offset,
                                        QList<TaskListSummary> taskLists) {
  watch(taskListReadService_.list({.limit = 100, .offset = offset}),
        [this,
         defaultTaskListId = std::move(defaultTaskListId),
         defaultCalendarId = std::move(defaultCalendarId),
         taskLists = std::move(taskLists)](TaskListPageResult result) mutable {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(std::move(result))));
            return;
          }
          TaskListPage page = std::get<TaskListPage>(std::move(result));
          taskLists.append(std::move(page.items));
          if (page.nextOffset.has_value()) {
            loadImportTaskLists(std::move(defaultTaskListId),
                                std::move(defaultCalendarId),
                                *page.nextOffset,
                                std::move(taskLists));
            return;
          }
          loadImportCalendars(std::move(defaultTaskListId),
                              std::move(defaultCalendarId),
                              0,
                              std::move(taskLists),
                              {});
        });
}

void AppController::loadImportCalendars(QString defaultTaskListId,
                                        QString defaultCalendarId,
                                        std::int64_t offset,
                                        QList<TaskListSummary> taskLists,
                                        QList<CalendarSummary> calendars) {
  watch(calendarReadService_.listCalendars(
            {.includeHidden = true, .limit = 100, .offset = offset}),
        [this,
         defaultTaskListId = std::move(defaultTaskListId),
         defaultCalendarId = std::move(defaultCalendarId),
         taskLists = std::move(taskLists),
         calendars = std::move(calendars)](CalendarListPageResult result) mutable {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(std::move(result))));
            return;
          }
          CalendarListPage page = std::get<CalendarListPage>(std::move(result));
          calendars.append(std::move(page.items));
          if (page.nextOffset.has_value()) {
            loadImportCalendars(std::move(defaultTaskListId),
                                std::move(defaultCalendarId),
                                *page.nextOffset,
                                std::move(taskLists),
                                std::move(calendars));
            return;
          }
          executeImport(defaultTaskListId, defaultCalendarId, taskLists, calendars);
        });
}

void AppController::executeImport(QString defaultTaskListId,
                                  QString defaultCalendarId,
                                  const QList<TaskListSummary>& taskLists,
                                  const QList<CalendarSummary>& calendars) {
  QVariantList rows = importPreviewRows_;
  const auto reject = [&rows](const ImportItem& item, QString message) {
    for (QVariant& value : rows) {
      QVariantMap row = value.toMap();
      if (row.value(QStringLiteral("line")).toInt() != item.sourceLine) {
        continue;
      }
      row.insert(QStringLiteral("accepted"), false);
      row.insert(QStringLiteral("message"), std::move(message));
      value = std::move(row);
      return;
    }
  };
  QList<TaskCreateInput> tasks;
  QList<CalendarEventCreateInput> events;
  tasks.reserve(importItems_.size());
  events.reserve(importItems_.size());
  for (const ImportItem& item : importItems_) {
    if (item.kind == ImportItemKind::Task) {
      const std::optional<QString> taskListId =
          resolveImportTarget(item.taskList, defaultTaskListId, taskLists);
      if (!taskListId.has_value()) {
        reject(item, QStringLiteral("task list is missing or ambiguous"));
        continue;
      }
      const std::optional<TaskPriority> priority = importPriority(item.taskPriority);
      const std::optional<QString> due = item.taskDue.has_value()
                                             ? normalizedDueAt(*item.taskDue)
                                             : std::optional<QString>{};
      if (!priority.has_value() || (item.taskDue.has_value() && !due.has_value())) {
        reject(item, QStringLiteral("task due date or priority is invalid"));
        continue;
      }
      TaskCreateInput input{.taskListId = *taskListId,
                            .title = item.title,
                            .notes = item.taskNotes,
                            .due = due.has_value()
                                       ? std::optional<TaskDue>(TaskDue{.at = due})
                                       : std::optional<TaskDue>{},
                            .priority = *priority};
      if (item.taskRecurrenceRule.has_value()) {
        const std::optional<TaskRecurrenceRuleInfo> rule =
            parseTaskRecurrenceRule(*item.taskRecurrenceRule);
        const std::optional<QList<QString>> excluded = importRecurrenceDates(item.taskExclusionDates);
        const std::optional<QList<QString>> added = importRecurrenceDates(item.taskAdditionDates);
        const QDate anchor = due.has_value() ? QDateTime::fromString(*due, Qt::ISODate).date() : QDate();
        if (!rule.has_value() || !excluded.has_value() || !added.has_value() || !anchor.isValid()) {
          reject(item, QStringLiteral("task recurrence requires a valid due date and supported rule"));
          continue;
        }
        TaskRecurrenceEndCondition end;
        if (item.taskRecurrenceUntil.has_value()) {
          const QDate until = QDate::fromString(*item.taskRecurrenceUntil, Qt::ISODate);
          if (!until.isValid()) {
            reject(item, QStringLiteral("task recurrence until date is invalid"));
            continue;
          }
          end = {.kind = TaskRecurrenceEndKind::Until,
                 .untilDate = until.toString(Qt::ISODate)};
        } else if (item.taskRecurrenceCount.has_value()) {
          end = {.kind = TaskRecurrenceEndKind::Count,
                 .count = static_cast<std::int32_t>(*item.taskRecurrenceCount)};
        }
        const QString timeZone = QString::fromUtf8(QTimeZone::systemTimeZoneId());
        const QString seriesId = QUuid::createUuid().toString(QUuid::WithoutBraces);
        TaskRecurrenceMarker marker{.seriesId = seriesId,
                                    .occurrenceId = seriesId + QStringLiteral(":0"),
                                    .frequency = rule->frequency,
                                    .interval = rule->interval,
                                    .anchorDate = anchor.toString(Qt::ISODate),
                                    .timeZone = timeZone,
                                    .end = std::move(end),
                                    .recurrenceRule = *item.taskRecurrenceRule,
                                    .exclusionDates = *excluded,
                                    .additionDates = *added,
                                    .templateTitle = input.title,
                                    .templateDueDate = anchor.toString(Qt::ISODate),
                                    .templatePriority = priorityText(*priority)};
        const TaskRecurrenceSerializationResult serialized =
            serializeTaskRecurrenceNotes(input.notes.value_or(QString()), marker);
        if (serialized.error.has_value()) {
          reject(item, *serialized.error);
          continue;
        }
        input.notes = serialized.notes;
        input.due = TaskDue{.at = due, .timeZone = timeZone};
      }
      tasks.append(std::move(input));
      continue;
    }
    const std::optional<QString> calendarId =
        resolveImportTarget(item.calendar, defaultCalendarId, calendars);
    const auto calendar = calendarId.has_value()
                              ? std::find_if(calendars.cbegin(), calendars.cend(), [&calendarId](const CalendarSummary& value) {
                                  return value.id == *calendarId;
                                })
                              : calendars.cend();
    if (!calendarId.has_value() || calendar == calendars.cend() ||
        (calendar->accessRole.has_value() && calendar->accessRole != QStringLiteral("writer") &&
         calendar->accessRole != QStringLiteral("owner"))) {
      reject(item, QStringLiteral("calendar is missing, ambiguous, or read-only"));
      continue;
    }
    events.append({.calendarId = *calendarId,
                   .title = item.title,
                   .startAt = item.eventStart,
                   .endAt = item.eventEnd,
                   .allDay = item.eventAllDay,
                   .description = item.eventDescription,
                   .location = item.eventLocation,
                   .startTimeZone = item.eventTimeZone,
                   .endTimeZone = item.eventTimeZone,
                   .recurrenceRule = item.eventRecurrence});
  }
  setImportPreviewRows(std::move(rows));
  if (tasks.isEmpty() && events.isEmpty()) {
    setStatus(QStringLiteral("No import rows are eligible after destination validation"));
    return;
  }
  const auto completeEvents = [this](CalendarEventBatchMutationResult result) {
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(std::move(result))));
      return;
    }
    const qsizetype eventCount = std::get<QList<CalendarEventMutationReceipt>>(result).size();
    refreshTasks();
    refreshCalendar();
    setStatus(QStringLiteral("Imported %1 calendar event(s); remote sync is queued").arg(eventCount));
  };
  if (tasks.isEmpty()) {
    watch(calendarMutationService_.createBatch(std::move(events)), completeEvents);
    return;
  }
  watch(taskMutationService_.createBatch(std::move(tasks)),
        [this, events = std::move(events)](TaskBatchMutationResult result) mutable {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(std::move(result))));
            return;
          }
          const qsizetype taskCount = std::get<QList<TaskMutationReceipt>>(result).size();
          if (events.isEmpty()) {
            refreshTasks();
            setStatus(QStringLiteral("Imported %1 task(s); remote sync is queued").arg(taskCount));
            return;
          }
          watch(calendarMutationService_.createBatch(std::move(events)),
                [this, taskCount](CalendarEventBatchMutationResult eventResult) {
                  if (std::holds_alternative<AppError>(eventResult)) {
                    setStatus(QStringLiteral("Imported %1 task(s), but calendar events failed: %2")
                                  .arg(taskCount)
                                  .arg(errorMessage(std::get<AppError>(std::move(eventResult)))));
                    refreshTasks();
                    return;
                  }
                  const qsizetype eventCount =
                      std::get<QList<CalendarEventMutationReceipt>>(eventResult).size();
                  refreshTasks();
                  refreshCalendar();
                  setStatus(QStringLiteral("Imported %1 task(s) and %2 calendar event(s); remote sync is queued")
                                .arg(taskCount)
                                .arg(eventCount));
                });
        });
}

void AppController::queryGoogleFreeBusy(QVariantList calendarIds, QString startAt, QString endAt) {
  if (!googleConnected_ || credentialStore_ == nullptr) {
    setStatus(QStringLiteral("Connect Google before checking availability"));
    return;
  }
  QList<QString> ids;
  ids.reserve(calendarIds.size());
  for (const QVariant& value : calendarIds) {
    if (!value.canConvert<QString>()) {
      setStatus(QStringLiteral("Free-busy calendars are invalid"));
      return;
    }
    ids.append(value.toString());
  }
  watch(std::async(std::launch::async,
                   [this, ids = std::move(ids), startAt = std::move(startAt), endAt = std::move(endAt)]
                       () -> std::variant<QVariantList, AppError> {
                     QList<QString> remoteIds;
                     remoteIds.reserve(ids.size());
                     for (const QString& id : ids) {
                       CalendarLookupResult lookup = calendarReadService_.findCalendar(id).get();
                       if (std::holds_alternative<AppError>(lookup)) {
                         return std::get<AppError>(std::move(lookup));
                       }
                       const std::optional<CalendarSummary>& calendar =
                           std::get<std::optional<CalendarSummary>>(lookup);
                       if (!calendar.has_value() || calendar->remoteId.isEmpty()) {
                         return AppError(AppErrorCode::Validation,
                                         QStringLiteral("Free-busy calendar is unavailable"));
                       }
                       remoteIds.append(calendar->remoteId);
                     }
                     OAuthCredentialReadResult read =
                         credentialStore_->read(QString::fromLatin1(kGoogleAccountId)).get();
                     if (std::holds_alternative<AppError>(read)) {
                       return std::get<AppError>(std::move(read));
                     }
                     const std::optional<OAuthStoredCredential>& credential =
                         std::get<std::optional<OAuthStoredCredential>>(read);
                     if (!credential.has_value() || credential->accessToken.isEmpty()) {
                       return AppError(AppErrorCode::Configuration,
                                       QStringLiteral("Google authorization must be renewed"));
                     }
                     GoogleCalendarFreeBusyResultOrError response = googleCalendarFreeBusyClient_
                         .query({.startAt = startAt, .endAt = endAt, .calendarIds = std::move(remoteIds)},
                                credential->accessToken)
                         .get();
                     if (std::holds_alternative<GoogleApiError>(response)) {
                       return AppError(AppErrorCode::Network,
                                       std::get<GoogleApiError>(std::move(response)).message());
                     }
                     QVariantList intervals;
                     const GoogleCalendarFreeBusyResult result =
                         std::get<GoogleCalendarFreeBusyResult>(std::move(response));
                     for (auto calendar = result.intervalsByCalendar.constBegin();
                          calendar != result.intervalsByCalendar.constEnd(); ++calendar) {
                       for (const GoogleCalendarBusyInterval& interval : calendar.value()) {
                         intervals.append(QVariantMap{{QStringLiteral("calendarId"), calendar.key()},
                                                      {QStringLiteral("startAt"), interval.startAt},
                                                      {QStringLiteral("endAt"), interval.endAt}});
                       }
                     }
                     return intervals;
                   }),
        [this](std::variant<QVariantList, AppError> result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(std::move(result))));
            return;
          }
          const QVariantList intervals = std::get<QVariantList>(std::move(result));
          if (freeBusyIntervals_ != intervals) {
            freeBusyIntervals_ = intervals;
            emit freeBusyIntervalsChanged();
          }
        });
}

void AppController::searchGoogleDriveAttachments(QString query) {
  if (!googleConnected_ || credentialStore_ == nullptr) {
    setStatus(QStringLiteral("Connect Google before searching Drive attachments"));
    return;
  }
  watch(std::async(std::launch::async,
                   [this, query = std::move(query)]() -> std::variant<QVariantList, AppError> {
                     OAuthCredentialReadResult read =
                         credentialStore_->read(QString::fromLatin1(kGoogleAccountId)).get();
                     if (std::holds_alternative<AppError>(read)) {
                       return std::get<AppError>(std::move(read));
                     }
                     const std::optional<OAuthStoredCredential>& credential =
                         std::get<std::optional<OAuthStoredCredential>>(read);
                     if (!credential.has_value() || credential->accessToken.isEmpty()) {
                       return AppError(AppErrorCode::Configuration,
                                       QStringLiteral("Google authorization must be renewed for Drive access"));
                     }
                     GoogleDriveAttachmentCandidatesOrError response =
                         googleDriveFilePickerClient_.search(query, credential->accessToken).get();
                     if (std::holds_alternative<GoogleApiError>(response)) {
                       const GoogleApiError error = std::get<GoogleApiError>(std::move(response));
                       return AppError(AppErrorCode::Network,
                                       QStringLiteral("Drive API access failed: ") + error.message());
                     }
                     QVariantList rows;
                     const QList<GoogleDriveAttachmentCandidate> candidates =
                         std::get<QList<GoogleDriveAttachmentCandidate>>(std::move(response));
                     rows.reserve(candidates.size());
                     for (const GoogleDriveAttachmentCandidate& candidate : candidates) {
                       rows.append(QVariantMap{{QStringLiteral("id"), candidate.id},
                                               {QStringLiteral("name"), candidate.name},
                                               {QStringLiteral("mimeType"), candidate.mimeType},
                                               {QStringLiteral("fileUrl"), candidate.webViewLink},
                                               {QStringLiteral("iconLink"),
                                                candidate.iconLink.value_or(QString())}});
                     }
                     return rows;
                   }),
        [this](std::variant<QVariantList, AppError> result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(std::move(result))));
            return;
          }
          const QVariantList candidates = std::get<QVariantList>(std::move(result));
          if (driveAttachmentCandidates_ != candidates) {
            driveAttachmentCandidates_ = candidates;
            emit driveAttachmentCandidatesChanged();
          }
        });
}

void AppController::setSearchQuery(QString query) {
  if (query == searchQuery_) {
    return;
  }
  ++searchGeneration_;
  searchDebounce_.stop();
  if (searchCancellation_ != nullptr) {
    static_cast<void>(searchCancellation_->requestStop());
  }
  searchQuery_ = std::move(query);
  emit searchQueryChanged();
  const LocalSearchQueryResult parsed = LocalSearchQuery::parse(searchQuery_);
  if (std::holds_alternative<AppError>(parsed)) {
    setSearchError(errorMessage(std::get<AppError>(parsed)));
    setSearchFilterChips({});
    searchResultsModel().setResults({});
    setSearchLoading(false);
    return;
  }
  const LocalSearchParsedQuery& value = std::get<LocalSearchParsedQuery>(parsed);
  setSearchError({});
  setSearchFilterChips(value.chips);
  if (value.plainText.isEmpty() && value.chips.isEmpty()) {
    searchResultsModel().setResults({});
    setSearchLoading(false);
    return;
  }
  searchDebounce_.start();
}

void AppController::refreshSearchProjection() {
  if (searchQuery_.trimmed().isEmpty()) {
    return;
  }
  ++searchGeneration_;
  searchDebounce_.stop();
  if (searchCancellation_ != nullptr) {
    static_cast<void>(searchCancellation_->requestStop());
  }
  searchResultsModel().setResults({});
  setSearchLoading(false);
  searchDebounce_.start();
}

void AppController::applySavedSearch(QString savedSearchId) {
  const auto found = std::find_if(
      savedSearches_.cbegin(), savedSearches_.cend(), [&savedSearchId](const SavedSearch& search) {
        return search.id == savedSearchId;
      });
  if (found == savedSearches_.cend()) {
    setStatus(QStringLiteral("Saved search was not found"));
    return;
  }
  setSearchQuery(found->query);
}

void AppController::saveSearch(QString name, QString query) {
  name = name.trimmed();
  query = query.trimmed();
  if (name.isEmpty() || query.isEmpty()) {
    setStatus(QStringLiteral("Saved search name and query are required"));
    return;
  }
  const LocalSearchQueryResult parsed = LocalSearchQuery::parse(query);
  if (std::holds_alternative<AppError>(parsed)) {
    setStatus(errorMessage(std::get<AppError>(parsed)));
    return;
  }
  if (std::any_of(
          savedSearches_.cbegin(), savedSearches_.cend(), [&name](const SavedSearch& search) {
            return search.name.compare(name, Qt::CaseInsensitive) == 0;
          })) {
    setStatus(QStringLiteral("Saved search name already exists"));
    return;
  }
  QList<SavedSearch> next = savedSearches_;
  next.append({.id = QUuid::createUuid().toString(QUuid::WithoutBraces),
               .name = std::move(name),
               .query = std::move(query)});
  watch(savedSearchStore_.save(next),
        [this, next = std::move(next)](SavedSearchMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          setSavedSearches(next);
        });
}

void AppController::renameSavedSearch(QString savedSearchId, QString name) {
  name = name.trimmed();
  if (name.isEmpty()) {
    setStatus(QStringLiteral("Saved search name is required"));
    return;
  }
  QList<SavedSearch> next = savedSearches_;
  const auto found =
      std::find_if(next.begin(), next.end(), [&savedSearchId](const SavedSearch& search) {
        return search.id == savedSearchId;
      });
  if (found == next.end()) {
    setStatus(QStringLiteral("Saved search was not found"));
    return;
  }
  if (std::any_of(next.cbegin(), next.cend(), [&savedSearchId, &name](const SavedSearch& search) {
        return search.id != savedSearchId && search.name.compare(name, Qt::CaseInsensitive) == 0;
      })) {
    setStatus(QStringLiteral("Saved search name already exists"));
    return;
  }
  found->name = std::move(name);
  watch(savedSearchStore_.save(next),
        [this, next = std::move(next)](SavedSearchMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          setSavedSearches(next);
        });
}

void AppController::deleteSavedSearch(QString savedSearchId) {
  QList<SavedSearch> next = savedSearches_;
  const auto found =
      std::find_if(next.begin(), next.end(), [&savedSearchId](const SavedSearch& search) {
        return search.id == savedSearchId;
      });
  if (found == next.end()) {
    setStatus(QStringLiteral("Saved search was not found"));
    return;
  }
  next.erase(found);
  watch(savedSearchStore_.save(next),
        [this, next = std::move(next)](SavedSearchMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          setSavedSearches(next);
        });
}

void AppController::saveClientId(QString clientId) {
  watch(oauthConfigurationStore_.save(std::move(clientId)),
        [this](OAuthClientConfigurationMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            watch(oauthConfigurationStore_.load(),
                  [this](OAuthClientConfigurationReadResult loaded) {
                    if (std::holds_alternative<AppError>(loaded)) {
                      setStatus(errorMessage(std::get<AppError>(loaded)));
                    } else if (const std::optional<OAuthClientConfiguration>& configuration =
                                   std::get<std::optional<OAuthClientConfiguration>>(loaded);
                               configuration.has_value()) {
                      clientId_ = configuration->clientId;
                      {
                        std::lock_guard<std::mutex> lock(syncConfigurationMutex_);
                        syncClientId_ = clientId_;
                      }
                      emit clientIdChanged();
                      setStatus(QStringLiteral("Google client ID saved"));
                    }
                  });
          }
        });
}

void AppController::connectGoogle() {
  if (clientId_.isEmpty()) {
    setStatus(QStringLiteral("Save a desktop OAuth client ID before connecting Google"));
    return;
  }
  if (credentialStore_ == nullptr) {
    setStatus(QStringLiteral("Secure credential storage is unavailable on this platform"));
    return;
  }
  if (oauthLoopbackListener_.isListening()) {
    setStatus(QStringLiteral("Google authorization is already in progress"));
    return;
  }
  const OAuthLoopbackListenerStartResult listenerStart = oauthLoopbackListener_.start();
  if (std::holds_alternative<AppError>(listenerStart)) {
    setStatus(errorMessage(std::get<AppError>(listenerStart)));
    return;
  }
  const QUrl redirectUri = std::get<QUrl>(listenerStart);
  const PkceAuthorizationRequest pkce = pkceStateRegistry_.begin();
  QUrl authorizationUrl(QStringLiteral("https://accounts.google.com/o/oauth2/v2/auth"));
  QUrlQuery query;
  query.addQueryItem(QStringLiteral("client_id"), clientId_);
  query.addQueryItem(QStringLiteral("redirect_uri"), redirectUri.toString(QUrl::FullyEncoded));
  query.addQueryItem(QStringLiteral("response_type"), QStringLiteral("code"));
  query.addQueryItem(QStringLiteral("scope"), requiredGoogleScopes().join(u' '));
  query.addQueryItem(QStringLiteral("state"), pkce.state);
  query.addQueryItem(QStringLiteral("code_challenge"), pkce.codeChallenge);
  query.addQueryItem(QStringLiteral("code_challenge_method"), QStringLiteral("S256"));
  query.addQueryItem(QStringLiteral("access_type"), QStringLiteral("offline"));
  query.addQueryItem(QStringLiteral("prompt"), QStringLiteral("consent"));
  authorizationUrl.setQuery(query);
  const OAuthBrowserAuthorizationLaunchResult launch =
      oauthBrowserAuthorizationLauncher_.launch(authorizationUrl);
  if (std::holds_alternative<AppError>(launch)) {
    oauthLoopbackListener_.stop();
    setStatus(errorMessage(std::get<AppError>(launch)));
    return;
  }
  setStatus(QStringLiteral("Complete Google authorization in your browser"));
}

void AppController::handleOAuthCallback(OAuthLoopbackCallback callback) {
  if (callback.error.has_value()) {
    static_cast<void>(oauthLoopbackListener_.respond(
        callback.requestId, 400, QStringLiteral("Google authorization was not completed.")));
    oauthLoopbackListener_.stop();
    setStatus(QStringLiteral("Google authorization was not completed"));
    return;
  }
  if (!callback.code.has_value() || !callback.state.has_value()) {
    static_cast<void>(oauthLoopbackListener_.respond(
        callback.requestId, 400, QStringLiteral("Google authorization response is invalid.")));
    oauthLoopbackListener_.stop();
    setStatus(QStringLiteral("Google authorization response is invalid"));
    return;
  }
  const PkceStateValidationResult state = pkceStateRegistry_.consume(*callback.state);
  if (state.status != PkceStateValidationStatus::Accepted) {
    static_cast<void>(oauthLoopbackListener_.respond(
        callback.requestId,
        400,
        QStringLiteral("Google authorization state is invalid or expired.")));
    oauthLoopbackListener_.stop();
    setStatus(QStringLiteral("Google authorization state is invalid or expired"));
    return;
  }
  const QUrl redirectUri = oauthLoopbackListener_.redirectUri();
  if (!redirectUri.isValid()) {
    static_cast<void>(oauthLoopbackListener_.respond(
        callback.requestId, 500, QStringLiteral("Google authorization could not be completed.")));
    oauthLoopbackListener_.stop();
    setStatus(QStringLiteral("Google authorization listener is unavailable"));
    return;
  }
  watch(oauthTokenExchangeClient_.exchange({.code = *callback.code,
                                            .codeVerifier = state.codeVerifier,
                                            .redirectUri = redirectUri,
                                            .clientId = clientId_}),
        [this, requestId = callback.requestId](OAuthTokenExchangeResult result) {
          if (std::holds_alternative<AppError>(result)) {
            static_cast<void>(oauthLoopbackListener_.respond(
                requestId, 500, QStringLiteral("Google authorization could not be completed.")));
            oauthLoopbackListener_.stop();
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          finishOAuthConnection(requestId, std::get<OAuthTokenSet>(std::move(result)));
        });
}

void AppController::finishOAuthConnection(std::uint64_t requestId, OAuthTokenSet tokenSet) {
  if (!tokenSet.refreshToken.has_value() || credentialStore_ == nullptr) {
    static_cast<void>(oauthLoopbackListener_.respond(
        requestId, 500, QStringLiteral("Google did not return a reusable authorization.")));
    oauthLoopbackListener_.stop();
    setStatus(QStringLiteral("Google did not return a reusable authorization"));
    return;
  }
  const QStringList scopes = tokenSet.scope.has_value()
                                 ? tokenSet.scope->split(u' ', Qt::SkipEmptyParts)
                                 : requiredGoogleScopes();
  watch(
      credentialStore_->save(QString::fromLatin1(kGoogleAccountId),
                             {.accessToken = std::move(tokenSet.accessToken),
                              .refreshToken = std::move(tokenSet.refreshToken)}),
      [this, requestId, scopes](OAuthCredentialSaveResult result) {
        if (std::holds_alternative<AppError>(result)) {
          static_cast<void>(oauthLoopbackListener_.respond(
              requestId, 500, QStringLiteral("Google authorization could not be saved.")));
          oauthLoopbackListener_.stop();
          setStatus(errorMessage(std::get<AppError>(result)));
          return;
        }
        watch(
            accountStatusService_.upsert({.accountId = QString::fromLatin1(kGoogleAccountId),
                                          .connectionState = AccountConnectionState::Connected,
                                          .grantedScopes = scopes,
                                          .lastAuthenticatedAt = authenticationTimestamp(clock_)}),
            [this, requestId](AccountStatusSaveResultOrError saved) {
              if (std::holds_alternative<AppError>(saved)) {
                static_cast<void>(oauthLoopbackListener_.respond(
                    requestId, 500, QStringLiteral("Google authorization could not be saved.")));
                oauthLoopbackListener_.stop();
                setStatus(errorMessage(std::get<AppError>(saved)));
                return;
              }
              static_cast<void>(oauthLoopbackListener_.respond(
                  requestId, 200, QStringLiteral("Google connected. You can close this page.")));
              oauthLoopbackListener_.stop();
              if (!googleConnected_) {
                googleConnected_ = true;
                emit googleConnectedChanged();
              }
              setStatus(QStringLiteral("Google connected"));
              syncGoogle();
            });
      });
}

void AppController::syncGoogle() {
  if (!googleConnected_ || clientId_.isEmpty() || credentialStore_ == nullptr) {
    return;
  }
  requestGoogleSync(SyncScheduleTrigger::Manual);
  startPeriodicGoogleSync();
}

void AppController::saveConflictPolicy(int policyValue) {
  const std::optional<SyncConflictPolicy> policy = conflictPolicyForValue(policyValue);
  if (!policy.has_value()) {
    setStatus(QStringLiteral("Sync conflict policy is invalid"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kSyncSettingsScope),
                                   QString::fromLatin1(kConflictPolicySettingsKey),
                                   QString::number(policyValue)),
        [this, policyValue, policy](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          if (conflictPolicy_ != policyValue) {
            conflictPolicy_ = policyValue;
            emit conflictPolicyChanged();
          }
          googleSyncConflictResolver_.setPolicy(*policy);
          setStatus(QStringLiteral("Sync conflict policy saved"));
        });
}

void AppController::saveNotesEnabled(bool enabled) {
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kNotesEnabledSettingsKey),
                                   enabled ? QStringLiteral("true") : QStringLiteral("false")),
        [this, enabled](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          if (notesEnabled_ != enabled) {
            notesEnabled_ = enabled;
            applyTaskProjections(taskProjectionTasks_);
            refreshSearchProjection();
            emit notesEnabledChanged();
          }
          setStatus(QStringLiteral("Notes presentation saved"));
        });
}

void AppController::saveNotesProjectionMode(int mode) {
  if (!isValidNotesProjectionMode(mode)) {
    setStatus(QStringLiteral("Notes projection is invalid"));
    return;
  }
  watch(settingsService_.writeJson(QString::fromLatin1(kPresentationSettingsScope),
                                   QString::fromLatin1(kNotesProjectionSettingsKey),
                                   QString::number(mode)),
        [this, mode](SettingsMutationResultOrError result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          if (notesProjectionMode_ != mode) {
            notesProjectionMode_ = mode;
            applyTaskProjections(taskProjectionTasks_);
            refreshSearchProjection();
            emit notesProjectionModeChanged();
          }
          setStatus(QStringLiteral("Notes presentation saved"));
        });
}

void AppController::resolveSyncConflict(QString conflictId, bool keepLocal) {
  const SyncConflictResolution resolution =
      keepLocal ? SyncConflictResolution::KeepLocal : SyncConflictResolution::KeepRemote;
  watch(googleSyncConflictResolver_.resolve(std::move(conflictId), resolution),
        [this](std::optional<AppError> result) {
          if (result.has_value()) {
            setStatus(errorMessage(*result));
            return;
          }
          setStatus(QStringLiteral("Sync conflict resolved"));
          syncGoogle();
        });
}

void AppController::requestGoogleSync(SyncScheduleTrigger trigger) {
  if (!googleConnected_ || clientId_.isEmpty() || credentialStore_ == nullptr) {
    return;
  }
  setSyncStatus(QStringLiteral("pulling"));
  watch(syncScheduler_.request(trigger), [this](SyncSchedulerResult result) {
    if (std::holds_alternative<AppError>(result)) {
      const AppError& error = std::get<AppError>(result);
      setSyncStatus(error.code() == AppErrorCode::Configuration ? QStringLiteral("auth-required")
                                                                : QStringLiteral("retrying"));
      setStatus(errorMessage(error));
      return;
    }
    if (syncStatus_ == QStringLiteral("pulling") || syncStatus_ == QStringLiteral("pushing")) {
      setSyncStatus(QStringLiteral("idle"));
    }
    refresh();
  });
}

void AppController::startPeriodicGoogleSync() {
  if (googleConnected_ && !clientId_.isEmpty()) {
    static_cast<void>(syncScheduler_.startPeriodic(kGoogleSyncInterval));
  }
}

std::optional<AppError> AppController::runGoogleSync(const SyncSchedulerRequest&) {
  const auto fail = [this](AppError error) {
    setSyncStatus(error.code() == AppErrorCode::Configuration ? QStringLiteral("auth-required")
                                                              : QStringLiteral("retrying"));
    return std::optional<AppError>(std::move(error));
  };
  setSyncStatus(QStringLiteral("pulling"));
  QString clientId;
  {
    std::lock_guard<std::mutex> lock(syncConfigurationMutex_);
    clientId = syncClientId_;
  }
  if (credentialStore_ == nullptr || clientId.isEmpty()) {
    return fail(AppError(AppErrorCode::Configuration,
                         QStringLiteral("Google authorization must be renewed")));
  }
  if (const std::optional<AppError> initialization = optimisticMutationCoordinator_.ready().get();
      initialization.has_value()) {
    return fail(*initialization);
  }
  if (const std::optional<AppError> initialization = syncCheckpointStore_.ready().get();
      initialization.has_value()) {
    return fail(*initialization);
  }
  if (const std::optional<AppError> initialization = syncConflictStore_.ready().get();
      initialization.has_value()) {
    return fail(*initialization);
  }
  OAuthCredentialReadResult credential =
      credentialStore_->read(QString::fromLatin1(kGoogleAccountId)).get();
  if (std::holds_alternative<AppError>(credential)) {
    return fail(std::get<AppError>(std::move(credential)));
  }
  const std::optional<OAuthStoredCredential>& stored =
      std::get<std::optional<OAuthStoredCredential>>(credential);
  if (!stored.has_value() || !stored->refreshToken.has_value()) {
    return fail(AppError(AppErrorCode::Configuration,
                         QStringLiteral("Google authorization must be renewed")));
  }
  const QString refreshToken = *stored->refreshToken;
  OAuthTokenRefreshResult refreshed =
      oauthTokenRefreshClient_
          .refresh({.clientId = std::move(clientId), .refreshToken = refreshToken})
          .get();
  if (std::holds_alternative<AppError>(refreshed)) {
    return fail(std::get<AppError>(std::move(refreshed)));
  }
  const QString accessToken = std::get<OAuthRefreshedToken>(std::move(refreshed)).accessToken;
  OAuthCredentialSaveResult saved =
      credentialStore_
          ->save(QString::fromLatin1(kGoogleAccountId),
                 {.accessToken = accessToken, .refreshToken = refreshToken})
          .get();
  if (std::holds_alternative<AppError>(saved)) {
    return fail(std::get<AppError>(std::move(saved)));
  }
  setSyncStatus(QStringLiteral("pushing"));
  GoogleTaskMutationPushResultOrError taskPush =
      googleTaskMutationPushService_.pushDue(accessToken).get();
  if (std::holds_alternative<AppError>(taskPush)) {
    return fail(std::get<AppError>(std::move(taskPush)));
  }
  GoogleCalendarEventMutationPushResultOrError eventPush =
      googleCalendarEventMutationPushService_.pushDue(accessToken).get();
  if (std::holds_alternative<AppError>(eventPush)) {
    return fail(std::get<AppError>(std::move(eventPush)));
  }
  const bool hasDeferredMutations =
      std::get<GoogleTaskMutationPushResult>(taskPush).failed > 0 ||
      std::get<GoogleCalendarEventMutationPushResult>(eventPush).failed > 0;
  SyncConflictListResult conflicts = syncConflictStore_.listUnresolved().get();
  if (std::holds_alternative<AppError>(conflicts)) {
    return fail(std::get<AppError>(std::move(conflicts)));
  }
  const QList<SyncConflict>& unresolved = std::get<QList<SyncConflict>>(conflicts);
  setUnresolvedConflicts(unresolved);
  SyncConflictListResult history = syncConflictStore_.listResolved().get();
  if (std::holds_alternative<AppError>(history)) {
    return fail(std::get<AppError>(std::move(history)));
  }
  setResolvedConflicts(std::get<QList<SyncConflict>>(std::move(history)));
  setSyncStatus(QStringLiteral("pulling"));
  GoogleMirrorWriteResult pulled = pullGoogleData(accessToken).get();
  if (std::holds_alternative<AppError>(pulled)) {
    return fail(std::get<AppError>(std::move(pulled)));
  }
  if (!unresolved.isEmpty()) {
    setSyncStatus(QStringLiteral("conflict"));
  } else if (hasDeferredMutations) {
    setSyncStatus(QStringLiteral("retrying"));
  } else {
    setSyncStatus(QStringLiteral("idle"));
  }
  return std::nullopt;
}

std::future<GoogleMirrorWriteResult> AppController::pullGoogleData(QString accessToken) {
  auto completion = std::make_shared<std::promise<GoogleMirrorWriteResult>>();
  std::future<GoogleMirrorWriteResult> future = completion->get_future();
  auto pull = [this, accessToken = std::move(accessToken)] {
    GoogleTaskMirrorSyncResultOrError taskSync =
        googleTaskMirrorSyncService_.sync(QString::fromLatin1(kGoogleAccountId), accessToken).get();
    if (std::holds_alternative<AppError>(taskSync)) {
      return GoogleMirrorWriteResult(std::get<AppError>(std::move(taskSync)));
    }
    if (std::holds_alternative<GoogleApiError>(taskSync)) {
      return GoogleMirrorWriteResult(
          AppError(AppErrorCode::Network, std::get<GoogleApiError>(std::move(taskSync)).message()));
    }
    GoogleCalendarMirrorSyncResultOrError calendarSync =
        googleCalendarMirrorSyncService_.sync(QString::fromLatin1(kGoogleAccountId), accessToken)
            .get();
    if (std::holds_alternative<AppError>(calendarSync)) {
      return GoogleMirrorWriteResult(std::get<AppError>(std::move(calendarSync)));
    }
    if (std::holds_alternative<GoogleApiError>(calendarSync)) {
      return GoogleMirrorWriteResult(AppError(
          AppErrorCode::Network, std::get<GoogleApiError>(std::move(calendarSync)).message()));
    }
    return GoogleMirrorWriteResult(std::monostate{});
  };
  try {
    std::thread([completion, pull = std::move(pull)]() mutable {
      try {
        completion->set_value(pull());
      } catch (...) {
        completion->set_value(
            AppError(AppErrorCode::Network, QStringLiteral("Google sync failed unexpectedly")));
      }
    }).detach();
  } catch (...) {
    completion->set_value(
        AppError(AppErrorCode::Network, QStringLiteral("Google sync could not start")));
  }
  return future;
}

void AppController::createTask(QString taskListId, QString parentTaskId, QString title) {
  watch(
      taskMutationService_.create(
          {.taskListId = std::move(taskListId),
           .parentTaskId = parentTaskId.isEmpty() ? std::nullopt
                                                  : std::optional<QString>(std::move(parentTaskId)),
           .title = std::move(title)}),
      [this](TaskMutationResult result) {
        if (std::holds_alternative<AppError>(result)) {
          setStatus(errorMessage(std::get<AppError>(result)));
        } else {
          refreshTasks();
        }
      });
}

void AppController::createTaskDetailed(QString taskListId,
                                       QString parentTaskId,
                                       QString title,
                                       QString notes,
                                       QString dueAt,
                                       QString dueTimeZone,
                                       int priority,
                                       bool managedRecurrence,
                                       int recurrenceFrequency,
                                       int recurrenceInterval,
                                       int recurrenceEndKind,
                                       QString recurrenceEndUntil,
                                       int recurrenceEndCount,
                                       QString recurrenceRule,
                                       QString exclusionDates,
                                       QString additionDates) {
  const std::optional<TaskPriority> parsedPriority = priorityForValue(priority);
  const bool clearingDue = dueAt.trimmed().isEmpty();
  const std::optional<QString> normalizedDue =
      clearingDue ? std::optional<QString>{} : normalizedDueAt(std::move(dueAt));
  if (!parsedPriority.has_value() || (!normalizedDue.has_value() && !clearingDue)) {
    setStatus(QStringLiteral("Task creation input is invalid"));
    return;
  }
  TaskCreateInput input{.taskListId = std::move(taskListId),
                        .parentTaskId = parentTaskId.isEmpty()
                                            ? std::optional<QString>{}
                                            : std::optional<QString>(std::move(parentTaskId)),
                        .title = title.trimmed(),
                        .notes = std::move(notes),
                        .due = normalizedDue.has_value()
                                   ? std::optional<TaskDue>(TaskDue{
                                         .at = normalizedDue,
                                         .timeZone = dueTimeZone.trimmed().isEmpty()
                                                         ? std::optional<QString>{}
                                                         : std::optional<QString>(dueTimeZone.trimmed())})
                                   : std::optional<TaskDue>{},
                        .priority = *parsedPriority};
  if (managedRecurrence) {
    const std::optional<ManagedTaskRecurrenceConfiguration> recurrence =
        managedTaskRecurrenceConfiguration(recurrenceFrequency,
                                           recurrenceInterval,
                                           recurrenceEndKind,
                                           recurrenceEndUntil,
                                           recurrenceEndCount);
    if (!recurrence.has_value() || !normalizedDue.has_value() || input.parentTaskId.has_value()) {
      setStatus(QStringLiteral("Managed recurrence requires a top-level task with a valid due date"));
      return;
    }
    const std::optional<QList<QString>> excluded = recurrenceDatesFromText(exclusionDates);
    const std::optional<QList<QString>> added = recurrenceDatesFromText(additionDates);
    if (!excluded.has_value() || !added.has_value()) {
      setStatus(QStringLiteral("Task recurrence dates must be unique ISO dates"));
      return;
    }
    const QDate anchor = QDateTime::fromString(*normalizedDue, Qt::ISODate).date();
    const QString timeZone = dueTimeZone.trimmed().isEmpty()
                                 ? QString::fromUtf8(QTimeZone::systemTimeZoneId())
                                 : dueTimeZone.trimmed();
    if (!anchor.isValid() || !QTimeZone(timeZone.toUtf8()).isValid()) {
      setStatus(QStringLiteral("Managed recurrence time zone is invalid"));
      return;
    }
    const QString seriesId = QUuid::createUuid().toString(QUuid::WithoutBraces);
    TaskRecurrenceMarker marker{.seriesId = seriesId,
                                .occurrenceId = seriesId + QStringLiteral(":0"),
                                .frequency = recurrence->frequency,
                                .interval = recurrence->interval,
                                .anchorDate = anchor.toString(Qt::ISODate),
                                .timeZone = timeZone,
                                .end = recurrence->end,
                                .recurrenceRule = recurrenceRule.trimmed().isEmpty()
                                                      ? recurrence->defaultRule
                                                      : recurrenceRule.trimmed(),
                                .exclusionDates = *excluded,
                                .additionDates = *added,
                                .templateTitle = input.title,
                                .templateDueDate = anchor.toString(Qt::ISODate),
                                .templatePriority = priorityText(*parsedPriority)};
    const TaskRecurrenceSerializationResult serialized =
        serializeTaskRecurrenceNotes(input.notes.value_or(QString()), marker);
    if (serialized.error.has_value()) {
      setStatus(*serialized.error);
      return;
    }
    input.notes = serialized.notes;
    input.due = TaskDue{.at = normalizedDue, .timeZone = timeZone};
  }
  watch(taskMutationService_.create(std::move(input)), [this](TaskMutationResult result) {
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(result)));
    } else {
      refreshTasks();
    }
  });
}

void AppController::saveNoteTask(QString taskId, QString taskListId, QString title, QString notes) {
  if (taskId.isEmpty()) {
    watch(taskMutationService_.create({.taskListId = std::move(taskListId),
                                       .title = std::move(title),
                                       .notes = std::move(notes)}),
          [this](TaskMutationResult result) {
            if (std::holds_alternative<AppError>(result)) {
              setStatus(errorMessage(std::get<AppError>(result)));
            } else {
              refreshTasks();
            }
          });
    return;
  }
  const auto current =
      std::find_if(taskProjectionTasks_.cbegin(),
                   taskProjectionTasks_.cend(),
                   [&taskId](const TaskModelTask& task) { return task.id == taskId; });
  if (current == taskProjectionTasks_.cend()) {
    setStatus(QStringLiteral("Note task is unavailable"));
    return;
  }
  const bool needsMove = current->taskListId != taskListId;
  watch(taskMutationService_.update(
            {.taskId = taskId, .title = std::move(title), .notes = std::move(notes)}),
        [this, taskId = std::move(taskId), taskListId = std::move(taskListId), needsMove](
            TaskMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          if (!needsMove) {
            refreshTasks();
            return;
          }
          watch(taskMutationService_.moveToTaskList(std::move(taskId), std::move(taskListId)),
                [this](TaskMutationResult moveResult) {
                  if (std::holds_alternative<AppError>(moveResult)) {
                    setStatus(errorMessage(std::get<AppError>(moveResult)));
                  }
                  refreshTasks();
                });
        });
}

void AppController::createTaskList(QString title) {
  watch(taskListMutationService_.create(
            {.accountId = QString::fromLatin1(kGoogleAccountId), .title = std::move(title)}),
        [this](TaskListMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            const QString message = errorMessage(std::get<AppError>(result));
            setStatus(message);
            setTaskListError(message);
          } else {
            setTaskListError({});
            refreshTasks();
          }
        });
}

void AppController::renameTaskList(QString taskListId, QString title) {
  watch(taskListMutationService_.update(
            {.taskListId = std::move(taskListId), .title = std::move(title)}),
        [this](TaskListMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            const QString message = errorMessage(std::get<AppError>(result));
            setStatus(message);
            setTaskListError(message);
          } else {
            setTaskListError({});
            refreshTasks();
          }
        });
}

void AppController::setTaskListSelected(QString taskListId, bool selected) {
  watch(taskListMutationService_.setSelected(
            {.taskListId = std::move(taskListId), .selected = selected}),
        [this](TaskListMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            const QString message = errorMessage(std::get<AppError>(result));
            setStatus(message);
            setTaskListError(message);
          } else {
            setTaskListError({});
            refreshTasks();
          }
        });
}

void AppController::deleteTaskList(QString taskListId) {
  watch(taskListMutationService_.remove(std::move(taskListId)),
        [this](TaskListMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            const QString message = errorMessage(std::get<AppError>(result));
            setStatus(message);
            setTaskListError(message);
          } else {
            setTaskListError({});
            refreshTasks();
          }
        });
}

void AppController::updateTask(QString taskId,
                               QString title,
                               QString notes,
                               QString dueAt,
                               QString dueTimeZone,
                               int priority) {
  const std::optional<TaskPriority> parsedPriority = priorityForValue(priority);
  if (!parsedPriority.has_value()) {
    setStatus(QStringLiteral("Task priority is invalid"));
    return;
  }
  const bool clearingDue = dueAt.trimmed().isEmpty();
  const std::optional<QString> normalizedDue =
      clearingDue ? std::optional<QString>{} : normalizedDueAt(std::move(dueAt));
  if (!normalizedDue.has_value() && !clearingDue) {
    setStatus(QStringLiteral("Task due date is invalid"));
    return;
  }
  watch(taskMutationService_.update(
            {.taskId = std::move(taskId),
             .title = std::move(title),
             .notes = std::move(notes),
             .due = TaskDue{.at = normalizedDue,
                            .timeZone = normalizedDue.has_value() && !dueTimeZone.isEmpty()
                                            ? std::optional<QString>(std::move(dueTimeZone))
                                            : std::nullopt},
             .priority = *parsedPriority}),
        [this](TaskMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshTasks();
          }
        });
}

void AppController::updateTaskDetailed(QString taskId,
                                       QString title,
                                       QString notes,
                                       QString dueAt,
                                       QString dueTimeZone,
                                       int priority,
                                       bool managedRecurrence,
                                       int recurrenceFrequency,
                                       int recurrenceInterval,
                                       int recurrenceEndKind,
                                       QString recurrenceEndUntil,
                                       int recurrenceEndCount,
                                       QString recurrenceRule,
                                       QString exclusionDates,
                                       QString additionDates) {
  const std::optional<TaskPriority> parsedPriority = priorityForValue(priority);
  const bool clearingDue = dueAt.trimmed().isEmpty();
  const std::optional<QString> normalizedDue =
      clearingDue ? std::optional<QString>{} : normalizedDueAt(std::move(dueAt));
  const std::optional<ManagedTaskRecurrenceConfiguration> recurrence =
      managedRecurrence ? managedTaskRecurrenceConfiguration(recurrenceFrequency,
                                                             recurrenceInterval,
                                                             recurrenceEndKind,
                                                             recurrenceEndUntil,
                                                             recurrenceEndCount)
                        : std::optional<ManagedTaskRecurrenceConfiguration>{};
  if (!parsedPriority.has_value() || (!normalizedDue.has_value() && !clearingDue) ||
      (managedRecurrence && (!recurrence.has_value() || !normalizedDue.has_value()))) {
    setStatus(QStringLiteral("Task recurrence input is invalid"));
    return;
  }
  const std::optional<QList<QString>> excluded =
      managedRecurrence ? recurrenceDatesFromText(exclusionDates) : std::optional<QList<QString>>{};
  const std::optional<QList<QString>> added =
      managedRecurrence ? recurrenceDatesFromText(additionDates) : std::optional<QList<QString>>{};
  if (managedRecurrence && (!excluded.has_value() || !added.has_value())) {
    setStatus(QStringLiteral("Task recurrence dates must be unique ISO dates"));
    return;
  }
  const QString selectedRule = managedRecurrence
                                   ? (recurrenceRule.trimmed().isEmpty() ? recurrence->defaultRule
                                                                         : recurrenceRule.trimmed())
                                   : QString();
  const QString selectedTaskId = taskId;
  watch(taskMutationService_.update(
            {.taskId = std::move(taskId),
             .title = std::move(title),
             .notes = std::move(notes),
             .due = TaskDue{.at = normalizedDue,
                            .timeZone = normalizedDue.has_value() && !dueTimeZone.isEmpty()
                                            ? std::optional<QString>(std::move(dueTimeZone))
                                            : std::nullopt},
             .priority = *parsedPriority}),
        [this, selectedTaskId, recurrence, selectedRule, excluded, added](TaskMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          if (!recurrence.has_value()) {
            refreshTasks();
            return;
          }
          watch(taskMutationService_.reconfigureManagedRecurrence(selectedTaskId,
                                                                    recurrence->frequency,
                                                                    recurrence->interval,
                                                                    recurrence->end,
                                                                    selectedRule,
                                                                    *excluded,
                                                                    *added),
                [this](TaskMutationResult reconfigured) {
                  if (std::holds_alternative<AppError>(reconfigured)) {
                    setStatus(errorMessage(std::get<AppError>(reconfigured)));
                  } else {
                    refreshTasks();
                  }
                });
        });
}

void AppController::setTaskCompleted(QString taskId, bool completed) {
  watch(taskMutationService_.setCompleted(std::move(taskId), completed),
        [this](TaskMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshTasks();
          }
        });
}

void AppController::stopTaskRecurrence(QString taskId, int recurrenceScope) {
  if (recurrenceScope < 0 || recurrenceScope > 2) {
    setStatus(QStringLiteral("Task recurrence scope is invalid"));
    return;
  }
  const auto scope = recurrenceScope == 0 ? TaskRecurrenceScope::ThisOccurrence
                     : recurrenceScope == 1 ? TaskRecurrenceScope::ThisAndFollowing
                                            : TaskRecurrenceScope::EntireSeries;
  watch(taskMutationService_.stopManagedRecurrence(std::move(taskId), scope),
        [this](TaskMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshTasks();
          }
        });
}

void AppController::splitTaskRecurrence(QString taskId) {
  watch(taskMutationService_.splitManagedRecurrence(std::move(taskId)),
        [this](TaskMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshTasks();
          }
        });
}

void AppController::deleteTask(QString taskId) {
  watch(taskMutationService_.remove(std::move(taskId)), [this](TaskMutationResult result) {
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(result)));
    } else {
      refreshTasks();
    }
  });
}

void AppController::moveTask(QString taskId, QString taskListId) {
  watch(taskMutationService_.moveToTaskList(std::move(taskId), std::move(taskListId)),
        [this](TaskMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshTasks();
          }
        });
}

void AppController::reparentTask(QString taskId, QString parentTaskId) {
  const std::optional<std::optional<QString>> parent =
      parentTaskId.isEmpty() ? std::optional<std::optional<QString>>(std::optional<QString>{})
                             : std::optional<std::optional<QString>>(std::move(parentTaskId));
  watch(taskMutationService_.update({.taskId = std::move(taskId), .parentTaskId = parent}),
        [this](TaskMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshTasks();
          }
        });
}

void AppController::bulkSetTaskCompleted(QVariantList taskIds, bool completed) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(taskIds);
  if (!ids.has_value()) {
    setStatus(QStringLiteral("Bulk task selection is invalid"));
    return;
  }
  runBulkTaskMutation(
      {.action = completed ? TaskBulkAction::Complete : TaskBulkAction::Reopen, .taskIds = *ids});
}

void AppController::bulkDeleteTasks(QVariantList taskIds) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(taskIds);
  if (!ids.has_value()) {
    setStatus(QStringLiteral("Bulk task selection is invalid"));
    return;
  }
  runBulkTaskMutation({.action = TaskBulkAction::Delete, .taskIds = *ids});
}

void AppController::bulkMoveTasks(QVariantList taskIds, QString taskListId) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(taskIds);
  if (!ids.has_value()) {
    setStatus(QStringLiteral("Bulk task selection is invalid"));
    return;
  }
  runBulkTaskMutation(
      {.action = TaskBulkAction::MoveToList, .taskIds = *ids, .taskListId = std::move(taskListId)});
}

void AppController::bulkSetTaskDue(QVariantList taskIds, QString dueAt) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(taskIds);
  const std::optional<QString> normalizedDue = normalizedDueAt(std::move(dueAt));
  if (!ids.has_value() || !normalizedDue.has_value()) {
    setStatus(QStringLiteral("Bulk task due date is invalid"));
    return;
  }
  runBulkTaskMutation(
      {.action = TaskBulkAction::SetDue, .taskIds = *ids, .due = TaskDue{.at = normalizedDue}});
}

void AppController::bulkClearTaskDue(QVariantList taskIds) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(taskIds);
  if (!ids.has_value()) {
    setStatus(QStringLiteral("Bulk task selection is invalid"));
    return;
  }
  runBulkTaskMutation({.action = TaskBulkAction::ClearDue, .taskIds = *ids});
}

void AppController::bulkSetTaskPriority(QVariantList taskIds, int priority) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(taskIds);
  const std::optional<TaskPriority> parsedPriority = priorityForValue(priority);
  if (!ids.has_value() || !parsedPriority.has_value()) {
    setStatus(QStringLiteral("Bulk task priority is invalid"));
    return;
  }
  runBulkTaskMutation(
      {.action = TaskBulkAction::SetPriority, .taskIds = *ids, .priority = *parsedPriority});
}

void AppController::bulkReparentTasks(QVariantList taskIds, QString parentTaskId) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(taskIds);
  if (!ids.has_value()) {
    setStatus(QStringLiteral("Bulk task selection is invalid"));
    return;
  }
  runBulkTaskMutation({.action = TaskBulkAction::Reparent,
                       .taskIds = *ids,
                       .parentTaskId = parentTaskId.trimmed().isEmpty()
                                           ? std::optional<QString>{}
                                           : std::optional<QString>(std::move(parentTaskId))});
}

void AppController::bulkReplaceTaskText(QVariantList taskIds,
                                        QString findText,
                                        QString replaceText,
                                        int fields,
                                        int recurrenceScope) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(taskIds);
  if (!ids.has_value() || findText.isEmpty() || fields <= 0 || fields > 3 ||
      !isValidBulkTextRecurrenceScope(recurrenceScope)) {
    setStatus(QStringLiteral("Bulk task text replacement is invalid"));
    return;
  }
  runBulkTaskMutation({.action = TaskBulkAction::ReplaceText,
                       .taskIds = *ids,
                       .findText = std::move(findText),
                       .replaceText = std::move(replaceText),
                       .textFields = static_cast<std::uint8_t>(fields),
                       .recurrenceScope = recurrenceScope});
}

void AppController::previewBulkTaskText(QVariantList taskIds,
                                        QString findText,
                                        int fields,
                                        int recurrenceScope,
                                        int requestToken) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(taskIds);
  if (!ids.has_value() || findText.isEmpty() || fields <= 0 || fields > 3 ||
      !isValidBulkTextRecurrenceScope(recurrenceScope)) {
    setBulkTaskPreviewMessage(QStringLiteral("Enter find text and at least one field"),
                              requestToken);
    return;
  }
  previewBulkTaskMutation({.action = TaskBulkAction::ReplaceText,
                            .taskIds = *ids,
                            .findText = std::move(findText),
                            .textFields = static_cast<std::uint8_t>(fields),
                            .recurrenceScope = recurrenceScope,
                            .previewOnly = true},
                          requestToken);
}

void AppController::createEvent(QString calendarId,
                                QString title,
                                QString startAt,
                                QString endAt,
                                bool allDay,
                                QString description,
                                QString location) {
  watch(calendarMutationService_.create(
            {.calendarId = std::move(calendarId),
             .title = std::move(title),
             .startAt = std::move(startAt),
             .endAt = std::move(endAt),
             .allDay = allDay,
             .description = description.isEmpty() ? std::nullopt
                                                  : std::optional<QString>(std::move(description)),
             .location =
                 location.isEmpty() ? std::nullopt : std::optional<QString>(std::move(location))}),
        [this](CalendarEventMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshCalendar();
          }
        });
}

void AppController::updateEvent(QString eventId,
                                QString calendarId,
                                QString title,
                                QString startAt,
                                QString endAt,
                                bool allDay,
                                QString description,
                                QString location) {
  watch(calendarMutationService_.update(
            {.eventId = std::move(eventId),
             .calendarId = std::move(calendarId),
             .title = std::move(title),
             .description = std::optional<std::optional<QString>>(
                 description.isEmpty() ? std::optional<QString>{}
                                       : std::optional<QString>(std::move(description))),
             .location = std::optional<std::optional<QString>>(
                 location.isEmpty() ? std::optional<QString>{}
                                    : std::optional<QString>(std::move(location))),
             .startAt = std::move(startAt),
             .endAt = std::move(endAt),
             .allDay = allDay}),
        [this](CalendarEventMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshCalendar();
          }
        });
}

void AppController::createEventDetailed(QString calendarId,
                                        QString title,
                                        QString startAt,
                                        QString endAt,
                                        bool allDay,
                                        QString description,
                                        QString location,
                                        QString timeZone,
                                        QString colorId,
                                        bool available,
                                        QString visibility,
                                        QVariantList attendees,
                                        bool remindersUseDefault,
                                        QVariantList reminders,
                                        QString recurrenceRule,
                                        bool createGoogleMeet,
                                        QString attachmentsJson,
                                        QString guestPermissionsJson,
                                        QString eventType,
                                        QString statusPropertiesJson,
                                        QString sendUpdates) {
  const std::optional<QList<QString>> parsedAttendees = eventAttendeesFromVariantList(attendees);
  const std::optional<CalendarEventReminderSettings> parsedReminders =
      eventRemindersFromVariantList(remindersUseDefault, reminders);
  if (!parsedAttendees.has_value() || !parsedReminders.has_value()) {
    setStatus(QStringLiteral("Calendar event metadata is invalid"));
    return;
  }
  const std::optional<QString> eventTimeZone = timeZone.trimmed().isEmpty()
                                                   ? std::optional<QString>{}
                                                   : std::optional<QString>(timeZone.trimmed());
  watch(calendarMutationService_.create(
            {.calendarId = std::move(calendarId),
             .title = std::move(title),
             .startAt = std::move(startAt),
             .endAt = std::move(endAt),
             .allDay = allDay,
             .description = description.isEmpty() ? std::nullopt
                                                  : std::optional<QString>(std::move(description)),
             .location =
                 location.isEmpty() ? std::nullopt : std::optional<QString>(std::move(location)),
             .startTimeZone = eventTimeZone,
             .endTimeZone = eventTimeZone,
             .colorId = colorId.trimmed().isEmpty() ? std::optional<QString>{}
                                                    : std::optional<QString>(colorId.trimmed()),
             .transparency = available ? std::optional<QString>(QStringLiteral("transparent"))
                                       : std::optional<QString>(QStringLiteral("opaque")),
             .visibility = visibility.trimmed().isEmpty()
                               ? std::optional<QString>{}
                               : std::optional<QString>(visibility.trimmed()),
             .attendeeEmails = *parsedAttendees,
             .reminders = *parsedReminders,
             .recurrenceRule = recurrenceRule.trimmed().isEmpty()
                                   ? std::optional<QString>{}
                                   : std::optional<QString>(recurrenceRule.trimmed()),
             .richMetadata = {.createGoogleMeet = createGoogleMeet,
                              .attachmentsJson = std::move(attachmentsJson),
                              .guestPermissionsJson = std::move(guestPermissionsJson),
                              .eventType = std::move(eventType),
                              .statusPropertiesJson = std::move(statusPropertiesJson),
                              .sendUpdates = std::move(sendUpdates)}}),
        [this](CalendarEventMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshCalendar();
          }
        });
}

void AppController::updateEventDetailed(QString eventId,
                                        QString calendarId,
                                        QString title,
                                        QString startAt,
                                        QString endAt,
                                        bool allDay,
                                        QString description,
                                        QString location,
                                        QString timeZone,
                                        QString colorId,
                                        bool available,
                                        QString visibility,
                                        QVariantList attendees,
                                        bool remindersUseDefault,
                                        QVariantList reminders,
                                        QString recurrenceRule,
                                        int recurrenceScope,
                                        bool createGoogleMeet,
                                        QString attachmentsJson,
                                        QString guestPermissionsJson,
                                        QString statusPropertiesJson,
                                        QString sendUpdates) {
  const std::optional<QList<QString>> parsedAttendees = eventAttendeesFromVariantList(attendees);
  const std::optional<CalendarEventReminderSettings> parsedReminders =
      eventRemindersFromVariantList(remindersUseDefault, reminders);
  if (!parsedAttendees.has_value() || !parsedReminders.has_value()) {
    setStatus(QStringLiteral("Calendar event metadata is invalid"));
    return;
  }
  const std::optional<QString> eventTimeZone = timeZone.trimmed().isEmpty()
                                                   ? std::optional<QString>{}
                                                   : std::optional<QString>(timeZone.trimmed());
  const auto scope = recurrenceScope == 0 ? CalendarEventRecurrenceScope::ThisInstance
                     : recurrenceScope == 1 ? CalendarEventRecurrenceScope::ThisAndFollowing
                                            : CalendarEventRecurrenceScope::FullSeries;
  if (recurrenceScope < 0 || recurrenceScope > 2) {
    setStatus(QStringLiteral("Calendar recurrence scope is invalid"));
    return;
  }
  watch(calendarMutationService_.updateScoped(
            {.update = {.eventId = std::move(eventId),
             .calendarId = std::move(calendarId),
             .title = std::move(title),
             .description = std::optional<std::optional<QString>>(
                 description.isEmpty() ? std::optional<QString>{}
                                       : std::optional<QString>(std::move(description))),
             .location = std::optional<std::optional<QString>>(
                 location.isEmpty() ? std::optional<QString>{}
                                    : std::optional<QString>(std::move(location))),
             .startAt = std::move(startAt),
             .endAt = std::move(endAt),
             .allDay = allDay,
             .startTimeZone = std::optional<std::optional<QString>>(eventTimeZone),
             .endTimeZone = std::optional<std::optional<QString>>(eventTimeZone),
             .colorId = std::optional<std::optional<QString>>(
                 colorId.trimmed().isEmpty() ? std::optional<QString>{}
                                             : std::optional<QString>(colorId.trimmed())),
             .transparency = available ? std::optional<QString>(QStringLiteral("transparent"))
                                       : std::optional<QString>(QStringLiteral("opaque")),
             .visibility = visibility.trimmed().isEmpty()
                               ? std::optional<QString>{}
                               : std::optional<QString>(visibility.trimmed()),
             .attendeeEmails = *parsedAttendees,
             .reminders = *parsedReminders,
             .recurrenceRule = std::optional<std::optional<QString>>(
                 recurrenceRule.trimmed().isEmpty() ? std::optional<QString>{}
                                                   : std::optional<QString>(recurrenceRule.trimmed())),
             .createGoogleMeet = createGoogleMeet,
             .attachmentsJson = std::move(attachmentsJson),
             .guestPermissionsJson = std::move(guestPermissionsJson),
             .statusPropertiesJson = std::move(statusPropertiesJson),
             .sendUpdates = std::move(sendUpdates)},
             .scope = scope}),
        [this](CalendarEventMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshCalendar();
          }
        });
}

void AppController::deleteEvent(QString eventId, int recurrenceScope) {
  if (recurrenceScope < 0 || recurrenceScope > 2) {
    setStatus(QStringLiteral("Calendar recurrence scope is invalid"));
    return;
  }
  const auto scope = recurrenceScope == 0 ? CalendarEventRecurrenceScope::ThisInstance
                     : recurrenceScope == 1 ? CalendarEventRecurrenceScope::ThisAndFollowing
                                            : CalendarEventRecurrenceScope::FullSeries;
  watch(calendarMutationService_.removeScoped({.eventId = std::move(eventId), .scope = scope}),
        [this](CalendarEventMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshCalendar();
          }
        });
}

void AppController::respondToEvent(QString eventId, QString responseStatus, QString responseComment) {
  watch(calendarMutationService_.respond(std::move(eventId), std::move(responseStatus),
                                         std::move(responseComment)),
        [this](CalendarEventMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshCalendar();
          }
        });
}

void AppController::moveEvent(QString eventId, QString startAt, QString endAt, bool allDay) {
  watch(calendarMutationService_.update({.eventId = std::move(eventId),
                                         .startAt = std::move(startAt),
                                         .endAt = std::move(endAt),
                                         .allDay = allDay}),
        [this](CalendarEventMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshCalendar();
          }
        });
}

void AppController::resizeEvent(QString eventId, QString endAt) {
  watch(calendarMutationService_.update({.eventId = std::move(eventId), .endAt = std::move(endAt)}),
        [this](CalendarEventMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshCalendar();
          }
        });
}

void AppController::bulkDeleteEvents(QVariantList eventIds) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(eventIds);
  if (!ids.has_value()) {
    setStatus(QStringLiteral("Bulk event selection is invalid"));
    return;
  }
  runBulkEventMutation({.action = CalendarEventBulkAction::Delete, .eventIds = *ids});
}

void AppController::bulkMoveEvents(QVariantList eventIds, QString calendarId) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(eventIds);
  if (!ids.has_value()) {
    setStatus(QStringLiteral("Bulk event selection is invalid"));
    return;
  }
  runBulkEventMutation({.action = CalendarEventBulkAction::MoveToCalendar,
                        .eventIds = *ids,
                        .calendarId = std::move(calendarId)});
}

void AppController::bulkSetEventColor(QVariantList eventIds, QString colorId) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(eventIds);
  if (!ids.has_value()) {
    setStatus(QStringLiteral("Bulk event selection is invalid"));
    return;
  }
  runBulkEventMutation({.action = CalendarEventBulkAction::SetColor,
                        .eventIds = *ids,
                        .colorId = std::move(colorId)});
}

void AppController::bulkSetEventAvailability(QVariantList eventIds, bool available) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(eventIds);
  if (!ids.has_value()) {
    setStatus(QStringLiteral("Bulk event selection is invalid"));
    return;
  }
  runBulkEventMutation({.action = CalendarEventBulkAction::SetAvailability,
                        .eventIds = *ids,
                        .available = available});
}

void AppController::bulkSetEventVisibility(QVariantList eventIds, QString visibility) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(eventIds);
  if (!ids.has_value()) {
    setStatus(QStringLiteral("Bulk event selection is invalid"));
    return;
  }
  runBulkEventMutation({.action = CalendarEventBulkAction::SetVisibility,
                        .eventIds = *ids,
                        .visibility = std::move(visibility)});
}

void AppController::bulkShiftEventTimes(QVariantList eventIds, int shiftMinutes) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(eventIds);
  if (!ids.has_value()) {
    setStatus(QStringLiteral("Bulk event selection is invalid"));
    return;
  }
  runBulkEventMutation({.action = CalendarEventBulkAction::ShiftTime,
                        .eventIds = *ids,
                        .shiftMinutes = shiftMinutes});
}

void AppController::bulkReplaceEventText(QVariantList eventIds,
                                         QString findText,
                                         QString replaceText,
                                         int fields,
                                         int recurrenceScope) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(eventIds);
  if (!ids.has_value() || findText.isEmpty() || fields <= 0 || fields > 7 ||
      !isValidBulkTextRecurrenceScope(recurrenceScope)) {
    setStatus(QStringLiteral("Bulk event text replacement is invalid"));
    return;
  }
  runBulkEventMutation({.action = CalendarEventBulkAction::ReplaceText,
                        .eventIds = *ids,
                        .findText = std::move(findText),
                        .replaceText = std::move(replaceText),
                        .textFields = static_cast<std::uint8_t>(fields),
                        .recurrenceScope = recurrenceScope});
}

void AppController::previewBulkEventText(QVariantList eventIds,
                                         QString findText,
                                         int fields,
                                         int recurrenceScope,
                                         int requestToken) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(eventIds);
  if (!ids.has_value() || findText.isEmpty() || fields <= 0 || fields > 7 ||
      !isValidBulkTextRecurrenceScope(recurrenceScope)) {
    setBulkEventPreviewMessage(QStringLiteral("Enter find text and at least one field"),
                               requestToken);
    return;
  }
  previewBulkEventMutation({.action = CalendarEventBulkAction::ReplaceText,
                             .eventIds = *ids,
                             .findText = std::move(findText),
                             .textFields = static_cast<std::uint8_t>(fields),
                             .recurrenceScope = recurrenceScope,
                             .previewOnly = true},
                           requestToken);
}

void AppController::runSearch() {
  const LocalSearchQueryResult parsed = LocalSearchQuery::parse(searchQuery_);
  if (std::holds_alternative<AppError>(parsed)) {
    setSearchError(errorMessage(std::get<AppError>(parsed)));
    setSearchLoading(false);
    return;
  }
  const LocalSearchParsedQuery& value = std::get<LocalSearchParsedQuery>(parsed);
  if (value.plainText.isEmpty() && value.chips.isEmpty()) {
    setSearchLoading(false);
    return;
  }
  searchCancellation_ = std::make_unique<CancellationSource>();
  const std::uint64_t generation = searchGeneration_;
  setSearchLoading(true);
  watch(
      localSearchService_.search({.query = searchQuery_}, searchCancellation_->token()),
      [this, generation](LocalSearchPageResult result) {
        if (generation != searchGeneration_) {
          return;
        }
        setSearchLoading(false);
        if (std::holds_alternative<AppError>(result)) {
          const AppError& error = std::get<AppError>(result);
          if (error.code() != AppErrorCode::Cancelled) {
            setSearchError(errorMessage(error));
          }
          return;
        }
        setSearchError({});
        searchResultsModel().setResults(
            searchPresentation(std::get<LocalSearchPage>(std::move(result)).items,
                               notesEnabled_,
                               notesProjectionMode_));
      },
      false);
}

void AppController::loadSavedSearches() {
  watch(savedSearchStore_.load(), [this](SavedSearchListResult result) {
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(result)));
      return;
    }
    setSavedSearches(std::get<QList<SavedSearch>>(std::move(result)));
  });
}

void AppController::runBulkTaskMutation(TaskBulkMutationInput input) {
  watch(taskBulkMutationService_.execute(std::move(input)), [this](TaskBulkMutationResult result) {
    if (std::holds_alternative<AppError>(result)) {
      const QString message = errorMessage(std::get<AppError>(result));
      setBulkTaskStatusMessage(message);
      setStatus(message);
      return;
    }
    const TaskBulkMutationSummary& summary = std::get<TaskBulkMutationSummary>(result);
    const QString message = bulkTaskSummaryMessage(summary);
    setBulkTaskStatusMessage(message);
    setStatus(message);
    if (summary.queued > 0) {
      refreshTasks();
    }
  });
}

void AppController::runBulkEventMutation(CalendarEventBulkMutationInput input) {
  watch(calendarEventBulkMutationService_.execute(std::move(input)),
        [this](CalendarEventBulkMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            const QString message = errorMessage(std::get<AppError>(result));
            setBulkEventStatusMessage(message);
            setStatus(message);
            return;
          }
          const CalendarEventBulkMutationSummary& summary =
              std::get<CalendarEventBulkMutationSummary>(result);
          const QString message = bulkEventSummaryMessage(summary);
          setBulkEventStatusMessage(message);
          setStatus(message);
          if (summary.queued > 0) {
            refreshCalendar();
          }
        });
}

void AppController::previewBulkTaskMutation(TaskBulkMutationInput input, int requestToken) {
  latestTaskPreviewRequestToken_ = requestToken;
  watch(taskBulkMutationService_.execute(std::move(input)),
        [this, requestToken](TaskBulkMutationResult result) {
          if (requestToken != latestTaskPreviewRequestToken_) {
            return;
          }
          if (std::holds_alternative<AppError>(result)) {
            setBulkTaskPreviewMessage(errorMessage(std::get<AppError>(result)), requestToken);
            return;
          }
          const TaskBulkMutationSummary& summary = std::get<TaskBulkMutationSummary>(result);
          setBulkTaskPreviewMessage(
              QStringLiteral("Preview: %1 records will change; %2 skipped.")
                  .arg(summary.eligible)
                  .arg(summary.skipped),
              requestToken);
        });
}

void AppController::previewBulkEventMutation(CalendarEventBulkMutationInput input, int requestToken) {
  latestEventPreviewRequestToken_ = requestToken;
  watch(calendarEventBulkMutationService_.execute(std::move(input)),
        [this, requestToken](CalendarEventBulkMutationResult result) {
          if (requestToken != latestEventPreviewRequestToken_) {
            return;
          }
          if (std::holds_alternative<AppError>(result)) {
            setBulkEventPreviewMessage(errorMessage(std::get<AppError>(result)), requestToken);
            return;
          }
          const CalendarEventBulkMutationSummary& summary =
              std::get<CalendarEventBulkMutationSummary>(result);
          setBulkEventPreviewMessage(
              QStringLiteral("Preview: %1 records will change; %2 skipped.")
                  .arg(summary.eligible)
                  .arg(summary.skipped),
              requestToken);
        });
}

void AppController::schedulePoll() {
  if (pollScheduled_) {
    return;
  }
  pollScheduled_ = true;
  QTimer::singleShot(10, this, &AppController::pollPending);
}

void AppController::pollPending() {
  pollScheduled_ = false;
  std::vector<std::unique_ptr<PendingOperation>> existing = std::move(pending_);
  for (std::unique_ptr<PendingOperation>& operation : existing) {
    if (!operation->poll()) {
      pending_.push_back(std::move(operation));
    }
  }
  setBusy(std::any_of(
      pending_.cbegin(), pending_.cend(), [](const std::unique_ptr<PendingOperation>& operation) {
        return operation->affectsBusy();
      }));
  if (!pending_.empty()) {
    schedulePoll();
  }
}

void AppController::refreshTasks() {
  watch(taskListReadService_.list(), [this](TaskListPageResult result) {
    if (std::holds_alternative<AppError>(result)) {
      const QString message = errorMessage(std::get<AppError>(result));
      setStatus(message);
      setTaskListError(message);
      return;
    }
    setTaskListError({});
    taskListModel_.setTaskLists(std::get<TaskListPage>(std::move(result)).items);
  });
  watch(taskReadService_.list({.selectedListsOnly = true}), [this](TaskReadResult result) {
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(result)));
      return;
    }
    applyTaskProjections(std::get<QList<TaskModelTask>>(std::move(result)));
  });
}

void AppController::applyTaskProjections(QList<TaskModelTask> tasks) {
  taskProjectionTasks_ = std::move(tasks);
  taskModel_.setTasks(taskPresentation(
      taskProjectionTasks_, notesEnabled_ && notesProjectionMode_ == kNotesOnlyProjection));
  notesModel_.setTasks(taskProjectionTasks_);
}

void AppController::reorderTask(QString taskId, bool earlier) {
  watch(taskMutationService_.reorder(std::move(taskId),
                                     earlier ? TaskReorderDirection::Earlier
                                             : TaskReorderDirection::Later),
        [this](TaskMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshTasks();
          }
        });
}

void AppController::refreshCalendar() {
  if (reminderService_ != nullptr) {
    reminderService_->refresh();
  }
  const std::uint64_t generation = ++calendarRefreshGeneration_;
  refreshInvitations();
  loadCalendarManagementRows(generation, 0, {});
  watch(calendarReadService_.listCalendars(), [this, generation](CalendarListPageResult result) {
    if (generation != calendarRefreshGeneration_) {
      return;
    }
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(result)));
      return;
    }
    QList<CalendarSummary> calendars = std::get<CalendarListPage>(std::move(result)).items;
    QList<QString> ids;
    ids.reserve(calendars.size());
    for (const CalendarSummary& calendar : calendars) {
      ids.append(calendar.id);
    }
    calendarSourceModel_.setCalendars(std::move(calendars));
    refreshCalendarEvents(std::move(ids), generation);
  });
}

void AppController::loadCalendarManagementRows(std::uint64_t generation,
                                               std::int64_t offset,
                                               QVariantList rows) {
  watch(calendarReadService_.listCalendars(
            {.includeHidden = true, .limit = 100, .offset = offset}),
        [this, generation, rows = std::move(rows)](CalendarListPageResult result) mutable {
          if (generation != calendarRefreshGeneration_) {
            return;
          }
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(std::move(result))));
            return;
          }
          CalendarListPage page = std::get<CalendarListPage>(std::move(result));
          rows.reserve(rows.size() + page.items.size());
          for (const CalendarSummary& calendar : page.items) {
            QVariantMap row;
            row.insert(QStringLiteral("id"), calendar.id);
            row.insert(QStringLiteral("title"), calendar.title);
            row.insert(QStringLiteral("description"), calendar.description.value_or(QString()));
            row.insert(QStringLiteral("timeZone"), calendar.timeZone.value_or(QString()));
            row.insert(QStringLiteral("colorId"), calendar.colorId.value_or(QString()));
            row.insert(QStringLiteral("backgroundColor"),
                       calendar.backgroundColor.value_or(QString()));
            row.insert(QStringLiteral("accessRole"), calendar.accessRole.value_or(QString()));
            row.insert(QStringLiteral("selected"), calendar.selected);
            row.insert(QStringLiteral("hidden"), calendar.hidden);
            row.insert(QStringLiteral("primary"), calendar.primary);
            rows.append(std::move(row));
          }
          if (page.nextOffset.has_value()) {
            loadCalendarManagementRows(generation, *page.nextOffset, std::move(rows));
            return;
          }
          setCalendarManagementRows(std::move(rows));
        },
        false);
}

void AppController::refreshInvitations() {
  const std::uint64_t generation = ++invitationRefreshGeneration_;
  const auto milliseconds = std::chrono::duration_cast<std::chrono::milliseconds>(
      clock_.wallNow().time_since_epoch());
  const QDateTime current = QDateTime::fromMSecsSinceEpoch(milliseconds.count(), QTimeZone::UTC);
  watch(calendarReadService_.listEvents({.startAt = current.addDays(-1).toString(Qt::ISODateWithMs),
                                         .endAt = current.addDays(366).toString(Qt::ISODateWithMs),
                                         .limit = 25'000}),
        [this, generation](CalendarEventPageResult result) {
          if (generation != invitationRefreshGeneration_) {
            return;
          }
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
            return;
          }
          QVariantList rows;
          const CalendarEventPage page = std::get<CalendarEventPage>(std::move(result));
          for (const CalendarEventSummary& event : page.items) {
            QJsonParseError error;
            const QJsonDocument attendees =
                QJsonDocument::fromJson(event.attendeeDetailsJson.toUtf8(), &error);
            if (error.error != QJsonParseError::NoError || !attendees.isArray()) {
              continue;
            }
            QString response;
            QString comment;
            bool self = false;
            for (const QJsonValue& attendeeValue : attendees.array()) {
              if (!attendeeValue.isObject()) {
                continue;
              }
              const QJsonObject attendee = attendeeValue.toObject();
              if (attendee.value(QStringLiteral("self")).toBool()) {
                self = true;
                response = attendee.value(QStringLiteral("responseStatus")).toString();
                comment = attendee.value(QStringLiteral("comment")).toString();
                break;
              }
            }
            if (!self || response != QStringLiteral("needsAction")) {
              continue;
            }
            rows.append(QVariantMap{{QStringLiteral("eventId"), event.id},
                                    {QStringLiteral("calendarId"), event.calendarId},
                                    {QStringLiteral("title"), event.title},
                                    {QStringLiteral("startAt"), event.startAt},
                                    {QStringLiteral("allDay"), event.allDay},
                                    {QStringLiteral("comment"), comment}});
          }
          setInvitations(std::move(rows));
        },
        false);
}

void AppController::refreshCalendarEvents(QList<QString> calendarIds, std::uint64_t generation) {
  if (generation != calendarRefreshGeneration_) {
    return;
  }
  const QDate date = calendarDate_;
  const QTimeZone displayTimeZone(displayTimeZone_.toUtf8());
  const int firstDay = weekStartDay_;
  const auto applyLayouts = [this, generation](CalendarViewLayouts layouts) {
    if (generation != calendarRefreshGeneration_) {
      return;
    }
    agendaModel_.setEvents(std::move(layouts.agendaEvents));
    timelineModel_.applyLayout(std::move(layouts.timeline));
    monthGridModel_.applyLayout(std::move(layouts.month));
  };
  if (calendarIds.isEmpty()) {
    const QList<CalendarEventSummary> events;
    watch(std::async(std::launch::async,
                     [date, events, displayTimeZone, firstDay]() mutable {
                       return buildCalendarViewLayouts(
                           date, std::move(events), displayTimeZone, firstDay);
                     }),
          applyLayouts);
    return;
  }
  const QList<QString> cacheCalendarIds = calendarIds;
  watch(calendarReadService_.listEvents({.calendarIds = std::move(calendarIds),
                                         .startAt = calendarRangeStart(date, firstDay),
                                         .endAt = calendarRangeEnd(date, firstDay),
                                         .limit = 25'000}),
        [this, generation, date, displayTimeZone, firstDay, applyLayouts, cacheCalendarIds](
            CalendarEventPageResult result) {
          if (generation != calendarRefreshGeneration_) {
            return;
          }
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            CalendarEventPage page = std::get<CalendarEventPage>(std::move(result));
            if (page.nextOffset.has_value()) {
              setStatus(QStringLiteral("Calendar range is limited to the first %1 events")
                            .arg(page.items.size()));
            }
            QList<CalendarEventSummary> events = std::move(page.items);
            const qsizetype uncachedSeries = std::count_if(
                events.cbegin(), events.cend(), [](const CalendarEventSummary& event) {
                  return event.recurrenceRule.has_value() && !event.instanceRangeCached;
                });
            watch(std::async(std::launch::async,
                             [date, events = std::move(events), displayTimeZone, firstDay]() mutable {
                               return buildCalendarViewLayouts(
                                   date, std::move(events), displayTimeZone, firstDay);
                             }),
                  applyLayouts);
            if (uncachedSeries > 0 && !page.nextOffset.has_value()) {
              setStatus(googleConnected_
                            ? QStringLiteral("Loading Google recurrence for %1 series")
                                  .arg(uncachedSeries)
                            : QStringLiteral("Google recurrence cache may be stale for %1 series")
                                  .arg(uncachedSeries));
            }
            refreshCalendarInstanceCache(cacheCalendarIds, date, generation);
          }
        });
}

void AppController::refreshCalendarInstanceCache(QList<QString> calendarIds,
                                                 QDate date,
                                                 std::uint64_t generation) {
  if (generation != calendarRefreshGeneration_ || !googleConnected_ || credentialStore_ == nullptr) {
    return;
  }
  const QString rangeStartAt = calendarRangeStart(date, weekStartDay_);
  const QString rangeEndAt = calendarRangeEnd(date, weekStartDay_);
  QList<QString> refreshCalendarIds = calendarIds;
  QList<QString> resultCalendarIds = std::move(calendarIds);
  watch(
      std::async(std::launch::async,
                 [this,
                  calendarIds = std::move(refreshCalendarIds),
                  rangeStartAt,
                  rangeEndAt]() mutable -> GoogleCalendarInstanceCacheRefreshResultOrError {
                   OAuthCredentialReadResult read =
                       credentialStore_->read(QString::fromLatin1(kGoogleAccountId)).get();
                   if (std::holds_alternative<AppError>(read)) {
                     return std::get<AppError>(std::move(read));
                   }
                   std::optional<OAuthStoredCredential> stored =
                       std::get<std::optional<OAuthStoredCredential>>(std::move(read));
                   if (!stored.has_value() || stored->accessToken.isEmpty()) {
                     return AppError(AppErrorCode::Configuration,
                                     QStringLiteral("Google authorization must be renewed"));
                   }
                   return googleCalendarInstanceCacheService_
                       .refresh(QString::fromLatin1(kGoogleAccountId),
                                std::move(stored->accessToken),
                                {.calendarIds = std::move(calendarIds),
                                 .startAt = rangeStartAt,
                                 .endAt = rangeEndAt,
                                 .limit = 1'000})
                       .get();
                 }),
      [this, calendarIds = std::move(resultCalendarIds), date, generation](
          GoogleCalendarInstanceCacheRefreshResultOrError result) mutable {
        if (generation != calendarRefreshGeneration_) {
          return;
        }
        if (std::holds_alternative<AppError>(result)) {
          setStatus(QStringLiteral("Google recurrence cache: %1")
                        .arg(errorMessage(std::get<AppError>(std::move(result)))));
          return;
        }
        GoogleCalendarInstanceCacheRefreshResult refreshed =
            std::get<GoogleCalendarInstanceCacheRefreshResult>(std::move(result));
        if (refreshed.failed > 0) {
          setStatus(QStringLiteral("Google recurrence cache: %1 of %2 series unavailable%3")
                        .arg(refreshed.failed)
                        .arg(refreshed.requested)
                        .arg(refreshed.firstFailure.has_value()
                                 ? QStringLiteral(" (%1)").arg(*refreshed.firstFailure)
                                 : QString()));
        }
        if (refreshed.cached > 0 && date == calendarDate_) {
          refreshCalendarEvents(std::move(calendarIds), generation);
        }
      },
      false);
}

void AppController::setStatus(QString message) {
  if (statusMessage_ == message) {
    return;
  }
  statusMessage_ = std::move(message);
  emit statusMessageChanged();
}

void AppController::setTaskListError(QString message) {
  if (taskListErrorMessage_ == message) {
    return;
  }
  taskListErrorMessage_ = std::move(message);
  emit taskListErrorMessageChanged();
}

void AppController::setSyncStatus(QString status) {
  if (QThread::currentThread() != thread()) {
    static_cast<void>(QMetaObject::invokeMethod(
        this,
        [this, status = std::move(status)]() mutable { setSyncStatus(std::move(status)); },
        Qt::QueuedConnection));
    return;
  }
  if (syncStatus_ == status) {
    return;
  }
  syncStatus_ = std::move(status);
  emit syncStatusChanged();
}

void AppController::setUnresolvedConflicts(QList<SyncConflict> conflicts) {
  if (QThread::currentThread() != thread()) {
    static_cast<void>(QMetaObject::invokeMethod(
        this,
        [this, conflicts = std::move(conflicts)]() mutable {
          setUnresolvedConflicts(std::move(conflicts));
        },
        Qt::QueuedConnection));
    return;
  }
  QVariantList rows = conflictRows(std::move(conflicts));
  if (unresolvedConflicts_ == rows) {
    return;
  }
  unresolvedConflicts_ = std::move(rows);
  emit unresolvedConflictsChanged();
}

void AppController::setResolvedConflicts(QList<SyncConflict> conflicts) {
  if (QThread::currentThread() != thread()) {
    static_cast<void>(QMetaObject::invokeMethod(
        this,
        [this, conflicts = std::move(conflicts)]() mutable {
          setResolvedConflicts(std::move(conflicts));
        },
        Qt::QueuedConnection));
    return;
  }
  QVariantList rows = conflictRows(std::move(conflicts));
  if (resolvedConflicts_ == rows) {
    return;
  }
  resolvedConflicts_ = std::move(rows);
  emit resolvedConflictsChanged();
}

void AppController::setSearchError(QString message) {
  if (searchErrorMessage_ == message) {
    return;
  }
  searchErrorMessage_ = std::move(message);
  emit searchErrorMessageChanged();
}

void AppController::setSearchFilterChips(QStringList chips) {
  QVariantList values;
  values.reserve(chips.size());
  for (QString& chip : chips) {
    values.append(std::move(chip));
  }
  if (searchFilterChips_ == values) {
    return;
  }
  searchFilterChips_ = std::move(values);
  emit searchFilterChipsChanged();
}

void AppController::setSavedSearches(QList<SavedSearch> searches) {
  QVariantList rows = savedSearchRows(searches);
  if (savedSearchRows_ == rows) {
    return;
  }
  savedSearches_ = std::move(searches);
  savedSearchRows_ = std::move(rows);
  emit savedSearchesChanged();
}

void AppController::setSearchLoading(bool loading) {
  if (searchLoading_ == loading) {
    return;
  }
  searchLoading_ = loading;
  emit searchLoadingChanged();
}

void AppController::setBulkTaskStatusMessage(QString message) {
  if (bulkTaskStatusMessage_ == message) {
    return;
  }
  bulkTaskStatusMessage_ = std::move(message);
  emit bulkTaskStatusMessageChanged();
}

void AppController::setBulkEventStatusMessage(QString message) {
  if (bulkEventStatusMessage_ == message) {
    return;
  }
  bulkEventStatusMessage_ = std::move(message);
  emit bulkEventStatusMessageChanged();
}

void AppController::setBulkTaskPreviewMessage(QString message, int requestToken) {
  if (bulkTaskPreviewMessage_ != message) {
    bulkTaskPreviewMessage_ = std::move(message);
    emit bulkTaskPreviewMessageChanged();
  }
  if (bulkTaskPreviewRequestToken_ != requestToken) {
    bulkTaskPreviewRequestToken_ = requestToken;
    emit bulkTaskPreviewRequestTokenChanged();
  }
}

void AppController::setBulkEventPreviewMessage(QString message, int requestToken) {
  if (bulkEventPreviewMessage_ != message) {
    bulkEventPreviewMessage_ = std::move(message);
    emit bulkEventPreviewMessageChanged();
  }
  if (bulkEventPreviewRequestToken_ != requestToken) {
    bulkEventPreviewRequestToken_ = requestToken;
    emit bulkEventPreviewRequestTokenChanged();
  }
}

void AppController::setReminderStatusMessage(QString message) {
  if (reminderStatusMessage_ == message) {
    return;
  }
  reminderStatusMessage_ = std::move(message);
  emit reminderStatusMessageChanged();
}

void AppController::setInvitations(QVariantList invitations) {
  if (invitations_ == invitations) {
    return;
  }
  invitations_ = std::move(invitations);
  emit invitationsChanged();
}

void AppController::setCalendarManagementRows(QVariantList rows) {
  if (calendarManagementRows_ == rows) {
    return;
  }
  calendarManagementRows_ = std::move(rows);
  emit calendarManagementRowsChanged();
}

void AppController::setImportPreviewRows(QVariantList rows) {
  if (importPreviewRows_ == rows) {
    return;
  }
  importPreviewRows_ = std::move(rows);
  emit importPreviewRowsChanged();
}

void AppController::setImportSourceName(QString sourceName) {
  if (importSourceName_ == sourceName) {
    return;
  }
  importSourceName_ = std::move(sourceName);
  emit importSourceNameChanged();
}

void AppController::setBusy(bool busy) {
  if (busy_ == busy) {
    return;
  }
  busy_ = busy;
  emit busyChanged();
}

} // namespace hcb
