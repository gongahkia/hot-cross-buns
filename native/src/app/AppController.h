#pragma once

#include "core/CalendarMutationService.h"
#include "core/CalendarEventBulkMutationService.h"
#include "core/CalendarReadService.h"
#include "core/Cancellation.h"
#include "core/Clock.h"
#include "core/FilePath.h"
#include "core/GoogleCalendarEventPullClient.h"
#include "core/GoogleCalendarFreeBusyClient.h"
#include "core/GoogleCalendarInstanceCacheService.h"
#include "core/GoogleCalendarEventMutationPushService.h"
#include "core/GoogleCalendarListPullClient.h"
#include "core/GoogleCalendarManagementClient.h"
#include "core/GoogleCalendarMirrorSyncService.h"
#include "core/GoogleDriveFilePickerClient.h"
#include "core/GoogleHttpClient.h"
#include "core/GoogleMirrorStore.h"
#include "core/GoogleSyncRecoveryService.h"
#include "core/GoogleSyncConflictResolver.h"
#include "core/GoogleTaskListPullClient.h"
#include "core/GoogleTaskMirrorSyncService.h"
#include "core/GoogleTaskMutationPushService.h"
#include "core/GoogleTaskPullClient.h"
#include "core/LocalSearchService.h"
#include "core/AccountStatusService.h"
#include "core/OAuthBrowserAuthorizationLauncher.h"
#include "core/OAuthClientConfigurationStore.h"
#include "core/OAuthCredentialStore.h"
#include "core/OAuthLoopbackCallbackListener.h"
#include "core/OAuthTokenExchangeClient.h"
#include "core/OAuthTokenRefreshClient.h"
#include "core/OptimisticMutationCoordinator.h"
#include "core/PkceAuthorization.h"
#include "core/QuickCaptureParser.h"
#include "core/SyncCheckpointStore.h"
#include "core/SyncConflictStore.h"
#include "core/SettingsService.h"
#include "core/SavedSearchStore.h"
#include "core/SyncScheduler.h"
#include "core/TaskListReadService.h"
#include "core/TaskListMutationService.h"
#include "core/TaskBulkMutationService.h"
#include "core/TaskMutationService.h"
#include "core/TaskReadService.h"

#include <QObject>
#include <QDate>
#include <QString>
#include <QStringList>
#include <QTimer>
#include <QUrl>
#include <QVariantList>
#include <QVariantMap>

#include <chrono>
#include <cstdint>
#include <future>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <vector>

