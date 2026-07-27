#pragma once

#include "core/CalendarMutationService.h"
#include "core/CalendarEventBulkMutationService.h"
#include "core/CalendarReadService.h"
#include "core/Cancellation.h"
#include "core/Clock.h"
#include "core/FilePath.h"
#include "core/GoogleCalendarEventPullClient.h"
#include "core/GoogleCalendarInstanceCacheService.h"
#include "core/GoogleCalendarEventMutationPushService.h"
#include "core/GoogleCalendarListPullClient.h"
#include "core/GoogleCalendarMirrorSyncService.h"
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
#include <QTimer>
#include <QUrl>
#include <QVariantList>

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
  Q_PROPERTY(QString calendarDate READ calendarDate NOTIFY calendarDateChanged)
  Q_PROPERTY(bool notesEnabled READ notesEnabled NOTIFY notesEnabledChanged)
  Q_PROPERTY(int notesProjectionMode READ notesProjectionMode NOTIFY notesProjectionModeChanged)
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
  [[nodiscard]] QString calendarDate() const;
  [[nodiscard]] bool notesEnabled() const;
  [[nodiscard]] int notesProjectionMode() const;
  [[nodiscard]] bool busy() const;
  [[nodiscard]] SearchResultsModel& searchResultsModel();

  Q_INVOKABLE void initialize();
  Q_INVOKABLE void refresh();
  Q_INVOKABLE void setCalendarDate(QString date);
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
                                      int recurrenceEndCount);
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
                                      int recurrenceEndCount);
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
                                       QString recurrenceRule);
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
                                       int recurrenceScope);
  Q_INVOKABLE void deleteEvent(QString eventId, int recurrenceScope = 0);
  Q_INVOKABLE void moveEvent(QString eventId, QString startAt, QString endAt, bool allDay);
  Q_INVOKABLE void resizeEvent(QString eventId, QString endAt);
  Q_INVOKABLE void bulkDeleteEvents(QVariantList eventIds);
  Q_INVOKABLE void bulkMoveEvents(QVariantList eventIds, QString calendarId);
  Q_INVOKABLE void bulkSetEventColor(QVariantList eventIds, QString colorId);
  Q_INVOKABLE void bulkSetEventAvailability(QVariantList eventIds, bool available);
  Q_INVOKABLE void bulkSetEventVisibility(QVariantList eventIds, QString visibility);
  Q_INVOKABLE void bulkShiftEventTimes(QVariantList eventIds, int shiftMinutes);

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
  void calendarDateChanged();
  void notesEnabledChanged();
  void notesProjectionModeChanged();
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
  void refreshCalendarEvents(QList<QString> calendarIds, std::uint64_t generation);
  void refreshCalendarInstanceCache(QList<QString> calendarIds,
                                    QDate date,
                                    std::uint64_t generation);
  void runSearch();
  void refreshSearchProjection();
  void applyTaskProjections(QList<TaskModelTask> tasks);
  void loadSavedSearches();
  void runBulkTaskMutation(TaskBulkMutationInput input);
  void runBulkEventMutation(CalendarEventBulkMutationInput input);
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
  void setBusy(bool busy);

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
  QDate calendarDate_{QDate::currentDate()};
  bool notesEnabled_{false};
  int notesProjectionMode_{0};
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
