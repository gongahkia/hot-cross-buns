#include "core/GoogleCalendarEventMutationPushService.h"

#include "core/Clock.h"
#include "core/GoogleApiError.h"
#include "core/GoogleHttpClient.h"
#include "core/OptimisticMutationCoordinator.h"
#include "core/SyncBackoffPolicy.h"

#include <QDate>
#include <QDateTime>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTime>
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
constexpr qsizetype kMaximumTitleLength = 500;
constexpr qsizetype kMaximumDescriptionLength = 20'000;
constexpr qsizetype kMaximumLocationLength = 1'000;
constexpr qsizetype kMaximumTimeZoneLength = 120;
constexpr qsizetype kMaximumEtagLength = 4'096;
constexpr auto kMutationLeaseDuration = std::chrono::minutes(5);

struct CanonicalEventTime final {
  QJsonObject json;
  QDateTime at;
  bool allDay;
};

struct EventPushRequest final {
  GoogleHttpRequest request;
};

using EventPushRequestOrError = std::variant<EventPushRequest, QString>;

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

[[nodiscard]] bool isValidTimeZone(const QString& value) {
  return !value.isEmpty() && value == value.trimmed() && value.size() <= kMaximumTimeZoneLength &&
         !value.contains(QChar::Null) && QTimeZone(value.toUtf8()).isValid();
}

