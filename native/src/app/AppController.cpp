#include "app/AppController.h"

#include "app/LinuxCredentialAdapter.h"
#include "app/MacOSCredentialAdapter.h"
#include "app/WindowsCredentialAdapter.h"

#include "core/AgendaModel.h"
#include "core/CalendarSourceModel.h"
#include "core/MonthGridModel.h"
#include "core/NotesModel.h"
#include "core/TaskListModel.h"
#include "core/TaskModel.h"
#include "core/TimelineModel.h"

#include <QDate>
#include <QDateTime>
#include <QTimeZone>
#include <QTimer>
#include <QUrlQuery>

#include <algorithm>
#include <chrono>
#include <optional>
#include <utility>
#include <variant>

namespace hcb {
namespace {

constexpr int kCalendarTimelineDays = 7;
constexpr int kVisibleAllDayLaneCount = 2;
constexpr char kGoogleAccountId[] = "google";

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
          QStringLiteral("https://www.googleapis.com/auth/calendar")};
}

[[nodiscard]] QString authenticationTimestamp(const Clock& clock) {
  const auto milliseconds =
      std::chrono::duration_cast<std::chrono::milliseconds>(clock.wallNow().time_since_epoch());
  return QDateTime::fromMSecsSinceEpoch(milliseconds.count(), QTimeZone::UTC)
      .toString(Qt::ISODateWithMs);
}

[[nodiscard]] QString errorMessage(const AppError& error) { return error.message(); }

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

[[nodiscard]] QString rangeStart(const QDate& today) {
  return QDateTime(today.addMonths(-1), QTime(0, 0), QTimeZone::UTC).toString(Qt::ISODateWithMs);
}

[[nodiscard]] QString rangeEnd(const QDate& today) {
  return QDateTime(today.addMonths(3), QTime(0, 0), QTimeZone::UTC).toString(Qt::ISODateWithMs);
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
      googleCalendarEventPullClient_(googleHttpClient_), googleMirrorStore_(databasePath, clock),
      taskListReadService_(databasePath), taskReadService_(databasePath),
      noteService_(databasePath, clock), calendarReadService_(databasePath),
      taskMutationService_(databasePath, clock),
      calendarMutationService_(std::move(databasePath), clock) {
  connect(&oauthLoopbackListener_,
          &OAuthLoopbackCallbackListener::callbackReceived,
          this,
          &AppController::handleOAuthCallback);
}

QString AppController::clientId() const { return clientId_; }

bool AppController::googleConnected() const { return googleConnected_; }

QString AppController::statusMessage() const { return statusMessage_; }

bool AppController::busy() const { return busy_; }

void AppController::initialize() {
  watch(oauthConfigurationStore_.load(), [this](OAuthClientConfigurationReadResult result) {
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(result)));
    } else if (const std::optional<OAuthClientConfiguration>& configuration =
                   std::get<std::optional<OAuthClientConfiguration>>(result);
               configuration.has_value()) {
      clientId_ = configuration->clientId;
      emit clientIdChanged();
      if (googleConnected_) {
        syncGoogle();
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
              syncGoogle();
            }
          }
        });
  refresh();
}

void AppController::refresh() {
  refreshTasks();
  refreshCalendar();
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
  if (googleSyncInProgress_) {
    return;
  }
  if (!googleConnected_ || clientId_.isEmpty() || credentialStore_ == nullptr) {
    return;
  }
  googleSyncInProgress_ = true;
  watch(
      credentialStore_->read(QString::fromLatin1(kGoogleAccountId)),
      [this](OAuthCredentialReadResult credential) {
        if (std::holds_alternative<AppError>(credential)) {
          finishGoogleSync(std::get<AppError>(credential));
          return;
        }
        const std::optional<OAuthStoredCredential>& stored =
            std::get<std::optional<OAuthStoredCredential>>(credential);
        if (!stored.has_value() || !stored->refreshToken.has_value()) {
          finishGoogleSync(AppError(AppErrorCode::Configuration,
                                    QStringLiteral("Google authorization must be renewed")));
          return;
        }
        const QString refreshToken = *stored->refreshToken;
        watch(
            oauthTokenRefreshClient_.refresh({.clientId = clientId_, .refreshToken = refreshToken}),
            [this, refreshToken](OAuthTokenRefreshResult refreshed) {
              if (std::holds_alternative<AppError>(refreshed)) {
                finishGoogleSync(std::get<AppError>(refreshed));
                return;
              }
              const QString accessToken = std::get<OAuthRefreshedToken>(refreshed).accessToken;
              watch(credentialStore_->save(
                        QString::fromLatin1(kGoogleAccountId),
                        {.accessToken = accessToken, .refreshToken = refreshToken}),
                    [this, accessToken](OAuthCredentialSaveResult saved) {
                      if (std::holds_alternative<AppError>(saved)) {
                        finishGoogleSync(std::get<AppError>(saved));
                        return;
                      }
                      watch(pullGoogleData(accessToken), [this](GoogleMirrorWriteResult result) {
                        finishGoogleSync(std::move(result));
                      });
                    });
            });
      });
}