namespace hcb {

class AgendaModel;
class CalendarSourceModel;
class MonthGridModel;
class NotesModel;
class SearchResultsModel;
class ReminderService;
class TaskListModel;
class TaskModel;
class TimelineModel;

class AppController final : public QObject {
  Q_OBJECT
  Q_PROPERTY(QString clientId READ clientId NOTIFY clientIdChanged)
  Q_PROPERTY(bool googleConnected READ googleConnected NOTIFY googleConnectedChanged)
  Q_PROPERTY(QString statusMessage READ statusMessage NOTIFY statusMessageChanged)
  Q_PROPERTY(
      QString taskListErrorMessage READ taskListErrorMessage NOTIFY taskListErrorMessageChanged)
  Q_PROPERTY(QString syncStatus READ syncStatus NOTIFY syncStatusChanged)
  Q_PROPERTY(int conflictPolicy READ conflictPolicy NOTIFY conflictPolicyChanged)
  Q_PROPERTY(
      QVariantList unresolvedConflicts READ unresolvedConflicts NOTIFY unresolvedConflictsChanged)
  Q_PROPERTY(QVariantList resolvedConflicts READ resolvedConflicts NOTIFY resolvedConflictsChanged)
  Q_PROPERTY(QString searchQuery READ searchQuery NOTIFY searchQueryChanged)
  Q_PROPERTY(QString searchErrorMessage READ searchErrorMessage NOTIFY searchErrorMessageChanged)
  Q_PROPERTY(QVariantList searchFilterChips READ searchFilterChips NOTIFY searchFilterChipsChanged)
  Q_PROPERTY(QVariantList savedSearches READ savedSearches NOTIFY savedSearchesChanged)
  Q_PROPERTY(bool searchLoading READ searchLoading NOTIFY searchLoadingChanged)
  Q_PROPERTY(
      QString bulkTaskStatusMessage READ bulkTaskStatusMessage NOTIFY bulkTaskStatusMessageChanged)
  Q_PROPERTY(QString bulkEventStatusMessage READ bulkEventStatusMessage NOTIFY
                 bulkEventStatusMessageChanged)
  Q_PROPERTY(QString bulkTaskPreviewMessage READ bulkTaskPreviewMessage NOTIFY
                 bulkTaskPreviewMessageChanged)
  Q_PROPERTY(QString bulkEventPreviewMessage READ bulkEventPreviewMessage NOTIFY
                 bulkEventPreviewMessageChanged)
  Q_PROPERTY(int bulkTaskPreviewRequestToken READ bulkTaskPreviewRequestToken NOTIFY
                 bulkTaskPreviewRequestTokenChanged)
  Q_PROPERTY(int bulkEventPreviewRequestToken READ bulkEventPreviewRequestToken NOTIFY
                 bulkEventPreviewRequestTokenChanged)
  Q_PROPERTY(int bulkTextRecurrenceScope READ bulkTextRecurrenceScope NOTIFY
                 bulkTextRecurrenceScopeChanged)
  Q_PROPERTY(QString calendarDate READ calendarDate NOTIFY calendarDateChanged)
  Q_PROPERTY(int appearanceMode READ appearanceMode NOTIFY appearanceModeChanged)
  Q_PROPERTY(int visualDensity READ visualDensity NOTIFY visualDensityChanged)
  Q_PROPERTY(int paletteMode READ paletteMode NOTIFY paletteModeChanged)
  Q_PROPERTY(QString accentColor READ accentColor NOTIFY accentColorChanged)
  Q_PROPERTY(QString fontFamily READ fontFamily NOTIFY fontFamilyChanged)
  Q_PROPERTY(QVariantList availableFontFamilies READ availableFontFamilies CONSTANT)
  Q_PROPERTY(int fontScale READ fontScale NOTIFY fontScaleChanged)
  Q_PROPERTY(QString quickCaptureDefaultTaskListId READ quickCaptureDefaultTaskListId NOTIFY
                 quickCaptureDefaultTaskListIdChanged)
  Q_PROPERTY(QString quickCaptureDefaultCalendarId READ quickCaptureDefaultCalendarId NOTIFY
                 quickCaptureDefaultCalendarIdChanged)
  Q_PROPERTY(int quickCaptureEventDurationMinutes READ quickCaptureEventDurationMinutes NOTIFY
                 quickCaptureEventDurationMinutesChanged)
  Q_PROPERTY(bool quickCaptureRemoveParsedText READ quickCaptureRemoveParsedText NOTIFY
                 quickCaptureRemoveParsedTextChanged)
  Q_PROPERTY(QString quickCaptureTaskAliases READ quickCaptureTaskAliases NOTIFY
                 quickCaptureAliasesChanged)
  Q_PROPERTY(QString quickCaptureEventAliases READ quickCaptureEventAliases NOTIFY
                 quickCaptureAliasesChanged)
  Q_PROPERTY(QString quickCaptureHighPriorityAliases READ quickCaptureHighPriorityAliases NOTIFY
                 quickCaptureAliasesChanged)
  Q_PROPERTY(QString quickCaptureMediumPriorityAliases READ quickCaptureMediumPriorityAliases NOTIFY
                 quickCaptureAliasesChanged)
  Q_PROPERTY(QString quickCaptureLowPriorityAliases READ quickCaptureLowPriorityAliases NOTIFY
                 quickCaptureAliasesChanged)
  Q_PROPERTY(int weekStartDay READ weekStartDay NOTIFY weekStartDayChanged)
  Q_PROPERTY(bool use24HourTime READ use24HourTime NOTIFY use24HourTimeChanged)
  Q_PROPERTY(QString displayTimeZone READ displayTimeZone NOTIFY displayTimeZoneChanged)
  Q_PROPERTY(QVariantList availableTimeZones READ availableTimeZones CONSTANT)
  Q_PROPERTY(int workdayStartHour READ workdayStartHour NOTIFY workdayStartHourChanged)
  Q_PROPERTY(int workdayEndHour READ workdayEndHour NOTIFY workdayEndHourChanged)
  Q_PROPERTY(QVariantList visibleCalendarIds READ visibleCalendarIds NOTIFY visibleCalendarIdsChanged)
  Q_PROPERTY(bool calendarVisibilityConfigured READ calendarVisibilityConfigured NOTIFY
                 calendarVisibilityConfiguredChanged)
  Q_PROPERTY(QVariantList calendarManagementRows READ calendarManagementRows NOTIFY
                 calendarManagementRowsChanged)
  Q_PROPERTY(bool notesEnabled READ notesEnabled NOTIFY notesEnabledChanged)
  Q_PROPERTY(int notesProjectionMode READ notesProjectionMode NOTIFY notesProjectionModeChanged)
  Q_PROPERTY(QVariantList freeBusyIntervals READ freeBusyIntervals NOTIFY freeBusyIntervalsChanged)
  Q_PROPERTY(QVariantList driveAttachmentCandidates READ driveAttachmentCandidates NOTIFY
                 driveAttachmentCandidatesChanged)
  Q_PROPERTY(QVariantList invitations READ invitations NOTIFY invitationsChanged)
  Q_PROPERTY(int pendingInvitationCount READ pendingInvitationCount NOTIFY invitationsChanged)
  Q_PROPERTY(QString reminderStatusMessage READ reminderStatusMessage NOTIFY reminderStatusMessageChanged)
  Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)

public:
  AppController(FilePath databasePath,
                Clock& clock,
                AgendaModel& agendaModel,
                CalendarSourceModel& calendarSourceModel,
                MonthGridModel& monthGridModel,
                NotesModel& notesModel,
                TaskListModel& taskListModel,
                TaskModel& taskModel,
                TimelineModel& timelineModel,
                QObject* parent = nullptr);
  ~AppController() override;
  AppController(const AppController&) = delete;
  AppController& operator=(const AppController&) = delete;