[[nodiscard]] bool isValidEtag(const QString& value) {
  return !value.isEmpty() && value.size() <= kMaximumEtagLength && !value.contains(QChar::Null) &&
         !value.contains(u'\r') && !value.contains(u'\n');
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

[[nodiscard]] bool hasExplicitOffset(const QString& value) {
  const qsizetype separator = value.indexOf(u'T');
  if (separator < 0) {
    return false;
  }
  const QStringView time = QStringView(value).sliced(separator + 1);
  return time.endsWith(u'Z') || time.contains(u'+') || time.contains(u'-');
}

[[nodiscard]] std::optional<CanonicalEventTime> canonicalTime(const QJsonValue& value) {
  if (!value.isObject()) {
    return std::nullopt;
  }
  const QJsonObject raw = value.toObject();
  const QJsonValue date = raw.value(QStringLiteral("date"));
  const QJsonValue dateTime = raw.value(QStringLiteral("dateTime"));
  const QJsonValue timeZone = raw.value(QStringLiteral("timeZone"));
  if (date.isUndefined() == dateTime.isUndefined() ||
      (!timeZone.isUndefined() &&
       (!timeZone.isString() || !isValidTimeZone(timeZone.toString())))) {
    return std::nullopt;
  }
  QJsonObject json;
  if (timeZone.isString()) {
    json.insert(QStringLiteral("timeZone"), timeZone.toString());
  }
  if (!date.isUndefined()) {
    if (!date.isString() || date.toString().size() != 10 || date.toString().contains(QChar::Null)) {
      return std::nullopt;
    }
    const QDate parsed = QDate::fromString(date.toString(), Qt::ISODate);
    if (!parsed.isValid()) {
      return std::nullopt;
    }
    json.insert(QStringLiteral("date"), parsed.toString(Qt::ISODate));
    return CanonicalEventTime{.json = std::move(json),
                              .at = QDateTime(parsed, QTime(0, 0), QTimeZone::UTC),
                              .allDay = true};
  }
  if (!dateTime.isString() || dateTime.toString().size() > 64 ||
      dateTime.toString().contains(QChar::Null) || !dateTime.toString().contains(u'T')) {
    return std::nullopt;
  }
  QDateTime parsed = QDateTime::fromString(dateTime.toString(), Qt::ISODate);
  if (!parsed.isValid() || (!hasExplicitOffset(dateTime.toString()) && !timeZone.isString())) {
    return std::nullopt;
  }
  if (!hasExplicitOffset(dateTime.toString())) {
    parsed = QDateTime(parsed.date(), parsed.time(), QTimeZone(timeZone.toString().toUtf8()));
  }
  parsed = parsed.toUTC();
  json.insert(QStringLiteral("dateTime"), parsed.toString(Qt::ISODateWithMs));
  return CanonicalEventTime{.json = std::move(json), .at = parsed, .allDay = false};
}

[[nodiscard]] std::optional<QJsonObject> canonicalEvent(const QJsonObject& payload, bool creating) {
  const QJsonValue eventValue = payload.value(QStringLiteral("event"));
  if (!eventValue.isObject()) {
    return std::nullopt;
  }
  const QJsonObject event = eventValue.toObject();
  QJsonObject result;
  const QJsonValue summary = event.value(QStringLiteral("summary"));
  if (!summary.isUndefined()) {
    if (!summary.isString()) {
      return std::nullopt;
    }
    const QString text = summary.toString().trimmed();
    if (!isValidRequiredText(text, kMaximumTitleLength)) {
      return std::nullopt;
    }
    result.insert(QStringLiteral("summary"), text);
  }
  if (creating && !result.contains(QStringLiteral("summary"))) {
    return std::nullopt;
  }
  for (const auto& [key, maximumLength] :
       {std::pair<QStringView, qsizetype>{u"description", kMaximumDescriptionLength},
        {u"location", kMaximumLocationLength}}) {
    const QJsonValue value = event.value(key);
    if (value.isUndefined()) {
      continue;
    }
    if (value.isNull()) {
      result.insert(key.toString(), QJsonValue::Null);
    } else if (value.isString() && isValidOptionalText(value.toString(), maximumLength)) {
      result.insert(key.toString(), value.toString());
    } else {
      return std::nullopt;
    }
  }
  const QJsonValue startValue = event.value(QStringLiteral("start"));
  const QJsonValue endValue = event.value(QStringLiteral("end"));
  const std::optional<CanonicalEventTime> start =
      startValue.isUndefined() ? std::optional<CanonicalEventTime>{} : canonicalTime(startValue);
  const std::optional<CanonicalEventTime> end =
      endValue.isUndefined() ? std::optional<CanonicalEventTime>{} : canonicalTime(endValue);
  if ((startValue.isUndefined() != endValue.isUndefined()) ||
      (creating && (!start.has_value() || !end.has_value())) ||
      (!startValue.isUndefined() && (!start.has_value() || !end.has_value())) ||
      (start.has_value() && end.has_value() &&
       (start->allDay != end->allDay || end->at <= start->at))) {
    return std::nullopt;
  }
  if (start.has_value() && end.has_value()) {
    result.insert(QStringLiteral("start"), start->json);
    result.insert(QStringLiteral("end"), end->json);
  }
  return !result.isEmpty() ? std::optional<QJsonObject>(result) : std::nullopt;
}

[[nodiscard]] QString eventCollectionPath(const QString& calendarId) {
  return QStringLiteral("/calendar/v3/calendars/") + calendarId + QStringLiteral("/events");
}

[[nodiscard]] EventPushRequestOrError buildRequest(const PendingMutation& mutation) {
  if (mutation.resource != PendingMutationResource::Event) {
    return QStringLiteral("Pending mutation resource is not an event");
  }
  const std::optional<QString> calendarId = requiredIdentifier(mutation.payload, u"calendarId");
  if (!calendarId.has_value()) {
    return QStringLiteral("Pending event mutation payload is invalid");
  }
  if (mutation.operation == QStringLiteral("event.create")) {
    const std::optional<QJsonObject> event = canonicalEvent(mutation.payload, true);
    if (!event.has_value()) {
      return QStringLiteral("Pending event mutation payload is invalid");
    }
    return EventPushRequest{
        .request = {.method = GoogleHttpMethod::Post,
                    .path = eventCollectionPath(*calendarId),
                    .body = QJsonDocument(*event).toJson(QJsonDocument::Compact)}};
  }
  const std::optional<QString> remoteEventId =
      requiredIdentifier(mutation.payload, u"remoteEventId");
  const std::optional<QString> etag =
      mutation.remoteEtag.has_value() ? mutation.remoteEtag : optionalEtag(mutation.payload);
  const QJsonValue etagValue = mutation.payload.value(QStringLiteral("etag"));
  if (!remoteEventId.has_value() || (!mutation.remoteEtag.has_value() && !etag.has_value() &&
                                     !(etagValue.isUndefined() || etagValue.isNull()))) {
    return QStringLiteral("Pending event mutation payload is invalid");
  }
  GoogleHttpRequest request;
  request.path = eventCollectionPath(*calendarId) + QStringLiteral("/") + *remoteEventId;
  request.ifMatch = etag;
  if (mutation.operation == QStringLiteral("event.update")) {
    const std::optional<QJsonObject> event = canonicalEvent(mutation.payload, false);
    if (!event.has_value()) {
      return QStringLiteral("Pending event mutation payload is invalid");
    }
    request.method = GoogleHttpMethod::Patch;
    request.body = QJsonDocument(*event).toJson(QJsonDocument::Compact);
    return EventPushRequest{.request = std::move(request)};
  }
  if (mutation.operation == QStringLiteral("event.delete")) {
    request.method = GoogleHttpMethod::Delete;
    return EventPushRequest{.request = std::move(request)};
  }
  return QStringLiteral("Pending event mutation operation is invalid");
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
    return databaseError(QStringLiteral("Claimed event mutation lease is missing"));
  }
  PendingMutationResult result = mutations
                                     .markFailed({.mutationId = mutation.id,
                                                  .leaseId = *mutation.leaseId,
                                                  .errorCode = errorCodeValue,
                                                  .errorMessage = message.left(4'096),
                                                  .nextRetryAt = std::move(nextRetryAt)})
                                     .get();
  return std::holds_alternative<AppError>(result)
             ? std::optional<AppError>(std::get<AppError>(std::move(result)))
             : std::nullopt;
}

} // namespace