std::future<GoogleMirrorWriteResult> AppController::pullGoogleData(QString accessToken) {
  try {
    return std::async(std::launch::async, [this, accessToken = std::move(accessToken)] {
      GoogleTaskListPullResultOrError taskListResult =
          googleTaskListPullClient_.list(accessToken).get();
      if (std::holds_alternative<GoogleApiError>(taskListResult)) {
        return GoogleMirrorWriteResult(
            AppError(AppErrorCode::Network, std::get<GoogleApiError>(taskListResult).message()));
      }
      GoogleTaskListPullResult pulledTaskLists =
          std::get<GoogleTaskListPullResult>(std::move(taskListResult));
      QList<GoogleTaskMirror> tasks;
      for (const GoogleTaskListMirror& taskList : pulledTaskLists.taskLists) {
        GoogleTaskPullResultOrError taskResult =
            googleTaskPullClient_.list({.taskListId = taskList.id}, accessToken).get();
        if (std::holds_alternative<GoogleApiError>(taskResult)) {
          return GoogleMirrorWriteResult(
              AppError(AppErrorCode::Network, std::get<GoogleApiError>(taskResult).message()));
        }
        QList<GoogleTaskMirror> pulledTasks =
            std::get<GoogleTaskPullResult>(std::move(taskResult)).tasks;
        for (GoogleTaskMirror& task : pulledTasks) {
          tasks.append(std::move(task));
        }
      }
      GoogleMirrorWriteResult taskWrite = googleMirrorStore_
                                              .replaceTasks(QString::fromLatin1(kGoogleAccountId),
                                                            std::move(pulledTaskLists.taskLists),
                                                            std::move(tasks))
                                              .get();
      if (std::holds_alternative<AppError>(taskWrite)) {
        return taskWrite;
      }
      GoogleCalendarListPullResultOrError calendarListResult =
          googleCalendarListPullClient_.list({}, accessToken).get();
      if (std::holds_alternative<GoogleApiError>(calendarListResult)) {
        return GoogleMirrorWriteResult(AppError(
            AppErrorCode::Network, std::get<GoogleApiError>(calendarListResult).message()));
      }
      GoogleCalendarListPullResult pulledCalendars =
          std::get<GoogleCalendarListPullResult>(std::move(calendarListResult));
      QList<GoogleCalendarEventMirror> events;
      for (const GoogleCalendarMirror& calendar : pulledCalendars.calendars) {
        if (calendar.deleted) {
          continue;
        }
        GoogleCalendarEventPullResultOrError eventResult =
            googleCalendarEventPullClient_.list({.calendarId = calendar.id}, accessToken).get();
        if (std::holds_alternative<GoogleApiError>(eventResult)) {
          return GoogleMirrorWriteResult(
              AppError(AppErrorCode::Network, std::get<GoogleApiError>(eventResult).message()));
        }
        QList<GoogleCalendarEventMirror> pulledEvents =
            std::get<GoogleCalendarEventPullResult>(std::move(eventResult)).events;
        for (GoogleCalendarEventMirror& event : pulledEvents) {
          events.append(std::move(event));
        }
      }
      return googleMirrorStore_
          .replaceCalendars(QString::fromLatin1(kGoogleAccountId),
                            std::move(pulledCalendars.calendars),
                            std::move(events))
          .get();
    });
  } catch (...) {
    std::promise<GoogleMirrorWriteResult> completion;
    std::future<GoogleMirrorWriteResult> future = completion.get_future();
    completion.set_value(
        AppError(AppErrorCode::Network, QStringLiteral("Google sync could not start")));
    return future;
  }
}