  [[nodiscard]] QString clientId() const;
  [[nodiscard]] bool googleConnected() const;
  [[nodiscard]] QString statusMessage() const;
  [[nodiscard]] QString taskListErrorMessage() const;
  [[nodiscard]] QString syncStatus() const;
  [[nodiscard]] int conflictPolicy() const;
  [[nodiscard]] QVariantList unresolvedConflicts() const;
  [[nodiscard]] QVariantList resolvedConflicts() const;
  [[nodiscard]] QString searchQuery() const;
  [[nodiscard]] QString searchErrorMessage() const;
  [[nodiscard]] QVariantList searchFilterChips() const;
  [[nodiscard]] QVariantList savedSearches() const;
  [[nodiscard]] bool searchLoading() const;
  [[nodiscard]] QString bulkTaskStatusMessage() const;
  [[nodiscard]] QString bulkEventStatusMessage() const;
  [[nodiscard]] QString bulkTaskPreviewMessage() const;
  [[nodiscard]] QString bulkEventPreviewMessage() const;
  [[nodiscard]] int bulkTaskPreviewRequestToken() const;
  [[nodiscard]] int bulkEventPreviewRequestToken() const;
  [[nodiscard]] int bulkTextRecurrenceScope() const;
  [[nodiscard]] QString calendarDate() const;
  [[nodiscard]] int appearanceMode() const;
  [[nodiscard]] int visualDensity() const;
  [[nodiscard]] int paletteMode() const;
  [[nodiscard]] QString accentColor() const;
  [[nodiscard]] QString fontFamily() const;
  [[nodiscard]] QVariantList availableFontFamilies() const;
  [[nodiscard]] int fontScale() const;
  [[nodiscard]] QString quickCaptureDefaultTaskListId() const;
  [[nodiscard]] QString quickCaptureDefaultCalendarId() const;
  [[nodiscard]] int quickCaptureEventDurationMinutes() const;
  [[nodiscard]] bool quickCaptureRemoveParsedText() const;
  [[nodiscard]] QString quickCaptureTaskAliases() const;
  [[nodiscard]] QString quickCaptureEventAliases() const;
  [[nodiscard]] QString quickCaptureHighPriorityAliases() const;
  [[nodiscard]] QString quickCaptureMediumPriorityAliases() const;
  [[nodiscard]] QString quickCaptureLowPriorityAliases() const;
  [[nodiscard]] int weekStartDay() const;
  [[nodiscard]] bool use24HourTime() const;
  [[nodiscard]] QString displayTimeZone() const;
  [[nodiscard]] QVariantList availableTimeZones() const;
  [[nodiscard]] int workdayStartHour() const;
  [[nodiscard]] int workdayEndHour() const;
  [[nodiscard]] QVariantList visibleCalendarIds() const;
  [[nodiscard]] bool calendarVisibilityConfigured() const;
  [[nodiscard]] QVariantList calendarManagementRows() const;
  [[nodiscard]] bool notesEnabled() const;
  [[nodiscard]] int notesProjectionMode() const;
  [[nodiscard]] QVariantList freeBusyIntervals() const;
  [[nodiscard]] QVariantList driveAttachmentCandidates() const;
  [[nodiscard]] QVariantList invitations() const;
  [[nodiscard]] int pendingInvitationCount() const;
  [[nodiscard]] QString reminderStatusMessage() const;
  [[nodiscard]] bool busy() const;
  [[nodiscard]] SearchResultsModel& searchResultsModel();

