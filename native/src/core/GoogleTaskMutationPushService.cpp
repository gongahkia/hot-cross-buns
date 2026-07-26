#include "core/GoogleTaskMutationPushService.h"

#include "core/Clock.h"
#include "core/GoogleApiError.h"
#include "core/GoogleHttpClient.h"
#include "core/GoogleSyncConflictResolver.h"
#include "core/OptimisticMutationCoordinator.h"
#include "core/SyncBackoffPolicy.h"
#include "core/TaskListMutationService.h"
#include "core/TaskMutationService.h"

#include <QDate>
#include <QDateTime>
#include <QHash>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSet>
#include <QTimeZone>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <future>
#include <functional>
#include <limits>
#include <memory>
#include <optional>
#include <thread>
#include <utility>
#include <variant>

namespace hcb {
namespace {

constexpr int kMaximumPushBatch = 100;
constexpr qsizetype kMaximumIdentifierLength = 256;
constexpr qsizetype kMaximumTitleLength = 1'024;
constexpr qsizetype kMaximumNotesLength = 8'192;
constexpr qsizetype kMaximumEtagLength = 4'096;
constexpr auto kMutationLeaseDuration = std::chrono::minutes(5);

struct MutationPushRequest final {
  GoogleHttpRequest request;
};

struct GoogleMutationWriteResponse final {
  QString remoteId;
  std::optional<QString> remoteEtag;
};

using MutationPushRequestOrError = std::variant<MutationPushRequest, QString>;
using GoogleMutationWriteResponseOrError = std::variant<GoogleMutationWriteResponse, QString>;

enum class ParentTaskReferenceStatus : std::uint8_t {
  Pending,
  Unavailable,
  Invalid
};

enum class PreviousTaskReferenceStatus : std::uint8_t {
  Pending,
  Unavailable,
  Invalid
};

enum class TaskListReferenceStatus : std::uint8_t {
  Pending,
  Unavailable,
  Invalid
};

using ParentTaskReferenceResult =
    std::variant<PendingMutation, ParentTaskReferenceStatus, AppError>;

[[nodiscard]] AppError databaseError(const QString& message) {
  return AppError(AppErrorCode::Database, message);
}

[[nodiscard]] AppError networkError(const QString& message) {
  return AppError(AppErrorCode::Network, message);
}

[[nodiscard]] bool isValidIdentifier(const QString& value, qsizetype maximumLength) {
  return !value.isEmpty() && value == value.trimmed() && value.size() <= maximumLength &&
         !value.contains(QChar::Null) && !value.contains(u'/') && !value.contains(u'\\') &&
         !value.contains(u'?') && !value.contains(u'#');
}

[[nodiscard]] bool isValidRequiredText(const QString& value, qsizetype maximumLength) {
  return !value.isEmpty() && value == value.trimmed() && value.size() <= maximumLength &&
         !value.contains(QChar::Null);
}

[[nodiscard]] bool isValidOptionalText(const QString& value, qsizetype maximumLength) {
  return value.size() <= maximumLength && !value.contains(QChar::Null);
}

[[nodiscard]] bool isValidEtag(const QString& value) {
  return !value.isEmpty() && value.size() <= kMaximumEtagLength && !value.contains(QChar::Null) &&
         !value.contains(u'\r') && !value.contains(u'\n');
}

[[nodiscard]] bool isPendingRemoteId(const QString& value) {
  return value.startsWith(QStringLiteral("pending:"));
}

[[nodiscard]] std::optional<QString> optionalIdentifier(const QJsonObject& object,
                                                        QStringView key) {
  const QJsonValue value = object.value(key);
  if (value.isUndefined() || value.isNull()) {
    return std::optional<QString>{};
  }
  if (!value.isString() || !isValidIdentifier(value.toString(), kMaximumIdentifierLength)) {
    return std::nullopt;
  }
  return value.toString();
}

[[nodiscard]] QList<PendingMutation> orderByDependencies(QList<PendingMutation> mutations) {
  QHash<QString, qsizetype> indices;
  for (qsizetype index = 0; index < mutations.size(); ++index) {
    indices.insert(mutations.at(index).id, index);
  }
  QList<PendingMutation> ordered;
  QSet<QString> appended;
  QSet<QString> visiting;
  std::function<void(qsizetype)> append = [&](qsizetype index) {
    const PendingMutation& mutation = mutations.at(index);
    if (appended.contains(mutation.id) || visiting.contains(mutation.id)) {
      return;
    }
    visiting.insert(mutation.id);
    const std::optional<QString> dependency =
        optionalIdentifier(mutation.payload, u"dependsOnMutationId");
    if (dependency.has_value()) {
      const auto prerequisite = indices.constFind(*dependency);
      if (prerequisite != indices.cend()) {
        append(*prerequisite);
      }
    }
    visiting.remove(mutation.id);
    appended.insert(mutation.id);
    ordered.append(mutation);
  };
  for (qsizetype index = 0; index < mutations.size(); ++index) {
    append(index);
  }
  return ordered;
}

[[nodiscard]] std::optional<QString> requiredIdentifier(const QJsonObject& object,
                                                        QStringView key) {
  const QJsonValue value = object.value(key);
  if (!value.isString() || !isValidIdentifier(value.toString(), kMaximumIdentifierLength)) {
    return std::nullopt;
  }
  return value.toString();
}

[[nodiscard]] std::optional<QString> optionalEtag(const QJsonObject& object) {
  const QJsonValue value = object.value(QStringLiteral("etag"));
  if (value.isUndefined() || value.isNull()) {
    return std::optional<QString>{};
  }
  if (!value.isString() || !isValidEtag(value.toString())) {
    return std::nullopt;
  }
  return value.toString();
}

[[nodiscard]] ParentTaskReferenceResult
resolveParentTaskReference(PendingMutation mutation, TaskMutationService* taskMutationService) {
  const QJsonValue parentTaskLocalIdValue =
      mutation.payload.value(QStringLiteral("parentTaskLocalId"));
  if (parentTaskLocalIdValue.isUndefined() || parentTaskLocalIdValue.isNull()) {
    return mutation;
  }
  const QJsonValue parentTaskIdValue = mutation.payload.value(QStringLiteral("parentTaskId"));
  if (!parentTaskLocalIdValue.isString() ||
      !isValidIdentifier(parentTaskLocalIdValue.toString(), kMaximumIdentifierLength) ||
      !(parentTaskIdValue.isUndefined() || parentTaskIdValue.isNull()) ||
      taskMutationService == nullptr) {
    return ParentTaskReferenceStatus::Invalid;
  }
  TaskRemoteIdResult remoteIdResult =
      taskMutationService->remoteTaskId(parentTaskLocalIdValue.toString()).get();
  if (std::holds_alternative<AppError>(remoteIdResult)) {
    return std::get<AppError>(std::move(remoteIdResult));
  }
  const std::optional<QString>& remoteId = std::get<std::optional<QString>>(remoteIdResult);
  if (!remoteId.has_value()) {
    return ParentTaskReferenceStatus::Unavailable;
  }
  if (isPendingRemoteId(*remoteId)) {
    return ParentTaskReferenceStatus::Pending;
  }
  mutation.payload.remove(QStringLiteral("parentTaskLocalId"));
  mutation.payload.insert(QStringLiteral("parentTaskId"), *remoteId);
  return mutation;
}

using PreviousTaskReferenceResult =
    std::variant<PendingMutation, PreviousTaskReferenceStatus, AppError>;

[[nodiscard]] PreviousTaskReferenceResult
resolvePreviousTaskReference(PendingMutation mutation, TaskMutationService* taskMutationService) {
  const QJsonValue previousTaskLocalIdValue =
      mutation.payload.value(QStringLiteral("previousTaskLocalId"));
  if (previousTaskLocalIdValue.isUndefined() || previousTaskLocalIdValue.isNull()) {
    return mutation;
  }
  const QJsonValue previousTaskIdValue = mutation.payload.value(QStringLiteral("previousTaskId"));
  if (!previousTaskLocalIdValue.isString() ||
      !isValidIdentifier(previousTaskLocalIdValue.toString(), kMaximumIdentifierLength) ||
      !(previousTaskIdValue.isUndefined() || previousTaskIdValue.isNull()) ||
      taskMutationService == nullptr) {
    return PreviousTaskReferenceStatus::Invalid;
  }
  TaskRemoteIdResult remoteIdResult =
      taskMutationService->remoteTaskId(previousTaskLocalIdValue.toString()).get();
  if (std::holds_alternative<AppError>(remoteIdResult)) {
    return std::get<AppError>(std::move(remoteIdResult));
  }
  const std::optional<QString>& remoteId = std::get<std::optional<QString>>(remoteIdResult);
  if (!remoteId.has_value()) {
    return PreviousTaskReferenceStatus::Unavailable;
  }
  if (isPendingRemoteId(*remoteId)) {
    return PreviousTaskReferenceStatus::Pending;
  }
  mutation.payload.remove(QStringLiteral("previousTaskLocalId"));
  mutation.payload.insert(QStringLiteral("previousTaskId"), *remoteId);
  return mutation;
}

using TaskListReferenceResult =
    std::variant<PendingMutation, TaskListReferenceStatus, AppError>;

[[nodiscard]] TaskListReferenceResult
resolveTaskListReference(PendingMutation mutation, TaskListMutationService* taskListMutationService) {
  const QJsonValue localTaskListIdValue =
      mutation.payload.value(QStringLiteral("localTaskListId"));
  if (localTaskListIdValue.isUndefined() || localTaskListIdValue.isNull()) {
    return mutation;
  }
  if (!localTaskListIdValue.isString() ||
      !isValidIdentifier(localTaskListIdValue.toString(), kMaximumIdentifierLength)) {
    return TaskListReferenceStatus::Invalid;
  }
  const std::optional<QString> currentRemoteId =
      requiredIdentifier(mutation.payload, u"taskListId");
  if (!currentRemoteId.has_value()) {
    return TaskListReferenceStatus::Invalid;
  }
  if (taskListMutationService == nullptr) {
    if (isPendingRemoteId(*currentRemoteId)) {
      return TaskListReferenceStatus::Pending;
    }
    return mutation;
  }
  TaskListRemoteIdResult remoteIdResult =
      taskListMutationService->remoteTaskListId(localTaskListIdValue.toString()).get();
  if (std::holds_alternative<AppError>(remoteIdResult)) {
    return std::get<AppError>(std::move(remoteIdResult));
  }
  const std::optional<QString>& remoteId = std::get<std::optional<QString>>(remoteIdResult);
  if (!remoteId.has_value()) {
    return TaskListReferenceStatus::Unavailable;
  }
  if (isPendingRemoteId(*remoteId)) {
    return TaskListReferenceStatus::Pending;
  }
  mutation.payload.insert(QStringLiteral("taskListId"), *remoteId);
  return mutation;
}

[[nodiscard]] GoogleMutationWriteResponseOrError
decodeWriteResponse(const GoogleHttpResponse& response) {
  QJsonParseError parseError;
  const QJsonDocument document = QJsonDocument::fromJson(response.body, &parseError);
  if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
    return QStringLiteral("Google mutation write response is invalid");
  }
  const QJsonObject object = document.object();
  const std::optional<QString> remoteId = requiredIdentifier(object, u"id");
  const std::optional<QString> remoteEtag = optionalEtag(object);
  const QJsonValue etagValue = object.value(QStringLiteral("etag"));
  if (!remoteId.has_value() ||
      (!remoteEtag.has_value() && !(etagValue.isUndefined() || etagValue.isNull()))) {
    return QStringLiteral("Google mutation write response is invalid");
  }
  return GoogleMutationWriteResponse{.remoteId = *remoteId, .remoteEtag = remoteEtag};
}

[[nodiscard]] std::optional<QString> normalizedDue(const QJsonValue& value) {
  if (!value.isString()) {
    return std::nullopt;
  }
  const QString due = value.toString();
  if (due.size() < 10 || due.size() > 64 || due.contains(QChar::Null)) {
    return std::nullopt;
  }
  const QDate date = QDate::fromString(due.left(10), Qt::ISODate);
  return date.isValid()
             ? std::optional<QString>(
                   QDateTime(date, QTime(0, 0), QTimeZone::UTC).toString(Qt::ISODateWithMs))
             : std::nullopt;
}

[[nodiscard]] std::optional<QJsonObject> canonicalTask(const QJsonObject& payload, bool creating) {
  const QJsonValue taskValue = payload.value(QStringLiteral("task"));
  if (!taskValue.isObject()) {
    return std::nullopt;
  }
  const QJsonObject task = taskValue.toObject();
  QJsonObject result;
  const QJsonValue title = task.value(QStringLiteral("title"));
  if (!title.isUndefined()) {
    if (!title.isString()) {
      return std::nullopt;
    }
    const QString titleText = title.toString().trimmed();
    if (!isValidRequiredText(titleText, kMaximumTitleLength)) {
      return std::nullopt;
    }
    result.insert(QStringLiteral("title"), titleText);
  }
  if (creating && !result.contains(QStringLiteral("title"))) {
    return std::nullopt;
  }
  const QJsonValue notes = task.value(QStringLiteral("notes"));
  if (!notes.isUndefined()) {
    if (!notes.isString() || !isValidOptionalText(notes.toString(), kMaximumNotesLength)) {
      return std::nullopt;
    }
    result.insert(QStringLiteral("notes"), notes.toString());
  }
  const QJsonValue status = task.value(QStringLiteral("status"));
  if (!status.isUndefined()) {
    if (!status.isString() || (status.toString() != QStringLiteral("needsAction") &&
                               status.toString() != QStringLiteral("completed"))) {
      return std::nullopt;
    }
    result.insert(QStringLiteral("status"), status.toString());
  }
  const QJsonValue due = task.value(QStringLiteral("due"));
  if (!due.isUndefined()) {
    if (due.isNull()) {
      result.insert(QStringLiteral("due"), QJsonValue::Null);
    } else {
      const std::optional<QString> normalized = normalizedDue(due);
      if (!normalized.has_value()) {
        return std::nullopt;
      }
      result.insert(QStringLiteral("due"), *normalized);
    }
  }
  return !result.isEmpty() ? std::optional<QJsonObject>(result) : std::nullopt;
}

[[nodiscard]] QString taskCollectionPath(const QString& taskListId) {
  return QStringLiteral("/tasks/v1/lists/") + taskListId + QStringLiteral("/tasks");
}

[[nodiscard]] QString taskListCollectionPath() {
  return QStringLiteral("/tasks/v1/users/@me/lists");
}

[[nodiscard]] MutationPushRequestOrError buildTaskRequest(const PendingMutation& mutation) {
  if (mutation.resource != PendingMutationResource::Task) {
    return QStringLiteral("Pending mutation resource is not a task");
  }
  const std::optional<QString> taskListId = requiredIdentifier(mutation.payload, u"taskListId");
  if (!taskListId.has_value()) {
    return QStringLiteral("Pending task mutation payload is invalid");
  }
  if (mutation.operation == QStringLiteral("task.create")) {
    const std::optional<QJsonObject> task = canonicalTask(mutation.payload, true);
    const std::optional<QString> parentTaskId =
        optionalIdentifier(mutation.payload, u"parentTaskId");
    const std::optional<QString> previousTaskId =
        optionalIdentifier(mutation.payload, u"previousTaskId");
    const QJsonValue parentTaskLocalIdValue =
        mutation.payload.value(QStringLiteral("parentTaskLocalId"));
    const QJsonValue previousTaskLocalIdValue =
        mutation.payload.value(QStringLiteral("previousTaskLocalId"));
    if (!task.has_value() ||
        (!parentTaskId.has_value() &&
         !(mutation.payload.value(QStringLiteral("parentTaskId")).isUndefined() ||
           mutation.payload.value(QStringLiteral("parentTaskId")).isNull())) ||
        (!previousTaskId.has_value() &&
         !(mutation.payload.value(QStringLiteral("previousTaskId")).isUndefined() ||
           mutation.payload.value(QStringLiteral("previousTaskId")).isNull())) ||
        (!parentTaskLocalIdValue.isUndefined() && !parentTaskLocalIdValue.isNull()) ||
        (!previousTaskLocalIdValue.isUndefined() && !previousTaskLocalIdValue.isNull())) {
      return QStringLiteral("Pending task mutation payload is invalid");
    }
    GoogleHttpRequest request;
    request.method = GoogleHttpMethod::Post;
    request.path = taskCollectionPath(*taskListId);
    request.body = QJsonDocument(*task).toJson(QJsonDocument::Compact);
    if (parentTaskId.has_value()) {
      request.query.append({.name = QStringLiteral("parent"), .value = *parentTaskId});
    }
    if (previousTaskId.has_value()) {
      request.query.append({.name = QStringLiteral("previous"), .value = *previousTaskId});
    }
    return MutationPushRequest{.request = std::move(request)};
  }
  const std::optional<QString> remoteTaskId = requiredIdentifier(mutation.payload, u"remoteTaskId");
  const std::optional<QString> etag =
      mutation.remoteEtag.has_value() ? mutation.remoteEtag : optionalEtag(mutation.payload);
  const QJsonValue etagValue = mutation.payload.value(QStringLiteral("etag"));
  if (!remoteTaskId.has_value() || (!mutation.remoteEtag.has_value() && !etag.has_value() &&
                                    !(etagValue.isUndefined() || etagValue.isNull()))) {
    return QStringLiteral("Pending task mutation payload is invalid");
  }
  GoogleHttpRequest request;
  request.path = taskCollectionPath(*taskListId) + QStringLiteral("/") + *remoteTaskId;
  request.ifMatch = etag;
  if (mutation.operation == QStringLiteral("task.update")) {
    const std::optional<QJsonObject> task = canonicalTask(mutation.payload, false);
    if (!task.has_value()) {
      return QStringLiteral("Pending task mutation payload is invalid");
    }
    request.method = GoogleHttpMethod::Patch;
    request.body = QJsonDocument(*task).toJson(QJsonDocument::Compact);
    return MutationPushRequest{.request = std::move(request)};
  }
  if (mutation.operation == QStringLiteral("task.move")) {
    const std::optional<QString> parentTaskId =
        optionalIdentifier(mutation.payload, u"parentTaskId");
    const std::optional<QString> previousTaskId =
        optionalIdentifier(mutation.payload, u"previousTaskId");
    const QJsonValue parentTaskIdValue = mutation.payload.value(QStringLiteral("parentTaskId"));
    const QJsonValue parentTaskLocalIdValue =
        mutation.payload.value(QStringLiteral("parentTaskLocalId"));
    const QJsonValue previousTaskIdValue =
        mutation.payload.value(QStringLiteral("previousTaskId"));
    const QJsonValue previousTaskLocalIdValue =
        mutation.payload.value(QStringLiteral("previousTaskLocalId"));
    if ((!parentTaskId.has_value() &&
         !(parentTaskIdValue.isUndefined() || parentTaskIdValue.isNull())) ||
        (!previousTaskId.has_value() &&
         !(previousTaskIdValue.isUndefined() || previousTaskIdValue.isNull())) ||
        (!parentTaskLocalIdValue.isUndefined() && !parentTaskLocalIdValue.isNull()) ||
        (!previousTaskLocalIdValue.isUndefined() && !previousTaskLocalIdValue.isNull())) {
      return QStringLiteral("Pending task mutation payload is invalid");
    }
    request.method = GoogleHttpMethod::Post;
    request.path += QStringLiteral("/move");
    if (parentTaskId.has_value()) {
      request.query.append({.name = QStringLiteral("parent"), .value = *parentTaskId});
    }
    if (previousTaskId.has_value()) {
      request.query.append({.name = QStringLiteral("previous"), .value = *previousTaskId});
    }
    return MutationPushRequest{.request = std::move(request)};
  }
  if (mutation.operation == QStringLiteral("task.delete")) {
    request.method = GoogleHttpMethod::Delete;
    return MutationPushRequest{.request = std::move(request)};
  }
  return QStringLiteral("Pending task mutation operation is invalid");
}

[[nodiscard]] std::optional<QJsonObject> canonicalTaskList(const QJsonObject& payload) {
  const QJsonValue taskListValue = payload.value(QStringLiteral("taskList"));
  if (!taskListValue.isObject()) {
    return std::nullopt;
  }
  const QJsonValue titleValue = taskListValue.toObject().value(QStringLiteral("title"));
  if (!titleValue.isString()) {
    return std::nullopt;
  }
  const QString title = titleValue.toString().trimmed();
  if (!isValidRequiredText(title, kMaximumTitleLength)) {
    return std::nullopt;
  }
  return QJsonObject{{QStringLiteral("title"), title}};
}

[[nodiscard]] MutationPushRequestOrError
buildTaskListRequest(const PendingMutation& mutation) {
  if (mutation.resource != PendingMutationResource::TaskList) {
    return QStringLiteral("Pending mutation resource is not a task list");
  }
  if (mutation.operation == QStringLiteral("task_list.create")) {
    const std::optional<QJsonObject> taskList = canonicalTaskList(mutation.payload);
    if (!taskList.has_value()) {
      return QStringLiteral("Pending task-list mutation payload is invalid");
    }
    GoogleHttpRequest request;
    request.method = GoogleHttpMethod::Post;
    request.path = taskListCollectionPath();
    request.body = QJsonDocument(*taskList).toJson(QJsonDocument::Compact);
    return MutationPushRequest{.request = std::move(request)};
  }
  const std::optional<QString> remoteTaskListId =
      requiredIdentifier(mutation.payload, u"remoteTaskListId");
  const std::optional<QString> etag =
      mutation.remoteEtag.has_value() ? mutation.remoteEtag : optionalEtag(mutation.payload);
  const QJsonValue etagValue = mutation.payload.value(QStringLiteral("etag"));
  if (!remoteTaskListId.has_value() ||
      (!mutation.remoteEtag.has_value() && !etag.has_value() &&
       !(etagValue.isUndefined() || etagValue.isNull()))) {
    return QStringLiteral("Pending task-list mutation payload is invalid");
  }
  GoogleHttpRequest request;
  request.path = taskListCollectionPath() + QStringLiteral("/") + *remoteTaskListId;
  request.ifMatch = etag;
  if (mutation.operation == QStringLiteral("task_list.update")) {
    const std::optional<QJsonObject> taskList = canonicalTaskList(mutation.payload);
    if (!taskList.has_value()) {
      return QStringLiteral("Pending task-list mutation payload is invalid");
    }
    request.method = GoogleHttpMethod::Patch;
    request.body = QJsonDocument(*taskList).toJson(QJsonDocument::Compact);
    return MutationPushRequest{.request = std::move(request)};
  }
  if (mutation.operation == QStringLiteral("task_list.delete")) {
    request.method = GoogleHttpMethod::Delete;
    return MutationPushRequest{.request = std::move(request)};
  }
  return QStringLiteral("Pending task-list mutation operation is invalid");
}

[[nodiscard]] QString errorCode(const GoogleApiError& error) {
  switch (error.kind()) {
  case GoogleApiErrorKind::Unauthorized:
    return QStringLiteral("unauthorized");
  case GoogleApiErrorKind::Forbidden:
    return QStringLiteral("forbidden");
  case GoogleApiErrorKind::NotFound:
    return QStringLiteral("not_found");
  case GoogleApiErrorKind::Conflict:
    return QStringLiteral("conflict");
  case GoogleApiErrorKind::PreconditionFailed:
    return QStringLiteral("precondition_failed");
  case GoogleApiErrorKind::InvalidSyncToken:
    return QStringLiteral("invalid_sync_token");
  case GoogleApiErrorKind::RateLimited:
    return QStringLiteral("rate_limited");
  case GoogleApiErrorKind::Server:
    return QStringLiteral("server");
  case GoogleApiErrorKind::InvalidPayload:
    return QStringLiteral("invalid_payload");
  case GoogleApiErrorKind::Transport:
    return QStringLiteral("transport");
  }
  return QStringLiteral("transport");
}

[[nodiscard]] QString timestampAfter(const Clock& clock, qint64 delayMilliseconds) {
  const auto now =
      std::chrono::duration_cast<std::chrono::milliseconds>(clock.wallNow().time_since_epoch());
  const qint64 safeDelay = std::max<qint64>(0, delayMilliseconds);
  const qint64 milliseconds = safeDelay > std::numeric_limits<qint64>::max() - now.count()
                                  ? std::numeric_limits<qint64>::max()
                                  : now.count() + safeDelay;
  return QDateTime::fromMSecsSinceEpoch(milliseconds, QTimeZone::UTC).toString(Qt::ISODateWithMs);
}

[[nodiscard]] std::optional<QString> retryAt(const GoogleApiError& error,
                                             int attemptCount,
                                             const Clock& clock,
                                             const SyncBackoffPolicy& policy) {
  std::optional<qint64> delay = policy.retryDelayMilliseconds(error, attemptCount);
  if (!delay.has_value() && error.kind() == GoogleApiErrorKind::Transport) {
    delay = policy.delayMillisecondsForAttempt(attemptCount);
  }
  return delay.has_value() ? std::optional<QString>(timestampAfter(clock, *delay)) : std::nullopt;
}

[[nodiscard]] std::optional<AppError> markFailure(OptimisticMutationCoordinator& mutations,
                                                  const PendingMutation& mutation,
                                                  const QString& errorCodeValue,
                                                  const QString& message,
                                                  std::optional<QString> nextRetryAt) {
  if (!mutation.leaseId.has_value()) {
    return databaseError(QStringLiteral("Claimed task mutation lease is missing"));
  }
  MutationFailureInput input{.mutationId = mutation.id,
                             .leaseId = *mutation.leaseId,
                             .errorCode = errorCodeValue,
                             .errorMessage = message.left(4'096),
                             .nextRetryAt = std::move(nextRetryAt)};
  PendingMutationResult result = mutations.markFailed(std::move(input)).get();
  return std::holds_alternative<AppError>(result)
             ? std::optional<AppError>(std::get<AppError>(std::move(result)))
             : std::nullopt;
}

} // namespace

GoogleTaskMutationPushService::GoogleTaskMutationPushService(
    OptimisticMutationCoordinator& mutations,
    GoogleHttpClient& httpClient,
    const Clock& clock,
    SyncBackoffPolicy backoffPolicy,
    TaskMutationService* taskMutationService,
    TaskListMutationService* taskListMutationService,
    GoogleSyncConflictResolver* conflictResolver)
    : mutations_(mutations), httpClient_(httpClient), clock_(clock),
      backoffPolicy_(std::move(backoffPolicy)), taskMutationService_(taskMutationService),
      taskListMutationService_(taskListMutationService), conflictResolver_(conflictResolver) {}

std::future<GoogleTaskMutationPushResultOrError>
GoogleTaskMutationPushService::pushDue(QString accessToken, int limit) {
  auto completion = std::make_shared<std::promise<GoogleTaskMutationPushResultOrError>>();
  std::future<GoogleTaskMutationPushResultOrError> future = completion->get_future();
  const int cappedLimit = std::clamp(limit, 1, kMaximumPushBatch);
  try {
    std::thread([this, accessToken = std::move(accessToken), cappedLimit, completion] {
      try {
        PendingMutationListResult dueResult = mutations_.listDue(kMaximumPushBatch).get();
        if (std::holds_alternative<AppError>(dueResult)) {
          completion->set_value(std::get<AppError>(std::move(dueResult)));
          return;
        }
        QList<PendingMutation> due = std::get<QList<PendingMutation>>(std::move(dueResult));
        const auto priority = [](PendingMutationResource resource) {
          return resource == PendingMutationResource::TaskList ? 0
                 : resource == PendingMutationResource::Task ? 1
                                                          : 2;
        };
        std::stable_sort(due.begin(), due.end(), [&priority](const auto& left, const auto& right) {
          return priority(left.resource) < priority(right.resource);
        });
        due = orderByDependencies(std::move(due));
        GoogleTaskMutationPushResult summary;
        int processed = 0;
        for (const PendingMutation& pending : due) {
          if (pending.resource != PendingMutationResource::Task &&
              pending.resource != PendingMutationResource::TaskList) {
            ++summary.skipped;
            continue;
          }
          if (processed >= cappedLimit) {
            break;
          }
          ++processed;
          PendingMutationResult claimResult =
              mutations_.claim(pending.id, kMutationLeaseDuration).get();
          if (std::holds_alternative<AppError>(claimResult)) {
            completion->set_value(std::get<AppError>(std::move(claimResult)));
            return;
          }
          PendingMutation claimed = std::get<PendingMutation>(std::move(claimResult));
          const std::optional<QString> dependency =
              optionalIdentifier(claimed.payload, u"dependsOnMutationId");
          const QJsonValue dependencyValue =
              claimed.payload.value(QStringLiteral("dependsOnMutationId"));
          if (!dependency.has_value() &&
              !(dependencyValue.isUndefined() || dependencyValue.isNull())) {
            const std::optional<AppError> failure =
                markFailure(mutations_,
                            claimed,
                            QStringLiteral("invalid_payload"),
                            QStringLiteral("Pending mutation dependency is invalid"),
                            std::nullopt);
            if (failure.has_value()) {
              completion->set_value(*failure);
              return;
            }
            ++summary.failed;
            continue;
          }
          if (dependency.has_value()) {
            PendingMutationLookupResult dependencyResult = mutations_.find(*dependency).get();
            if (std::holds_alternative<AppError>(dependencyResult)) {
              completion->set_value(std::get<AppError>(std::move(dependencyResult)));
              return;
            }
            const std::optional<PendingMutation>& prerequisite =
                std::get<std::optional<PendingMutation>>(dependencyResult);
            if (!prerequisite.has_value() ||
                prerequisite->status == PendingMutationStatus::Cancelled) {
              const std::optional<AppError> failure =
                  markFailure(mutations_,
                              claimed,
                              QStringLiteral("dependency_failed"),
                              QStringLiteral("Pending mutation prerequisite is unavailable"),
                              std::nullopt);
              if (failure.has_value()) {
                completion->set_value(*failure);
                return;
              }
              ++summary.failed;
              continue;
            }
            if (prerequisite->status != PendingMutationStatus::Applied) {
              const bool dependencyIsPermanentFailure =
                  prerequisite->status == PendingMutationStatus::Failed &&
                  !prerequisite->nextRetryAt.has_value();
              if (claimed.leaseId.has_value()) {
                MutationFailureInput deferred{
                    .mutationId = claimed.id,
                    .leaseId = *claimed.leaseId,
                    .errorCode = dependencyIsPermanentFailure
                                     ? QStringLiteral("dependency_failed")
                                     : QStringLiteral("dependency_pending"),
                    .errorMessage = dependencyIsPermanentFailure
                                        ? QStringLiteral("Pending mutation prerequisite failed")
                                        : QStringLiteral("Pending mutation prerequisite is pending"),
                    .nextRetryAt = dependencyIsPermanentFailure ? std::nullopt
                                   : prerequisite->nextRetryAt.has_value()
                                       ? prerequisite->nextRetryAt
                                       : std::optional<QString>(timestampAfter(clock_, 0))};
                PendingMutationResult deferredResult =
                    mutations_.markFailed(std::move(deferred)).get();
                if (std::holds_alternative<AppError>(deferredResult)) {
                  completion->set_value(std::get<AppError>(std::move(deferredResult)));
                  return;
                }
              }
              if (dependencyIsPermanentFailure) {
                ++summary.failed;
              } else {
                ++summary.skipped;
              }
              continue;
            }
          }
          PendingMutation prepared = claimed;
          if (claimed.resource == PendingMutationResource::Task) {
            ParentTaskReferenceResult resolvedParent =
                resolveParentTaskReference(std::move(prepared), taskMutationService_);
            if (std::holds_alternative<AppError>(resolvedParent)) {
              completion->set_value(std::get<AppError>(std::move(resolvedParent)));
              return;
            }
            if (std::holds_alternative<ParentTaskReferenceStatus>(resolvedParent)) {
              const ParentTaskReferenceStatus status =
                  std::get<ParentTaskReferenceStatus>(resolvedParent);
              const bool parentPending = status == ParentTaskReferenceStatus::Pending;
              const std::optional<AppError> failure = markFailure(
                  mutations_,
                  claimed,
                  parentPending ? QStringLiteral("parent_pending")
                  : status == ParentTaskReferenceStatus::Unavailable
                      ? QStringLiteral("parent_unavailable")
                      : QStringLiteral("invalid_payload"),
                  parentPending ? QStringLiteral("Parent task is awaiting Google creation")
                  : status == ParentTaskReferenceStatus::Unavailable
                      ? QStringLiteral("Parent task is unavailable")
                      : QStringLiteral("Pending parent task reference is invalid"),
                  parentPending ? std::optional<QString>(timestampAfter(clock_, 1'000))
                                : std::nullopt);
              if (failure.has_value()) {
                completion->set_value(*failure);
                return;
              }
              if (parentPending) {
                ++summary.skipped;
              } else {
                ++summary.failed;
              }
              continue;
            }
            prepared = std::get<PendingMutation>(std::move(resolvedParent));
            PreviousTaskReferenceResult resolvedPrevious =
                resolvePreviousTaskReference(std::move(prepared), taskMutationService_);
            if (std::holds_alternative<AppError>(resolvedPrevious)) {
              completion->set_value(std::get<AppError>(std::move(resolvedPrevious)));
              return;
            }
            if (std::holds_alternative<PreviousTaskReferenceStatus>(resolvedPrevious)) {
              const PreviousTaskReferenceStatus status =
                  std::get<PreviousTaskReferenceStatus>(resolvedPrevious);
              const bool previousPending = status == PreviousTaskReferenceStatus::Pending;
              const std::optional<AppError> failure = markFailure(
                  mutations_,
                  claimed,
                  previousPending ? QStringLiteral("previous_pending")
                  : status == PreviousTaskReferenceStatus::Unavailable
                      ? QStringLiteral("previous_unavailable")
                      : QStringLiteral("invalid_payload"),
                  previousPending ? QStringLiteral("Previous task is awaiting Google creation")
                  : status == PreviousTaskReferenceStatus::Unavailable
                      ? QStringLiteral("Previous task is unavailable")
                      : QStringLiteral("Pending previous-task reference is invalid"),
                  previousPending ? std::optional<QString>(timestampAfter(clock_, 1'000))
                                  : std::nullopt);
              if (failure.has_value()) {
                completion->set_value(*failure);
                return;
              }
              if (previousPending) {
                ++summary.skipped;
              } else {
                ++summary.failed;
              }
              continue;
            }
            prepared = std::get<PendingMutation>(std::move(resolvedPrevious));
            TaskListReferenceResult resolvedTaskList =
                resolveTaskListReference(std::move(prepared), taskListMutationService_);
            if (std::holds_alternative<AppError>(resolvedTaskList)) {
              completion->set_value(std::get<AppError>(std::move(resolvedTaskList)));
              return;
            }
            if (std::holds_alternative<TaskListReferenceStatus>(resolvedTaskList)) {
              const TaskListReferenceStatus status =
                  std::get<TaskListReferenceStatus>(resolvedTaskList);
              const bool taskListPending = status == TaskListReferenceStatus::Pending;
              const std::optional<AppError> failure = markFailure(
                  mutations_,
                  claimed,
                  taskListPending ? QStringLiteral("task_list_pending")
                  : status == TaskListReferenceStatus::Unavailable
                      ? QStringLiteral("task_list_unavailable")
                      : QStringLiteral("invalid_payload"),
                  taskListPending ? QStringLiteral("Task list is awaiting Google creation")
                  : status == TaskListReferenceStatus::Unavailable
                      ? QStringLiteral("Task list is unavailable")
                      : QStringLiteral("Pending task-list reference is invalid"),
                  taskListPending ? std::optional<QString>(timestampAfter(clock_, 1'000))
                                  : std::nullopt);
              if (failure.has_value()) {
                completion->set_value(*failure);
                return;
              }
              if (taskListPending) {
                ++summary.skipped;
              } else {
                ++summary.failed;
              }
              continue;
            }
            prepared = std::get<PendingMutation>(std::move(resolvedTaskList));
          }
          const MutationPushRequestOrError request =
              prepared.resource == PendingMutationResource::Task ? buildTaskRequest(prepared)
                                                                 : buildTaskListRequest(prepared);
          if (std::holds_alternative<QString>(request)) {
            const std::optional<AppError> failure = markFailure(mutations_,
                                                                claimed,
                                                                QStringLiteral("invalid_payload"),
                                                                std::get<QString>(request),
                                                                std::nullopt);
            if (failure.has_value()) {
              completion->set_value(*failure);
              return;
            }
            ++summary.failed;
            continue;
          }
          GoogleHttpResult response =
              httpClient_.send(std::get<MutationPushRequest>(request).request, accessToken).get();
          if (std::holds_alternative<GoogleApiError>(response)) {
            GoogleApiError error = std::get<GoogleApiError>(response);
            if ((error.kind() == GoogleApiErrorKind::Conflict ||
                 error.kind() == GoogleApiErrorKind::PreconditionFailed) &&
                conflictResolver_ != nullptr) {
              GoogleSyncConflictResult handled = conflictResolver_->handle(
                  prepared, errorCode(error), error.message(), accessToken);
              if (std::holds_alternative<GoogleSyncConflictOutcome>(handled)) {
                const GoogleSyncConflictOutcome outcome =
                    std::get<GoogleSyncConflictOutcome>(handled);
                if (outcome == GoogleSyncConflictOutcome::AwaitingUser) {
                  ++summary.failed;
                } else {
                  ++summary.skipped;
                }
                continue;
              }
              if (std::holds_alternative<AppError>(handled)) {
                completion->set_value(std::get<AppError>(std::move(handled)));
                return;
              }
              error = std::get<GoogleApiError>(std::move(handled));
            }
            const bool createOutcomeUnknown =
                (claimed.operation == QStringLiteral("task.create") ||
                 claimed.operation == QStringLiteral("task_list.create")) &&
                                              (error.kind() == GoogleApiErrorKind::Transport ||
                                               error.kind() == GoogleApiErrorKind::Server);
            const std::optional<AppError> failure = markFailure(
                mutations_,
                claimed,
                createOutcomeUnknown ? QStringLiteral("create_outcome_unknown") : errorCode(error),
                createOutcomeUnknown ? QStringLiteral("Google resource creation outcome is unknown")
                                     : error.message(),
                createOutcomeUnknown
                    ? std::nullopt
                    : retryAt(error, claimed.attemptCount, clock_, backoffPolicy_));
            if (failure.has_value()) {
              completion->set_value(*failure);
              return;
            }
            ++summary.failed;
            continue;
          }
          if (claimed.resource == PendingMutationResource::Task &&
              taskMutationService_ != nullptr && claimed.operation != QStringLiteral("task.delete")) {
            const std::optional<QString> localTaskId =
                optionalIdentifier(prepared.payload, u"localTaskId");
            const GoogleMutationWriteResponseOrError written =
                decodeWriteResponse(std::get<GoogleHttpResponse>(response));
            if (!localTaskId.has_value() || std::holds_alternative<QString>(written)) {
              const std::optional<AppError> failure =
                  markFailure(mutations_,
                              claimed,
                              QStringLiteral("invalid_response"),
                              localTaskId.has_value()
                                  ? std::get<QString>(written)
                                  : QStringLiteral("Pending task mutation local ID is invalid"),
                              std::nullopt);
              if (failure.has_value()) {
                completion->set_value(*failure);
                return;
              }
              ++summary.failed;
              continue;
            }
            const GoogleMutationWriteResponse remote =
                std::get<GoogleMutationWriteResponse>(std::move(written));
            TaskMutationResult reconciled =
                taskMutationService_
                    ->reconcileGoogleTask({.localTaskId = *localTaskId,
                                           .remoteTaskId = remote.remoteId,
                                           .remoteEtag = remote.remoteEtag})
                    .get();
            if (std::holds_alternative<AppError>(reconciled)) {
              const std::optional<AppError> failure =
                  markFailure(mutations_,
                              claimed,
                              QStringLiteral("reconciliation_failed"),
                              std::get<AppError>(std::move(reconciled)).message(),
                              std::nullopt);
              if (failure.has_value()) {
                completion->set_value(*failure);
                return;
              }
              ++summary.failed;
              continue;
            }
          }
          if (claimed.resource == PendingMutationResource::TaskList &&
              taskListMutationService_ != nullptr &&
              claimed.operation != QStringLiteral("task_list.delete")) {
            const std::optional<QString> localTaskListId =
                optionalIdentifier(prepared.payload, u"localTaskListId");
            const GoogleMutationWriteResponseOrError written =
                decodeWriteResponse(std::get<GoogleHttpResponse>(response));
            if (!localTaskListId.has_value() || std::holds_alternative<QString>(written)) {
              const std::optional<AppError> failure = markFailure(
                  mutations_,
                  claimed,
                  QStringLiteral("invalid_response"),
                  localTaskListId.has_value()
                      ? std::get<QString>(written)
                      : QStringLiteral("Pending task-list mutation local ID is invalid"),
                  std::nullopt);
              if (failure.has_value()) {
                completion->set_value(*failure);
                return;
              }
              ++summary.failed;
              continue;
            }
            const GoogleMutationWriteResponse remote =
                std::get<GoogleMutationWriteResponse>(std::move(written));
            TaskListMutationResult reconciled =
                taskListMutationService_
                    ->reconcileGoogleTaskList({.localTaskListId = *localTaskListId,
                                                .remoteTaskListId = remote.remoteId,
                                                .remoteEtag = remote.remoteEtag})
                    .get();
            if (std::holds_alternative<AppError>(reconciled)) {
              const std::optional<AppError> failure = markFailure(
                  mutations_,
                  claimed,
                  QStringLiteral("reconciliation_failed"),
                  std::get<AppError>(std::move(reconciled)).message(),
                  std::nullopt);
              if (failure.has_value()) {
                completion->set_value(*failure);
                return;
              }
              ++summary.failed;
              continue;
            }
          }
          if (!claimed.leaseId.has_value()) {
            completion->set_value(
                databaseError(QStringLiteral("Claimed task mutation lease is missing")));
            return;
          }
          PendingMutationResult applied =
              mutations_.markApplied(claimed.id, *claimed.leaseId).get();
          if (std::holds_alternative<AppError>(applied)) {
            completion->set_value(std::get<AppError>(std::move(applied)));
            return;
          }
          ++summary.applied;
        }
        completion->set_value(summary);
      } catch (...) {
        completion->set_value(networkError(QStringLiteral("Google mutation push failed")));
      }
    }).detach();
  } catch (...) {
    completion->set_value(networkError(QStringLiteral("Google mutation push failed")));
  }
  return future;
}

} // namespace hcb
