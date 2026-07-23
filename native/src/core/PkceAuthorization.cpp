#include "core/PkceAuthorization.h"

#include <QByteArray>
#include <QCryptographicHash>
#include <QMutexLocker>
#include <QRandomGenerator>

namespace hcb {
namespace {

constexpr qsizetype kStateRandomByteCount = 24;
constexpr qsizetype kCodeVerifierRandomByteCount = 64;
constexpr qsizetype kMinimumCodeVerifierLength = 43;
constexpr qsizetype kMaximumCodeVerifierLength = 128;

[[nodiscard]] QByteArray randomBytes(qsizetype count) {
  QByteArray bytes(count, Qt::Uninitialized);
  QRandomGenerator* random = QRandomGenerator::system();
  qsizetype index = 0;
  while (index < count) {
    quint32 value = random->generate();
    for (int byteIndex = 0; byteIndex < 4 && index < count; ++byteIndex) {
      bytes[index] = static_cast<char>(value & 0xffU);
      value >>= 8U;
      ++index;
    }
  }
  return bytes;
}

[[nodiscard]] QString randomBase64Url(qsizetype byteCount) {
  return QString::fromLatin1(randomBytes(byteCount).toBase64(QByteArray::Base64UrlEncoding |
                                                             QByteArray::OmitTrailingEquals));
}

[[nodiscard]] bool isCodeVerifierCharacter(QChar character) noexcept {
  const ushort value = character.unicode();
  return (value >= u'A' && value <= u'Z') || (value >= u'a' && value <= u'z') ||
         (value >= u'0' && value <= u'9') || value == u'-' || value == u'.' || value == u'_' ||
         value == u'~';
}

} // namespace

QString PkceAuthorization::generateCodeVerifier() {
  return randomBase64Url(kCodeVerifierRandomByteCount);
}

QString PkceAuthorization::generateState() { return randomBase64Url(kStateRandomByteCount); }

std::optional<QString> PkceAuthorization::codeChallengeForVerifier(QStringView codeVerifier) {
  if (!isValidCodeVerifier(codeVerifier)) {
    return std::nullopt;
  }
  return QString::fromLatin1(
      QCryptographicHash::hash(codeVerifier.toUtf8(), QCryptographicHash::Sha256)
          .toBase64(QByteArray::Base64UrlEncoding | QByteArray::OmitTrailingEquals));
}

bool PkceAuthorization::isValidCodeVerifier(QStringView codeVerifier) noexcept {
  if (codeVerifier.size() < kMinimumCodeVerifierLength ||
      codeVerifier.size() > kMaximumCodeVerifierLength) {
    return false;
  }
  for (const QChar character : codeVerifier) {
    if (!isCodeVerifierCharacter(character)) {
      return false;
    }
  }
  return true;
}

PkceAuthorizationRequest PkceStateRegistry::begin() {
  const QString state = PkceAuthorization::generateState();
  const QString codeVerifier = PkceAuthorization::generateCodeVerifier();
  const std::optional<QString> codeChallenge =
      PkceAuthorization::codeChallengeForVerifier(codeVerifier);
  Q_ASSERT(codeChallenge.has_value());

  QMutexLocker locker(&mutex_);
  pendingStates_.insert(
      state, {.codeVerifier = codeVerifier, .expiresAt = clock_.monotonicNow() + kStateTtl});
  return {state, *codeChallenge};
}

PkceStateValidationResult PkceStateRegistry::consume(QStringView state) {
  QMutexLocker locker(&mutex_);
  const auto iterator = pendingStates_.find(state.toString());
  if (iterator == pendingStates_.end()) {
    return {.status = PkceStateValidationStatus::Unrecognized};
  }

  const PendingState pendingState = iterator.value();
  pendingStates_.erase(iterator);
  if (pendingState.expiresAt <= clock_.monotonicNow()) {
    return {.status = PkceStateValidationStatus::Expired};
  }
  return {.status = PkceStateValidationStatus::Accepted, .codeVerifier = pendingState.codeVerifier};
}

} // namespace hcb