  Q_INVOKABLE void initialize();
  void setReminderService(ReminderService* service);
  Q_INVOKABLE void refresh();
  Q_INVOKABLE void setCalendarDate(QString date);
  Q_INVOKABLE void saveAppearanceMode(int mode);
  Q_INVOKABLE void saveVisualDensity(int density);
  Q_INVOKABLE void savePaletteMode(int mode);
  Q_INVOKABLE void saveAccentColor(QString color);
  Q_INVOKABLE void saveFontFamily(QString family);
  Q_INVOKABLE void saveFontScale(int scale);
  Q_INVOKABLE void saveBulkTextRecurrenceScope(int scope);
  Q_INVOKABLE void resetVisualPreferences();
  Q_INVOKABLE QVariantMap previewQuickCapture(QString text, int kind, QVariantList disabledRecognitionIds) const;
  Q_INVOKABLE void createQuickCapture(QString text,
                                      int kind,
                                      QString destinationId,
                                      QVariantList disabledRecognitionIds);
  Q_INVOKABLE void saveQuickCaptureDefaultTaskListId(QString taskListId);
  Q_INVOKABLE void saveQuickCaptureDefaultCalendarId(QString calendarId);
  Q_INVOKABLE void saveQuickCaptureEventDurationMinutes(int minutes);
  Q_INVOKABLE void saveQuickCaptureRemoveParsedText(bool enabled);
  Q_INVOKABLE void saveQuickCaptureAliases(QString taskAliases,
                                           QString eventAliases,
                                           QString highPriorityAliases,
                                           QString mediumPriorityAliases,
                                           QString lowPriorityAliases);
  Q_INVOKABLE void saveWeekStartDay(int day);
  Q_INVOKABLE void saveUse24HourTime(bool enabled);
  Q_INVOKABLE void saveDisplayTimeZone(QString timeZone);
  Q_INVOKABLE QVariantMap dateTimeComponents(QString value, QString timeZone) const;
  Q_INVOKABLE QString dateTimeFromComponents(int year,
                                             int month,
                                             int day,
                                             int hour,
                                             int minute,
                                             QString timeZone) const;
  Q_INVOKABLE void saveWorkdayHours(int startHour, int endHour);
  Q_INVOKABLE void saveCalendarVisibility(QVariantList calendarIds);
  Q_INVOKABLE void createGoogleCalendar(QString title, QString description, QString timeZone);
  Q_INVOKABLE void subscribeGoogleCalendar(QString calendarId);
  Q_INVOKABLE void updateGoogleCalendar(QString calendarId,
                                        QString title,
                                        QString description,
                                        QString timeZone);
  Q_INVOKABLE void deleteGoogleCalendar(QString calendarId);
  Q_INVOKABLE void updateGoogleCalendarListEntry(QString calendarId,
                                                 bool selected,
                                                 bool hidden,
                                                 QString colorId);
  Q_INVOKABLE void unsubscribeGoogleCalendar(QString calendarId);
  Q_INVOKABLE void queryGoogleFreeBusy(QVariantList calendarIds, QString startAt, QString endAt);
  Q_INVOKABLE void searchGoogleDriveAttachments(QString query);
  Q_INVOKABLE void saveClientId(QString clientId);
  Q_INVOKABLE void connectGoogle();
  Q_INVOKABLE void syncGoogle();
  Q_INVOKABLE void saveConflictPolicy(int policy);
  Q_INVOKABLE void saveNotesEnabled(bool enabled);
  Q_INVOKABLE void saveNotesProjectionMode(int mode);
  Q_INVOKABLE void resolveSyncConflict(QString conflictId, bool keepLocal);
  Q_INVOKABLE void setSearchQuery(QString query);
  Q_INVOKABLE void applySavedSearch(QString savedSearchId);
  Q_INVOKABLE void saveSearch(QString name, QString query);
  Q_INVOKABLE void renameSavedSearch(QString savedSearchId, QString name);
  Q_INVOKABLE void deleteSavedSearch(QString savedSearchId);
  Q_INVOKABLE void createTaskList(QString title);
  Q_INVOKABLE void renameTaskList(QString taskListId, QString title);
  Q_INVOKABLE void setTaskListSelected(QString taskListId, bool selected);
  Q_INVOKABLE void deleteTaskList(QString taskListId);
  Q_INVOKABLE void createTask(QString taskListId, QString parentTaskId, QString title);
  Q_INVOKABLE void createTaskDetailed(QString taskListId,
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
                                      QString recurrenceRule = {},
                                      QString exclusionDates = {},
                                      QString additionDates = {});
  Q_INVOKABLE void saveNoteTask(QString taskId, QString taskListId, QString title, QString notes);
  Q_INVOKABLE void updateTask(QString taskId,
                              QString title,
                              QString notes,
                              QString dueAt,
                              QString dueTimeZone,
                              int priority);
  Q_INVOKABLE void updateTaskDetailed(QString taskId,
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
                                      QString recurrenceRule = {},
                                      QString exclusionDates = {},
                                      QString additionDates = {});
  Q_INVOKABLE void setTaskCompleted(QString taskId, bool completed);
  Q_INVOKABLE void stopTaskRecurrence(QString taskId, int recurrenceScope);
  Q_INVOKABLE void splitTaskRecurrence(QString taskId);
  Q_INVOKABLE void deleteTask(QString taskId);
  Q_INVOKABLE void moveTask(QString taskId, QString taskListId);
  Q_INVOKABLE void reparentTask(QString taskId, QString parentTaskId);
  Q_INVOKABLE void reorderTask(QString taskId, bool earlier);
  Q_INVOKABLE void bulkSetTaskCompleted(QVariantList taskIds, bool completed);
  Q_INVOKABLE void bulkDeleteTasks(QVariantList taskIds);
  Q_INVOKABLE void bulkMoveTasks(QVariantList taskIds, QString taskListId);
  Q_INVOKABLE void bulkSetTaskDue(QVariantList taskIds, QString dueAt);
  Q_INVOKABLE void bulkClearTaskDue(QVariantList taskIds);
  Q_INVOKABLE void bulkSetTaskPriority(QVariantList taskIds, int priority);
  Q_INVOKABLE void bulkReparentTasks(QVariantList taskIds, QString parentTaskId);
  Q_INVOKABLE void bulkReplaceTaskText(QVariantList taskIds,
                                       QString findText,
                                       QString replaceText,
                                       int fields,
                                       int recurrenceScope);
  Q_INVOKABLE void previewBulkTaskText(QVariantList taskIds,
                                       QString findText,
                                       int fields,
                                       int recurrenceScope,
                                       int requestToken);
  Q_INVOKABLE void createEvent(QString calendarId,
                               QString title,
                               QString startAt,
                               QString endAt,
                               bool allDay,
                               QString description,
                               QString location);
  Q_INVOKABLE void updateEvent(QString eventId,
                               QString calendarId,
                               QString title,
                               QString startAt,
                               QString endAt,
                               bool allDay,
                               QString description,
                               QString location);
  Q_INVOKABLE void createEventDetailed(QString calendarId,
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
                                       QString sendUpdates);
  Q_INVOKABLE void updateEventDetailed(QString eventId,
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
                                       QString sendUpdates);
  Q_INVOKABLE void deleteEvent(QString eventId, int recurrenceScope = 0);
  Q_INVOKABLE void respondToEvent(QString eventId, QString responseStatus, QString responseComment = {});
  Q_INVOKABLE void moveEvent(QString eventId, QString startAt, QString endAt, bool allDay);
  Q_INVOKABLE void resizeEvent(QString eventId, QString endAt);
  Q_INVOKABLE void bulkDeleteEvents(QVariantList eventIds);
  Q_INVOKABLE void bulkMoveEvents(QVariantList eventIds, QString calendarId);
  Q_INVOKABLE void bulkSetEventColor(QVariantList eventIds, QString colorId);
  Q_INVOKABLE void bulkSetEventAvailability(QVariantList eventIds, bool available);
  Q_INVOKABLE void bulkSetEventVisibility(QVariantList eventIds, QString visibility);
  Q_INVOKABLE void bulkShiftEventTimes(QVariantList eventIds, int shiftMinutes);
  Q_INVOKABLE void bulkReplaceEventText(QVariantList eventIds,
                                        QString findText,
                                        QString replaceText,
                                        int fields,
                                        int recurrenceScope);
  Q_INVOKABLE void previewBulkEventText(QVariantList eventIds,
                                        QString findText,
                                        int fields,
                                        int recurrenceScope,
                                        int requestToken);

signals:
  void clientIdChanged();
  void googleConnectedChanged();
  void statusMessageChanged();
  void taskListErrorMessageChanged();
  void syncStatusChanged();
  void conflictPolicyChanged();
  void unresolvedConflictsChanged();
  void resolvedConflictsChanged();
  void searchQueryChanged();
  void searchErrorMessageChanged();
  void searchFilterChipsChanged();
  void savedSearchesChanged();
  void searchLoadingChanged();
  void bulkTaskStatusMessageChanged();
  void bulkEventStatusMessageChanged();
  void bulkTaskPreviewMessageChanged();
  void bulkEventPreviewMessageChanged();
  void bulkTaskPreviewRequestTokenChanged();
  void bulkEventPreviewRequestTokenChanged();
  void bulkTextRecurrenceScopeChanged();
  void calendarDateChanged();
  void appearanceModeChanged();
  void visualDensityChanged();
  void paletteModeChanged();
  void accentColorChanged();
  void fontFamilyChanged();
  void fontScaleChanged();
  void quickCaptureDefaultTaskListIdChanged();
  void quickCaptureDefaultCalendarIdChanged();
  void quickCaptureEventDurationMinutesChanged();
  void quickCaptureRemoveParsedTextChanged();
  void quickCaptureAliasesChanged();
  void weekStartDayChanged();
  void use24HourTimeChanged();
  void displayTimeZoneChanged();
  void workdayStartHourChanged();
  void workdayEndHourChanged();
  void visibleCalendarIdsChanged();
  void calendarVisibilityConfiguredChanged();
  void calendarManagementRowsChanged();
  void notesEnabledChanged();
  void notesProjectionModeChanged();
  void freeBusyIntervalsChanged();
  void driveAttachmentCandidatesChanged();
  void invitationsChanged();
  void reminderStatusMessageChanged();
  void busyChanged();

private:
  class PendingOperation {
  public:
    virtual ~PendingOperation() = default;
    [[nodiscard]] virtual bool poll() = 0;
    [[nodiscard]] virtual bool affectsBusy() const = 0;
  };