GoogleCalendarEventMutationPushService::GoogleCalendarEventMutationPushService(
    OptimisticMutationCoordinator& mutations,
    GoogleHttpClient& httpClient,
    const Clock& clock,
    SyncBackoffPolicy backoffPolicy)
    : mutations_(mutations), httpClient_(httpClient), clock_(clock),
      backoffPolicy_(std::move(backoffPolicy)) {}

std::future<GoogleCalendarEventMutationPushResultOrError>
GoogleCalendarEventMutationPushService::pushDue(QString accessToken, int limit) {
  auto completion = std::make_shared<std::promise<GoogleCalendarEventMutationPushResultOrError>>();
  std::future<GoogleCalendarEventMutationPushResultOrError> future = completion->get_future();
  const int cappedLimit = std::clamp(limit, 1, kMaximumPushBatch);
  try {
    std::thread([this, accessToken = std::move(accessToken), cappedLimit, completion] {
      try {
        PendingMutationListResult dueResult = mutations_.listDue(kMaximumPushBatch).get();
        if (std::holds_alternative<AppError>(dueResult)) {
          completion->set_value(std::get<AppError>(std::move(dueResult)));
          return;
        }
        GoogleCalendarEventMutationPushResult summary;
        int processed = 0;
        for (const PendingMutation& pending : std::get<QList<PendingMutation>>(dueResult)) {
          if (pending.resource != PendingMutationResource::Event) {
            ++summary.skipped;
            continue;
          }
          if (processed >= cappedLimit) {
            break;
          }
          ++processed;
          PendingMutationResult claim = mutations_.claim(pending.id, kMutationLeaseDuration).get();
          if (std::holds_alternative<AppError>(claim)) {
            completion->set_value(std::get<AppError>(std::move(claim)));
            return;
          }
          PendingMutation claimed = std::get<PendingMutation>(std::move(claim));
          const EventPushRequestOrError request = buildRequest(claimed);
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
              httpClient_.send(std::get<EventPushRequest>(request).request, accessToken).get();
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
                databaseError(QStringLiteral("Claimed event mutation lease is missing")));
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
        completion->set_value(networkError(QStringLiteral("Google event mutation push failed")));
      }
    }).detach();
  } catch (...) {
    completion->set_value(networkError(QStringLiteral("Google event mutation push failed")));
  }
  return future;
}

} // namespace hcb
