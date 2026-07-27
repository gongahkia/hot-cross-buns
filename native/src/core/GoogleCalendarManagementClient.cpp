#include "core/GoogleCalendarManagementClient.h"

#include "core/GoogleHttpClient.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QTimeZone>

#include <future>
#include <optional>
#include <utility>

namespace hcb {
namespace {

constexpr qsizetype kMaximumCalendarIdLength = 256;
constexpr qsizetype kMaximumCalendarTitleLength = 500;
constexpr qsizetype kMaximumDescriptionLength = 20'000;
constexpr qsizetype kMaximumTimeZoneLength = 120;
constexpr qsizetype kMaximumColorIdLength = 32;

[[nodiscard]] GoogleApiError invalidInput() {
  return GoogleApiError({.kind = GoogleApiErrorKind::InvalidPayload,
                         .message = QStringLiteral("Google calendar management input is invalid")});
}

[[nodiscard]] GoogleApiError invalidResponse() {
  return GoogleApiError({.kind = GoogleApiErrorKind::InvalidPayload,
                         .message = QStringLiteral("Google calendar management response is invalid")});
}

[[nodiscard]] bool validRequiredText(const QString& value, qsizetype maximum) {
  return !value.isEmpty() && value == value.trimmed() && value.size() <= maximum &&
         !value.contains(QChar::Null);
}

[[nodiscard]] bool validOptionalText(const std::optional<QString>& value, qsizetype maximum) {
  return !value.has_value() || (value->size() <= maximum && !value->contains(QChar::Null));
}

[[nodiscard]] bool validTimeZone(const std::optional<QString>& value) {
  return !value.has_value() ||
         (validRequiredText(*value, kMaximumTimeZoneLength) && QTimeZone(value->toUtf8()).isValid());
}

[[nodiscard]] std::optional<QString> responseId(const GoogleHttpResponse& response) {
  QJsonParseError error;
  const QJsonDocument document = QJsonDocument::fromJson(response.body, &error);
  if (error.error != QJsonParseError::NoError || !document.isObject()) {
    return std::nullopt;
  }
  const QJsonValue id = document.object().value(QStringLiteral("id"));
  return id.isString() && validRequiredText(id.toString(), kMaximumCalendarIdLength)
             ? std::optional<QString>(id.toString()) : std::nullopt;
}

} // namespace

GoogleCalendarManagementClient::GoogleCalendarManagementClient(GoogleHttpClient& httpClient)
    : httpClient_(httpClient) {}

std::future<GoogleCalendarManagementResultOrError>
GoogleCalendarManagementClient::create(GoogleCalendarCreateRequest request, QString accessToken) {
  request.title = request.title.trimmed();
  if (!validRequiredText(request.title, kMaximumCalendarTitleLength) ||
      !validOptionalText(request.description, kMaximumDescriptionLength) ||
      !validTimeZone(request.timeZone)) {
    std::promise<GoogleCalendarManagementResultOrError> completion;
    std::future<GoogleCalendarManagementResultOrError> future = completion.get_future();
    completion.set_value(invalidInput());
    return future;
  }
  return std::async(std::launch::async,
                    [this, request = std::move(request), accessToken = std::move(accessToken)] {
                      QJsonObject body{{QStringLiteral("summary"), request.title}};
                      if (request.description.has_value()) {
                        body.insert(QStringLiteral("description"), *request.description);
                      }
                      if (request.timeZone.has_value()) {
                        body.insert(QStringLiteral("timeZone"), *request.timeZone);
                      }
                      GoogleHttpRequest httpRequest{.method = GoogleHttpMethod::Post,
                                                    .path = QStringLiteral("/calendar/v3/calendars"),
                                                    .body = QJsonDocument(body).toJson(QJsonDocument::Compact)};
                      GoogleHttpResult response = httpClient_.send(std::move(httpRequest), accessToken).get();
                      if (std::holds_alternative<GoogleApiError>(response)) {
                        return GoogleCalendarManagementResultOrError(
                            std::get<GoogleApiError>(std::move(response)));
                      }
                      const std::optional<QString> id =
                          responseId(std::get<GoogleHttpResponse>(response));
                      return id.has_value()
                                 ? GoogleCalendarManagementResultOrError(
                                       GoogleCalendarManagementResult{.calendarId = *id})
                                 : GoogleCalendarManagementResultOrError(invalidResponse());
                    });
}

std::future<GoogleCalendarManagementResultOrError>
GoogleCalendarManagementClient::subscribe(GoogleCalendarSubscribeRequest request,
                                           QString accessToken) {
  if (!validRequiredText(request.calendarId, kMaximumCalendarIdLength) ||
      !validOptionalText(request.colorId, kMaximumColorIdLength)) {
    std::promise<GoogleCalendarManagementResultOrError> completion;
    std::future<GoogleCalendarManagementResultOrError> future = completion.get_future();
    completion.set_value(invalidInput());
    return future;
  }
  return std::async(std::launch::async,
                    [this, request = std::move(request), accessToken = std::move(accessToken)] {
                      QJsonObject body{{QStringLiteral("id"), request.calendarId},
                                       {QStringLiteral("selected"), request.selected},
                                       {QStringLiteral("hidden"), request.hidden}};
                      if (request.colorId.has_value()) {
                        body.insert(QStringLiteral("colorId"), *request.colorId);
                      }
                      GoogleHttpRequest httpRequest{
                          .method = GoogleHttpMethod::Post,
                          .path = QStringLiteral("/calendar/v3/users/me/calendarList"),
                          .body = QJsonDocument(body).toJson(QJsonDocument::Compact)};
                      GoogleHttpResult response = httpClient_.send(std::move(httpRequest), accessToken).get();
                      if (std::holds_alternative<GoogleApiError>(response)) {
                        return GoogleCalendarManagementResultOrError(
                            std::get<GoogleApiError>(std::move(response)));
                      }
                      const std::optional<QString> id =
                          responseId(std::get<GoogleHttpResponse>(response));
                      return id.has_value()
                                 ? GoogleCalendarManagementResultOrError(
                                       GoogleCalendarManagementResult{.calendarId = *id})
                                 : GoogleCalendarManagementResultOrError(invalidResponse());
                    });
}

} // namespace hcb