  template <typename Result> class PendingFuture final : public PendingOperation {
  public:
    PendingFuture(std::future<Result> future,
                  std::function<void(Result)> completed,
                  bool affectsBusy)
        : future_(std::move(future)), completed_(std::move(completed)), affectsBusy_(affectsBusy) {}

    [[nodiscard]] bool poll() override {
      if (future_.wait_for(std::chrono::seconds{0}) != std::future_status::ready) {
        return false;
      }
      completed_(future_.get());
      return true;
    }

    [[nodiscard]] bool affectsBusy() const override { return affectsBusy_; }

  private:
    std::future<Result> future_;
    std::function<void(Result)> completed_;
    bool affectsBusy_{true};
  };

  template <typename Result, typename Completion>
  void watch(std::future<Result> future, Completion&& completed, bool affectsBusy = true) {
    std::function<void(Result)> callback(std::forward<Completion>(completed));
    pending_.push_back(std::make_unique<PendingFuture<Result>>(
        std::move(future), std::move(callback), affectsBusy));
    if (affectsBusy) {
      setBusy(true);
    }
    schedulePoll();
  }

  void schedulePoll();
  void pollPending();
  void refreshTasks();
  void refreshCalendar();
  void loadCalendarManagementRows(std::uint64_t generation,
                                  std::int64_t offset,
                                  QVariantList rows);
  void refreshCalendarEvents(QList<QString> calendarIds, std::uint64_t generation);
  void refreshInvitations();
  void refreshCalendarInstanceCache(QList<QString> calendarIds,
                                    QDate date,
                                    std::uint64_t generation);
  void runSearch();
  void refreshSearchProjection();
  void applyTaskProjections(QList<TaskModelTask> tasks);
  void loadSavedSearches();
  void runBulkTaskMutation(TaskBulkMutationInput input);
  void runBulkEventMutation(CalendarEventBulkMutationInput input);
  void previewBulkTaskMutation(TaskBulkMutationInput input, int requestToken);
  void previewBulkEventMutation(CalendarEventBulkMutationInput input, int requestToken);
  void handleOAuthCallback(OAuthLoopbackCallback callback);
  void finishOAuthConnection(std::uint64_t requestId, OAuthTokenSet tokenSet);
  void requestGoogleSync(SyncScheduleTrigger trigger);
  void startPeriodicGoogleSync();
  [[nodiscard]] std::optional<AppError> runGoogleSync(const SyncSchedulerRequest& request);
  [[nodiscard]] std::future<GoogleMirrorWriteResult> pullGoogleData(QString accessToken);
  void setStatus(QString message);
  void setTaskListError(QString message);
  void setSyncStatus(QString status);
  void setUnresolvedConflicts(QList<SyncConflict> conflicts);
  void setResolvedConflicts(QList<SyncConflict> conflicts);
  void setSearchError(QString message);
  void setSearchFilterChips(QStringList chips);
  void setSavedSearches(QList<SavedSearch> searches);
  void setSearchLoading(bool loading);
  void setBulkTaskStatusMessage(QString message);
  void setBulkEventStatusMessage(QString message);
  void setBulkTaskPreviewMessage(QString message, int requestToken);
  void setBulkEventPreviewMessage(QString message, int requestToken);
  void setReminderStatusMessage(QString message);
  void setInvitations(QVariantList invitations);
  void setCalendarManagementRows(QVariantList rows);
  void setBusy(bool busy);
  [[nodiscard]] QuickCaptureAliases quickCaptureAliasesConfiguration() const;
  [[nodiscard]] QuickCaptureParseResult quickCaptureParse(QString text,
                                                           int kind,
                                                           QVariantList disabledRecognitionIds) const;