void AppController::finishGoogleSync(GoogleMirrorWriteResult result) {
  googleSyncInProgress_ = false;
  if (std::holds_alternative<AppError>(result)) {
    setStatus(errorMessage(std::get<AppError>(result)));
    return;
  }
  setStatus(QStringLiteral("Google synchronization complete"));
  refresh();
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
  watch(taskMutationService_.update(
            {.taskId = std::move(taskId),
             .title = std::move(title),
             .notes = std::move(notes),
             .due = TaskDue{.at = dueAt.isEmpty() ? std::nullopt
                                                  : std::optional<QString>(std::move(dueAt)),
                            .timeZone = dueTimeZone.isEmpty()
                                            ? std::nullopt
                                            : std::optional<QString>(std::move(dueTimeZone))},
             .priority = *parsedPriority}),
        [this](TaskMutationResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            refreshTasks();
          }
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

void AppController::deleteEvent(QString eventId) {
  watch(calendarMutationService_.remove(std::move(eventId)),
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
  setBusy(!pending_.empty());
  if (!pending_.empty()) {
    schedulePoll();
  }
}

void AppController::refreshTasks() {
  watch(taskListReadService_.list(), [this](TaskListPageResult result) {
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(result)));
      return;
    }
    taskListModel_.setTaskLists(std::get<TaskListPage>(std::move(result)).items);
  });
  watch(taskReadService_.list(), [this](TaskReadResult result) {
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(result)));
      return;
    }
    taskModel_.setTasks(std::get<QList<TaskModelTask>>(std::move(result)));
  });
  watch(noteService_.list(), [this](NotePageResult result) {
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(result)));
      return;
    }
    notesModel_.setNotes(std::get<NotePage>(std::move(result)).items);
  });
}

void AppController::refreshCalendar() {
  watch(calendarReadService_.listCalendars(), [this](CalendarListPageResult result) {
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
    refreshCalendarEvents(std::move(ids));
  });
}

void AppController::refreshCalendarEvents(QList<QString> calendarIds) {
  if (calendarIds.isEmpty()) {
    const QDate today = QDate::currentDate();
    const QList<CalendarEventSummary> events;
    agendaModel_.setEvents(events);
    timelineModel_.setRange(
        today, kCalendarTimelineDays, events, QTimeZone::systemTimeZone(), kVisibleAllDayLaneCount);
    monthGridModel_.setMonth(today, events, QTimeZone::systemTimeZone());
    return;
  }
  const QDate today = QDate::currentDate();
  watch(calendarReadService_.listEvents({.calendarIds = std::move(calendarIds),
                                         .startAt = rangeStart(today),
                                         .endAt = rangeEnd(today),
                                         .limit = 500}),
        [this, today](CalendarEventPageResult result) {
          if (std::holds_alternative<AppError>(result)) {
            setStatus(errorMessage(std::get<AppError>(result)));
          } else {
            QList<CalendarEventSummary> events =
                std::get<CalendarEventPage>(std::move(result)).items;
            agendaModel_.setEvents(events);
            timelineModel_.setRange(today,
                                    kCalendarTimelineDays,
                                    events,
                                    QTimeZone::systemTimeZone(),
                                    kVisibleAllDayLaneCount);
            monthGridModel_.setMonth(today, events, QTimeZone::systemTimeZone());
          }
        });
}

void AppController::setStatus(QString message) {
  if (statusMessage_ == message) {
    return;
  }
  statusMessage_ = std::move(message);
  emit statusMessageChanged();
}

void AppController::setBusy(bool busy) {
  if (busy_ == busy) {
    return;
  }
  busy_ = busy;
  emit busyChanged();
}

} // namespace hcb
