#pragma once

#include "core/GoogleApiError.h"

#include <QList>
#include <QString>

#include <cstdint>
#include <future>
#include <optional>
#include <variant>

namespace hcb {

class GoogleHttpClient;

enum class GoogleCalendarEventStatus : std::uint8_t {
  Confirmed,
  Tentative,
  Cancelled
};

struct GoogleCalendarEventMirror final {
  QString id;
  QString calendarId;
  GoogleCalendarEventStatus status;
  QString title;
  std::optional<QString> description;
  std::optional<QString> location;
  std::optional<QString> startAt;
  std::optional<QString> startTimeZone;
  std::optional<QString> endAt;
  std::optional<QString> endTimeZone;
  bool allDay;
  std::optional<QString> recurringEventId;
  std::optional<QString> originalStartAt;
  QList<QString> recurrence;
  std::optional<QString> colorId;
  std::optional<QString> transparency;
  std::optional<QString> visibility;
  std::optional<QString> timeZone;
  std::optional<QString> eventType;
  std::optional<QString> etag;
  std::optional<qint64> sequence;
  std::optional<QString> updatedAt;
};

struct GoogleCalendarEventPullRequest final {
  QString calendarId;
  std::optional<QString> syncToken;
};

struct GoogleCalendarEventPullResult final {
  QList<GoogleCalendarEventMirror> events;
  std::optional<QString> nextSyncToken;
  std::optional<QString> serverDate;
};

using GoogleCalendarEventPullResultOrError =
    std::variant<GoogleCalendarEventPullResult, GoogleApiError>;

class GoogleCalendarEventPullClient final {
public:
  explicit GoogleCalendarEventPullClient(GoogleHttpClient& httpClient);

  [[nodiscard]] std::future<GoogleCalendarEventPullResultOrError>
  list(GoogleCalendarEventPullRequest request, const QString& accessToken);

private:
  GoogleHttpClient& httpClient_;
};

} // namespace hcb