  Clock& clock_;
  AgendaModel& agendaModel_;
  CalendarSourceModel& calendarSourceModel_;
  MonthGridModel& monthGridModel_;
  NotesModel& notesModel_;
  TaskListModel& taskListModel_;
  TaskModel& taskModel_;
  TimelineModel& timelineModel_;
  OAuthClientConfigurationStore oauthConfigurationStore_;
  AccountStatusService accountStatusService_;
  std::unique_ptr<OAuthCredentialStore> credentialStore_;
  OAuthLoopbackCallbackListener oauthLoopbackListener_;
  OAuthTokenExchangeClient oauthTokenExchangeClient_;
  OAuthTokenRefreshClient oauthTokenRefreshClient_;
  OAuthBrowserAuthorizationLauncher oauthBrowserAuthorizationLauncher_;
  PkceStateRegistry pkceStateRegistry_;
  GoogleHttpClient googleHttpClient_;
  GoogleTaskListPullClient googleTaskListPullClient_;
  GoogleTaskPullClient googleTaskPullClient_;
  GoogleCalendarListPullClient googleCalendarListPullClient_;
  GoogleCalendarManagementClient googleCalendarManagementClient_;
  GoogleCalendarFreeBusyClient googleCalendarFreeBusyClient_;
  GoogleDriveFilePickerClient googleDriveFilePickerClient_;
  GoogleCalendarEventPullClient googleCalendarEventPullClient_;
  GoogleMirrorStore googleMirrorStore_;
  SettingsService settingsService_;
  SavedSearchStore savedSearchStore_;
  OptimisticMutationCoordinator optimisticMutationCoordinator_;
  SyncCheckpointStore syncCheckpointStore_;
  SyncConflictStore syncConflictStore_;
  GoogleSyncConflictResolver googleSyncConflictResolver_;
  TaskMutationService taskMutationService_;
  TaskBulkMutationService taskBulkMutationService_;
  TaskListMutationService taskListMutationService_;
  CalendarMutationService calendarMutationService_;
  CalendarEventBulkMutationService calendarEventBulkMutationService_;
  GoogleSyncRecoveryService googleSyncRecoveryService_;
  GoogleTaskMutationPushService googleTaskMutationPushService_;
  GoogleCalendarEventMutationPushService googleCalendarEventMutationPushService_;
  TaskListReadService taskListReadService_;
  TaskReadService taskReadService_;
  CalendarReadService calendarReadService_;
  GoogleCalendarInstanceCacheService googleCalendarInstanceCacheService_;
  LocalSearchService localSearchService_;
  SearchResultsModel* searchResultsModelPointer_{nullptr};
  GoogleTaskMirrorSyncService googleTaskMirrorSyncService_;
  GoogleCalendarMirrorSyncService googleCalendarMirrorSyncService_;
  SyncScheduler syncScheduler_;
  std::mutex syncConfigurationMutex_;
  QString syncClientId_;
  QString clientId_;
  bool googleConnected_{false};
  QString statusMessage_;
  QString taskListErrorMessage_;
  QString syncStatus_{QStringLiteral("idle")};
  int conflictPolicy_{static_cast<int>(SyncConflictPolicy::PreferGoogle)};
  QVariantList unresolvedConflicts_;
  QVariantList resolvedConflicts_;
  QString searchQuery_;
  QString searchErrorMessage_;
  QVariantList searchFilterChips_;
  QList<SavedSearch> savedSearches_;
  QVariantList savedSearchRows_;
  bool searchLoading_{false};
  QString bulkTaskStatusMessage_;
  QString bulkEventStatusMessage_;
  QString bulkTaskPreviewMessage_;
  QString bulkEventPreviewMessage_;
  int bulkTaskPreviewRequestToken_{-1};
  int bulkEventPreviewRequestToken_{-1};
  int latestTaskPreviewRequestToken_{-1};
  int latestEventPreviewRequestToken_{-1};
  int bulkTextRecurrenceScope_{2};
  QDate calendarDate_{QDate::currentDate()};
  int appearanceMode_{0};
  int visualDensity_{1};
  int paletteMode_{0};
  QString accentColor_;
  QString fontFamily_;
  int fontScale_{1};
  QString quickCaptureDefaultTaskListId_;
  QString quickCaptureDefaultCalendarId_;
  int quickCaptureEventDurationMinutes_{30};
  bool quickCaptureRemoveParsedText_{false};
  QStringList quickCaptureTaskAliases_{QuickCaptureParser::defaultAliases().task};
  QStringList quickCaptureEventAliases_{QuickCaptureParser::defaultAliases().event};
  QStringList quickCaptureHighPriorityAliases_{QuickCaptureParser::defaultAliases().highPriority};
  QStringList quickCaptureMediumPriorityAliases_{QuickCaptureParser::defaultAliases().mediumPriority};
  QStringList quickCaptureLowPriorityAliases_{QuickCaptureParser::defaultAliases().lowPriority};
  int weekStartDay_{0};
  bool use24HourTime_{true};
  QString displayTimeZone_{QString::fromUtf8(QTimeZone::systemTimeZoneId())};
  int workdayStartHour_{9};
  int workdayEndHour_{17};
  QVariantList visibleCalendarIds_;
  bool calendarVisibilityConfigured_{false};
  QVariantList calendarManagementRows_;
  bool notesEnabled_{false};
  int notesProjectionMode_{0};
  QVariantList freeBusyIntervals_;
  QVariantList driveAttachmentCandidates_;
  QVariantList invitations_;
  std::uint64_t invitationRefreshGeneration_{0};
  ReminderService* reminderService_{nullptr};
  QString reminderStatusMessage_{QStringLiteral("Calendar reminders are initializing")};
  QList<TaskModelTask> taskProjectionTasks_;
  std::uint64_t calendarRefreshGeneration_{0};
  QTimer searchDebounce_;
  std::unique_ptr<CancellationSource> searchCancellation_;
  std::uint64_t searchGeneration_{0};
  bool busy_{false};
  bool pollScheduled_{false};
  std::vector<std::unique_ptr<PendingOperation>> pending_;
};

} // namespace hcb
