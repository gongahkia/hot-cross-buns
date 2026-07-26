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
#include "core/TaskListModel.h"
#include "core/TaskModel.h"
#include "core/TimelineModel.h"

#include <QDate>
#include <QDateTime>
#include <QMetaType>
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

[[nodiscard]] std::optional<QList<QString>> eventAttendeesFromVariantList(const QVariantList& values) {
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
      settingsService_(databasePath, clock), savedSearchStore_(settingsService_),
      optimisticMutationCoordinator_(databasePath, clock),
      syncCheckpointStore_(databasePath, clock), syncConflictStore_(databasePath, clock),
      googleSyncConflictResolver_(optimisticMutationCoordinator_, syncConflictStore_, googleHttpClient_),
      taskMutationService_(databasePath, clock), taskBulkMutationService_(taskMutationService_),
      taskListMutationService_(databasePath, clock),
      calendarMutationService_(databasePath, clock),
      calendarEventBulkMutationService_(calendarMutationService_),
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
      localSearchService_(databasePath),
      googleTaskMirrorSyncService_(googleTaskListPullClient_,
                                   googleTaskPullClient_,
                                   googleMirrorStore_,
                                   syncCheckpointStore_,
                                   clock),
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

void AppController::applySavedSearch(QString savedSearchId) {
  const auto found = std::find_if(savedSearches_.cbegin(), savedSearches_.cend(),
                                  [&savedSearchId](const SavedSearch& search) {
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
  if (std::any_of(savedSearches_.cbegin(), savedSearches_.cend(), [&name](const SavedSearch& search) {
        return search.name.compare(name, Qt::CaseInsensitive) == 0;
      })) {
    setStatus(QStringLiteral("Saved search name already exists"));
    return;
  }
  QList<SavedSearch> next = savedSearches_;
  next.append({.id = QUuid::createUuid().toString(QUuid::WithoutBraces),
               .name = std::move(name),
               .query = std::move(query)});
  watch(savedSearchStore_.save(next), [this, next = std::move(next)](SavedSearchMutationResult result) {
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
  const auto found = std::find_if(next.begin(), next.end(), [&savedSearchId](const SavedSearch& search) {
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
  watch(savedSearchStore_.save(next), [this, next = std::move(next)](SavedSearchMutationResult result) {
    if (std::holds_alternative<AppError>(result)) {
      setStatus(errorMessage(std::get<AppError>(result)));
      return;
    }
    setSavedSearches(next);
  });
}

void AppController::deleteSavedSearch(QString savedSearchId) {
  QList<SavedSearch> next = savedSearches_;
  const auto found = std::find_if(next.begin(), next.end(), [&savedSearchId](const SavedSearch& search) {
    return search.id == savedSearchId;
  });
  if (found == next.end()) {
    setStatus(QStringLiteral("Saved search was not found"));
    return;
  }
  next.erase(found);
  watch(savedSearchStore_.save(next), [this, next = std::move(next)](SavedSearchMutationResult result) {
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
        googleCalendarMirrorSyncService_
            .sync(QString::fromLatin1(kGoogleAccountId), accessToken)
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

void AppController::bulkSetTaskCompleted(QVariantList taskIds, bool completed) {
  const std::optional<QList<QString>> ids = taskIdsFromVariantList(taskIds);
  if (!ids.has_value()) {
    setStatus(QStringLiteral("Bulk task selection is invalid"));
    return;
  }
  runBulkTaskMutation({.action = completed ? TaskBulkAction::Complete : TaskBulkAction::Reopen,
                        .taskIds = *ids});
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
  runBulkTaskMutation({.action = TaskBulkAction::SetDue,
                        .taskIds = *ids,
                        .due = TaskDue{.at = normalizedDue}});
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
                                        QVariantList reminders) {
  const std::optional<QList<QString>> parsedAttendees = eventAttendeesFromVariantList(attendees);
  const std::optional<CalendarEventReminderSettings> parsedReminders =
      eventRemindersFromVariantList(remindersUseDefault, reminders);
  if (!parsedAttendees.has_value() || !parsedReminders.has_value()) {
    setStatus(QStringLiteral("Calendar event metadata is invalid"));
    return;
  }
  const std::optional<QString> eventTimeZone =
      timeZone.trimmed().isEmpty() ? std::optional<QString>{} : std::optional<QString>(timeZone.trimmed());
  watch(calendarMutationService_.create(
            {.calendarId = std::move(calendarId),
             .title = std::move(title),
             .startAt = std::move(startAt),
             .endAt = std::move(endAt),
             .allDay = allDay,
             .description = description.isEmpty() ? std::nullopt
                                                  : std::optional<QString>(std::move(description)),
             .location = location.isEmpty() ? std::nullopt : std::optional<QString>(std::move(location)),
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
             .reminders = *parsedReminders}),
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
                                        QVariantList reminders) {
  const std::optional<QList<QString>> parsedAttendees = eventAttendeesFromVariantList(attendees);
  const std::optional<CalendarEventReminderSettings> parsedReminders =
      eventRemindersFromVariantList(remindersUseDefault, reminders);
  if (!parsedAttendees.has_value() || !parsedReminders.has_value()) {
    setStatus(QStringLiteral("Calendar event metadata is invalid"));
    return;
  }
  const std::optional<QString> eventTimeZone =
      timeZone.trimmed().isEmpty() ? std::optional<QString>{} : std::optional<QString>(timeZone.trimmed());
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
             .reminders = *parsedReminders}),
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
  watch(localSearchService_.search({.query = searchQuery_}, searchCancellation_->token()),
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
          searchResultsModel().setResults(std::get<LocalSearchPage>(std::move(result)).items);
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
  setBusy(std::any_of(pending_.cbegin(), pending_.cend(),
                      [](const std::unique_ptr<PendingOperation>& operation) {
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

void AppController::setBusy(bool busy) {
  if (busy_ == busy) {
    return;
  }
  busy_ = busy;
  emit busyChanged();
}

} // namespace hcb
