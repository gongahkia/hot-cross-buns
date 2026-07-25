#pragma once

#include "core/GoogleApiError.h"

#include <QByteArray>
#include <QDateTime>
#include <QList>
#include <QNetworkAccessManager>
#include <QString>
#include <QUrl>

#include <cstdint>
#include <future>
#include <optional>
#include <variant>

namespace hcb {

enum class GoogleHttpMethod : std::uint8_t {
  Get,
  Post,
  Patch,
  Put,
  Delete
};

struct GoogleHttpQueryParameter final {
  QString name;
  QString value;
};

struct GoogleHttpRequest final {
  GoogleHttpMethod method{GoogleHttpMethod::Get};
  QString path;
  QList<GoogleHttpQueryParameter> query;
  std::optional<QByteArray> body;
  std::optional<QString> ifMatch;
};

struct GoogleHttpResponse final {
  int status;
  QByteArray body;
  std::optional<QString> serverDate;
};

using GoogleHttpResult = std::variant<GoogleHttpResponse, GoogleApiError>;

class GoogleHttpClient final : public QObject {
  Q_OBJECT

public:
  explicit GoogleHttpClient(QObject* parent = nullptr, QNetworkAccessManager* manager = nullptr);

  [[nodiscard]] std::future<GoogleHttpResult> send(GoogleHttpRequest request, QString accessToken);
  [[nodiscard]] static QUrl defaultApiEndpoint();
  [[nodiscard]] static std::optional<QUrl> buildUrl(const GoogleHttpRequest& request);
  [[nodiscard]] static GoogleHttpResult
  decodeResponse(int status,
                 QByteArray responseBody,
                 QByteArray retryAfterHeader = {},
                 QByteArray serverDateHeader = {},
                 QDateTime now = QDateTime::currentDateTimeUtc());

private:
  QNetworkAccessManager* manager_;
};

} // namespace hcb
