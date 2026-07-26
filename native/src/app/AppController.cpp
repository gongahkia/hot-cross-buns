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
#include <QThread>
#include <QUrlQuery>

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
constexpr auto kGoogleSyncInterval = std::chrono::minutes(5);

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
      settingsService_(databasePath, clock),
      optimisticMutationCoordinator_(databasePath, clock),
      syncCheckpointStore_(databasePath, clock), syncConflictStore_(databasePath, clock),
      googleSyncConflictResolver_(optimisticMutationCoordinator_, syncConflictStore_, googleHttpClient_),
      taskMutationService_(databasePath, clock), taskListMutationService_(databasePath, clock),
      calendarMutationService_(databasePath, clock),
      googleSyncRecoveryService_(syncCheckpointStore_),
      googleTaskMutationPushService_(optimisticMutationCoordinator_,
                                     googleHttpClient_,
                                     clock,
                                     SyncBackoffPolicy(),
                                     &taskMutationService_,
                                     &taskListMutationService_,
                                     &googleSyncConflictResolver_),
      googleCalendarEventMutationPushService_(
          optimisticMutationCoordinator_,
          googleHttpClient_,
          clock,
          SyncBackoffPolicy(),
          &calendarMutationService_,
          &googleSyncConflictResolver_),
      taskListReadService_(databasePath), taskReadService_(databasePath),
      noteService_(databasePath, clock), calendarReadService_(databasePath),
      syncScheduler_([this](const SyncSchedulerRequest& request) { return runGoogleSync(request); },
                     clock) {
  connect(&oauthLoopbackListener_,
          &OAuthLoopbackCallbackListener::callbackReceived,
          this,
          &AppController::handleOAuthCallback);
}

AppController::~AppController() { syncScheduler_.stop(); }

QString AppController::clientId() const { return clientId_; }

bool AppController::googleConnected() const { return googleConnected_; }

QString AppController::statusMessage() const { return statusMessage_; }

QString AppController::taskListErrorMessage() const { return taskListErrorMessage_; }

QString AppController::syncStatus() const { return syncStatus_; }

int AppController::conflictPolicy() const { return conflictPolicy_; }

QVariantList AppController::unresolvedConflicts() const { return unresolvedConflicts_; }

QVariantList AppController::resolvedConflicts() const { return resolvedConflicts_; }

bool AppController::busy() const { return busy_; }

void AppController::initialize() {
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
      return GoogleMirrorWriteResult(
          AppError(AppErrorCode::Network, std::get<GoogleApiError>(calendarListResult).message()));
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

void AppController::setBusy(bool busy) {
  if (busy_ == busy) {
    return;
  }
  busy_ = busy;
  emit busyChanged();
}

} // namespace hcb
