#pragma once

#include "core/CalendarMutationService.h"
#include "core/CalendarReadService.h"
#include "core/Clock.h"
#include "core/FilePath.h"
#include "core/GoogleCalendarEventPullClient.h"
#include "core/GoogleCalendarListPullClient.h"
#include "core/GoogleHttpClient.h"
#include "core/GoogleMirrorStore.h"
#include "core/GoogleTaskListPullClient.h"
#include "core/GoogleTaskPullClient.h"
#include "core/NoteService.h"
#include "core/AccountStatusService.h"
#include "core/OAuthBrowserAuthorizationLauncher.h"
#include "core/OAuthClientConfigurationStore.h"
#include "core/OAuthCredentialStore.h"
#include "core/OAuthLoopbackCallbackListener.h"
#include "core/OAuthTokenExchangeClient.h"
#include "core/OAuthTokenRefreshClient.h"
#include "core/PkceAuthorization.h"
#include "core/TaskListReadService.h"
#include "core/TaskMutationService.h"
#include "core/TaskReadService.h"

#include <QObject>
#include <QString>
#include <QUrl>

#include <chrono>
#include <future>
#include <functional>
#include <memory>
#include <optional>
#include <vector>

namespace hcb {

class AgendaModel;
class CalendarSourceModel;
class MonthGridModel;
class NotesModel;
class TaskListModel;
class TaskModel;
class TimelineModel;

class AppController final : public QObject {
  Q_OBJECT
  Q_PROPERTY(QString clientId READ clientId NOTIFY clientIdChanged)
  Q_PROPERTY(bool googleConnected READ googleConnected NOTIFY googleConnectedChanged)
  Q_PROPERTY(QString statusMessage READ statusMessage NOTIFY statusMessageChanged)
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
  AppController(const AppController&) = delete;
  AppController& operator=(const AppController&) = delete;

  [[nodiscard]] QString clientId() const;
  [[nodiscard]] bool googleConnected() const;
  [[nodiscard]] QString statusMessage() const;
  [[nodiscard]] bool busy() const;

  Q_INVOKABLE void initialize();
  Q_INVOKABLE void refresh();
  Q_INVOKABLE void saveClientId(QString clientId);
  Q_INVOKABLE void connectGoogle();
  Q_INVOKABLE void syncGoogle();
  Q_INVOKABLE void createTask(QString taskListId, QString parentTaskId, QString title);
  Q_INVOKABLE void updateTask(QString taskId,
                              QString title,
                              QString notes,
                              QString dueAt,
                              QString dueTimeZone,
                              int priority);
  Q_INVOKABLE void setTaskCompleted(QString taskId, bool completed);
  Q_INVOKABLE void deleteTask(QString taskId);
  Q_INVOKABLE void moveTask(QString taskId, QString taskListId);
  Q_INVOKABLE void reparentTask(QString taskId, QString parentTaskId);
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
  Q_INVOKABLE void deleteEvent(QString eventId);
  Q_INVOKABLE void moveEvent(QString eventId, QString startAt, QString endAt, bool allDay);
  Q_INVOKABLE void resizeEvent(QString eventId, QString endAt);

signals:
  void clientIdChanged();
  void googleConnectedChanged();
  void statusMessageChanged();
  void busyChanged();

private:
  class PendingOperation {
  public:
    virtual ~PendingOperation() = default;
    [[nodiscard]] virtual bool poll() = 0;
  };

  template <typename Result> class PendingFuture final : public PendingOperation {
  public:
    PendingFuture(std::future<Result> future, std::function<void(Result)> completed)
        : future_(std::move(future)), completed_(std::move(completed)) {}

    [[nodiscard]] bool poll() override {
      if (future_.wait_for(std::chrono::seconds{0}) != std::future_status::ready) {
        return false;
      }
      completed_(future_.get());
      return true;
    }

  private:
    std::future<Result> future_;
    std::function<void(Result)> completed_;
  };

  template <typename Result, typename Completion>
  void watch(std::future<Result> future, Completion&& completed) {
    std::function<void(Result)> callback(std::forward<Completion>(completed));
    pending_.push_back(
        std::make_unique<PendingFuture<Result>>(std::move(future), std::move(callback)));
    setBusy(true);
    schedulePoll();
  }

  void schedulePoll();
  void pollPending();
  void refreshTasks();
  void refreshCalendar();
  void refreshCalendarEvents(QList<QString> calendarIds);
  void handleOAuthCallback(OAuthLoopbackCallback callback);
  void finishOAuthConnection(std::uint64_t requestId, OAuthTokenSet tokenSet);
  [[nodiscard]] std::future<GoogleMirrorWriteResult> pullGoogleData(QString accessToken);
  void finishGoogleSync(GoogleMirrorWriteResult result);
  void setStatus(QString message);
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
  TaskListReadService taskListReadService_;
  TaskReadService taskReadService_;
  NoteService noteService_;
  CalendarReadService calendarReadService_;
  TaskMutationService taskMutationService_;
  CalendarMutationService calendarMutationService_;
  QString clientId_;
  bool googleConnected_{false};
  bool googleSyncInProgress_{false};
  QString statusMessage_;
  bool busy_{false};
  bool pollScheduled_{false};
  std::vector<std::unique_ptr<PendingOperation>> pending_;
};

} // namespace hcb
