#include "core/OAuthTokenExchangeClient.h"

#include "core/PkceAuthorization.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QUrlQuery>

#include <future>
#include <utility>

namespace hcb {
namespace {

constexpr qsizetype kMaximumTokenLength = 8'192;
constexpr qsizetype kMaximumScopeLength = 8'192;

[[nodiscard]] AppError validationError(QString message) {
  return AppError(AppErrorCode::Validation, std::move(message));
}

[[nodiscard]] AppError networkError(QString message) {
  return AppError(AppErrorCode::Network, std::move(message));
}

template <typename Result> [[nodiscard]] std::future<Result> readyFuture(Result result) {
  std::promise<Result> completion;
  std::future<Result> future = completion.get_future();
  completion.set_value(std::move(result));
  return future;
}

[[nodiscard]] bool isValidText(const QString& value, qsizetype maximumLength) {
  return !value.isEmpty() && value.size() <= maximumLength && !value.contains(QChar::Null);
}

[[nodiscard]] bool isGoogleTokenEndpoint(const QUrl& endpoint) {
  return endpoint.isValid() && endpoint.scheme() == QStringLiteral("https") &&
         endpoint.host().compare(QStringLiteral("oauth2.googleapis.com"), Qt::CaseInsensitive) ==
             0 &&
         (endpoint.port() == -1 || endpoint.port() == 443) && endpoint.userInfo().isEmpty() &&
         endpoint.fragment().isEmpty() && endpoint.path() == QStringLiteral("/token");
}

[[nodiscard]] bool isLoopbackRedirectUri(const QUrl& uri) {
  return uri.isValid() && uri.scheme() == QStringLiteral("http") &&
         uri.host() == QStringLiteral("127.0.0.1") && uri.port() > 0 &&
         uri.path() == QStringLiteral("/oauth/google/callback") && uri.query().isEmpty() &&
         uri.fragment().isEmpty() && uri.userInfo().isEmpty();
}

[[nodiscard]] bool isValidRequest(const OAuthTokenExchangeRequest& request) {
  return isValidText(request.code, kMaximumTokenLength) &&
         PkceAuthorization::isValidCodeVerifier(request.codeVerifier) &&
         isLoopbackRedirectUri(request.redirectUri) && request.clientId.size() >= 10 &&
         request.clientId.size() <= 500 && !request.clientId.contains(QChar::Null) &&
         (!request.clientSecret.has_value() ||
          isValidText(*request.clientSecret, kMaximumTokenLength));
}

} // namespace

OAuthTokenExchangeClient::OAuthTokenExchangeClient(QObject* parent, QUrl tokenEndpoint)
    : QObject(parent), manager_(this), tokenEndpoint_(std::move(tokenEndpoint)) {}

std::future<OAuthTokenExchangeResult>
OAuthTokenExchangeClient::exchange(OAuthTokenExchangeRequest request) {
  if (!isGoogleTokenEndpoint(tokenEndpoint_) || !isValidRequest(request)) {
    return readyFuture(OAuthTokenExchangeResult(
        validationError(QStringLiteral("OAuth token exchange input is invalid"))));
  }
  QUrlQuery form;
  form.addQueryItem(QStringLiteral("grant_type"), QStringLiteral("authorization_code"));
  form.addQueryItem(QStringLiteral("code"), request.code);
  form.addQueryItem(QStringLiteral("code_verifier"), request.codeVerifier);
  form.addQueryItem(QStringLiteral("redirect_uri"),
                    request.redirectUri.toString(QUrl::FullyEncoded));
  form.addQueryItem(QStringLiteral("client_id"), request.clientId);
  if (request.clientSecret.has_value()) {
    form.addQueryItem(QStringLiteral("client_secret"), *request.clientSecret);
  }
  QNetworkRequest networkRequest(tokenEndpoint_);
  networkRequest.setHeader(QNetworkRequest::ContentTypeHeader,
                           QStringLiteral("application/x-www-form-urlencoded"));
  networkRequest.setRawHeader("Accept", "application/json");
  QNetworkReply* const reply =
      manager_.post(networkRequest, form.toString(QUrl::FullyEncoded).toUtf8());
  auto completion = std::make_shared<std::promise<OAuthTokenExchangeResult>>();
  std::future<OAuthTokenExchangeResult> future = completion->get_future();
  connect(reply, &QNetworkReply::finished, this, [reply, completion] {
    const QByteArray responseBody = reply->readAll();
    const auto status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const OAuthTokenExchangeResult result =
        reply->error() == QNetworkReply::NoError && status >= 200 && status <= 299
            ? OAuthTokenExchangeClient::decodeTokenResponse(responseBody)
            : OAuthTokenExchangeResult(networkError(QStringLiteral("OAuth token exchange failed")));
    completion->set_value(result);
    reply->deleteLater();
  });
  return future;
}

QUrl OAuthTokenExchangeClient::defaultTokenEndpoint() {
  return QUrl(QStringLiteral("https://oauth2.googleapis.com/token"));
}

OAuthTokenExchangeResult
OAuthTokenExchangeClient::decodeTokenResponse(const QByteArray& responseBody) {
  const QJsonDocument document = QJsonDocument::fromJson(responseBody);
  if (!document.isObject()) {
    return networkError(QStringLiteral("OAuth token response is invalid"));
  }
  const QJsonObject object = document.object();
  const QString accessToken = object.value(QStringLiteral("access_token")).toString();
  const QString refreshToken = object.value(QStringLiteral("refresh_token")).toString();
  const QString scope = object.value(QStringLiteral("scope")).toString();
  const QString tokenType = object.value(QStringLiteral("token_type")).toString();
  const QJsonValue expiresValue = object.value(QStringLiteral("expires_in"));
  const int expiresIn = expiresValue.toInt(-1);
  if (!isValidText(accessToken, kMaximumTokenLength) ||
      (object.contains(QStringLiteral("refresh_token")) &&
       !isValidText(refreshToken, kMaximumTokenLength)) ||
      (object.contains(QStringLiteral("scope")) && !isValidText(scope, kMaximumScopeLength)) ||
      (object.contains(QStringLiteral("token_type")) && !isValidText(tokenType, 64)) ||
      (object.contains(QStringLiteral("expires_in")) &&
       (expiresIn <= 0 || expiresIn > 2'592'000))) {
    return networkError(QStringLiteral("OAuth token response is invalid"));
  }
  return OAuthTokenSet{
      .accessToken = accessToken,
      .refreshToken = object.contains(QStringLiteral("refresh_token"))
                          ? std::optional<QString>(refreshToken)
                          : std::nullopt,
      .expiresInSeconds = object.contains(QStringLiteral("expires_in"))
                              ? std::optional<int>(expiresIn)
                              : std::nullopt,
      .scope =
          object.contains(QStringLiteral("scope")) ? std::optional<QString>(scope) : std::nullopt,
      .tokenType = object.contains(QStringLiteral("token_type")) ? std::optional<QString>(tokenType)
                                                                 : std::nullopt};
}

} // namespace hcb
