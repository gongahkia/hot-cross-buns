#include "core/GoogleTaskMutationPushService.h"

#include "core/Clock.h"
#include "core/GoogleApiError.h"
#include "core/GoogleHttpClient.h"
#include "core/OptimisticMutationCoordinator.h"
#include "core/SyncBackoffPolicy.h"

#include <QDate>
#include <QDateTime>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTimeZone>

#include <algorithm>
#include <chrono>
#include <future>
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

struct TaskPushRequest final {
  GoogleHttpRequest request;
};

using TaskPushRequestOrError = std::variant<TaskPushRequest, QString>;

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

[[nodiscard]] TaskPushRequestOrError buildRequest(const PendingMutation& mutation) {
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
    if (!task.has_value() ||
        (!parentTaskId.has_value() &&
         !(mutation.payload.value(QStringLiteral("parentTaskId")).isUndefined() ||
           mutation.payload.value(QStringLiteral("parentTaskId")).isNull())) ||
        (!previousTaskId.has_value() &&
         !(mutation.payload.value(QStringLiteral("previousTaskId")).isUndefined() ||
           mutation.payload.value(QStringLiteral("previousTaskId")).isNull()))) {
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
    return TaskPushRequest{.request = std::move(request)};
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
    return TaskPushRequest{.request = std::move(request)};
  }
  if (mutation.operation == QStringLiteral("task.delete")) {
    request.method = GoogleHttpMethod::Delete;
    return TaskPushRequest{.request = std::move(request)};
  }
  return QStringLiteral("Pending task mutation operation is invalid");
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
    SyncBackoffPolicy backoffPolicy)
    : mutations_(mutations), httpClient_(httpClient), clock_(clock),
      backoffPolicy_(std::move(backoffPolicy)) {}

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
        GoogleTaskMutationPushResult summary;
        int processed = 0;
        for (const PendingMutation& pending : std::get<QList<PendingMutation>>(dueResult)) {
          if (pending.resource != PendingMutationResource::Task) {
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
          const TaskPushRequestOrError request = buildRequest(claimed);
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
              httpClient_.send(std::get<TaskPushRequest>(request).request, accessToken).get();
          if (std::holds_alternative<GoogleApiError>(response)) {
            const GoogleApiError& error = std::get<GoogleApiError>(response);
            const std::optional<AppError> failure =
                markFailure(mutations_,
                            claimed,
                            errorCode(error),
                            error.message(),
                            retryAt(error, claimed.attemptCount, clock_, backoffPolicy_));
            if (failure.has_value()) {
              completion->set_value(*failure);
              return;
            }
            ++summary.failed;
            continue;
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
        completion->set_value(networkError(QStringLiteral("Google task mutation push failed")));
      }
    }).detach();
  } catch (...) {
    completion->set_value(networkError(QStringLiteral("Google task mutation push failed")));
  }
  return future;
}

} // namespace hcb
