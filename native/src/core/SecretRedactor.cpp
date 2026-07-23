#include "core/SecretRedactor.h"

#include <QRegularExpression>

namespace hcb {
namespace {

const QString kRedactedValue = QStringLiteral("[redacted]");

const QRegularExpression kSensitiveKeyPattern(
    QStringLiteral(
        R"((?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|mcp[_-]?token|bearer[_-]?token|api[_-]?key|password|credential|secret|token|authorization))"),
    QRegularExpression::CaseInsensitiveOption);
const QRegularExpression kSecretAssignmentPattern(
    QStringLiteral(
        R"(\b([A-Za-z0-9_-]*(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|mcp[_-]?token|bearer[_-]?token|api[_-]?key|password|credential|secret|token|authorization)[A-Za-z0-9_-]*)\b\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^"',\s)}\]]+))"),
    QRegularExpression::CaseInsensitiveOption);
const QRegularExpression kJsonSecretPattern(
    QStringLiteral(
        R"((['"])(access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|mcp[_-]?token|bearer[_-]?token|api[_-]?key|password|credential|secret|token|authorization)\1\s*:\s*(['"])(?:(?!\3).)*\3)"),
    QRegularExpression::CaseInsensitiveOption);
const QRegularExpression kBearerPattern(QStringLiteral(R"(\bBearer\s+[A-Za-z0-9._~+/=-]+)"),
                                        QRegularExpression::CaseInsensitiveOption);
const QRegularExpression
    kOAuthQueryPattern(QStringLiteral(R"(\b(code|code_verifier|codeVerifier|state)=([^&\s]+))"),
                       QRegularExpression::CaseInsensitiveOption);
const QRegularExpression kNewlinePattern(QStringLiteral(R"([\r\n]+)"));

QString replaceAssignments(const QString& input) {
  QString output;
  qsizetype previousEnd = 0;
  QRegularExpressionMatchIterator matches = kSecretAssignmentPattern.globalMatch(input);
  while (matches.hasNext()) {
    const QRegularExpressionMatch match = matches.next();
    output.append(input.mid(previousEnd, match.capturedStart() - previousEnd));
    output.append(match.capturedView(1));
    output.append(match.capturedView(2));
    output.append(kRedactedValue);
    previousEnd = match.capturedEnd();
  }
  output.append(input.mid(previousEnd));
  return output;
}

QString replaceJsonSecrets(const QString& input) {
  QString output;
  qsizetype previousEnd = 0;
  QRegularExpressionMatchIterator matches = kJsonSecretPattern.globalMatch(input);
  while (matches.hasNext()) {
    const QRegularExpressionMatch match = matches.next();
    const QStringView quote = match.capturedView(1);
    output.append(input.mid(previousEnd, match.capturedStart() - previousEnd));
    output.append(quote);
    output.append(match.capturedView(2));
    output.append(quote);
    output.append(QStringLiteral(": "));
    output.append(match.capturedView(3));
    output.append(kRedactedValue);
    output.append(match.capturedView(3));
    previousEnd = match.capturedEnd();
  }
  output.append(input.mid(previousEnd));
  return output;
}

QString replaceOAuthQueryParameters(const QString& input) {
  QString output;
  qsizetype previousEnd = 0;
  QRegularExpressionMatchIterator matches = kOAuthQueryPattern.globalMatch(input);
  while (matches.hasNext()) {
    const QRegularExpressionMatch match = matches.next();
    output.append(input.mid(previousEnd, match.capturedStart() - previousEnd));
    output.append(match.capturedView(1));
    output.append(u'=');
    output.append(kRedactedValue);
    previousEnd = match.capturedEnd();
  }
  output.append(input.mid(previousEnd));
  return output;
}

} // namespace

QString SecretRedactor::redactText(QStringView value, qsizetype maximumLength) {
  QString redacted = value.toString();
  redacted.replace(kBearerPattern, QStringLiteral("Bearer [redacted]"));
  redacted = replaceJsonSecrets(redacted);
  redacted = replaceAssignments(redacted);
  redacted = replaceOAuthQueryParameters(redacted);
  redacted.replace(kNewlinePattern, QStringLiteral(" "));
  return redacted.trimmed().left(qMax<qsizetype>(maximumLength, 0));
}

QString SecretRedactor::redactKey(QStringView key) {
  return isSensitiveKey(key) ? kRedactedValue : redactText(key, 120);
}

bool SecretRedactor::isSensitiveKey(QStringView key) {
  return kSensitiveKeyPattern.match(key.toString()).hasMatch();
}

} // namespace hcb
