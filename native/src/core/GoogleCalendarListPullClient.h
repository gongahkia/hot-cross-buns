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

enum class GoogleCalendarAccessRole : std::uint8_t {
  FreeBusyReader,
  Reader,
  Writer,
  Owner
};

struct GoogleCalendarMirror final {
  QString id;
  QString title;
  std::optional<QString> description;
  std::optional<QString> timeZone;
  std::optional<QString> backgroundColor;
  std::optional<QString> foregroundColor;
  std::optional<GoogleCalendarAccessRole> accessRole;
  bool selected;
  bool hidden;
  bool primary;
  bool deleted;
  std::optional<QString> etag;
};

struct GoogleCalendarListPullResult final {
  QList<GoogleCalendarMirror> calendars;
  std::optional<QString> serverDate;
};

using GoogleCalendarListPullResultOrError =
    std::variant<GoogleCalendarListPullResult, GoogleApiError>;

class GoogleCalendarListPullClient final {
public:
  explicit GoogleCalendarListPullClient(GoogleHttpClient& httpClient);

  [[nodiscard]] std::future<GoogleCalendarListPullResultOrError> list(QString accessToken);

private:
  GoogleHttpClient& httpClient_;
};

} // namespace hcb
