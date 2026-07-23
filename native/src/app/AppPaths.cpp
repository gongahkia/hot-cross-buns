#include "app/AppPaths.h"

#include <QDir>
#include <QStandardPaths>

#include <utility>

namespace hcb {

AppPaths::AppPaths(QString dataDirectory, QString cacheDirectory)
    : dataDirectory_(std::move(dataDirectory)), cacheDirectory_(std::move(cacheDirectory)) {}

AppPaths AppPaths::discover() {
  return AppPaths(
      QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::AppDataLocation)),
      QDir::cleanPath(QStandardPaths::writableLocation(QStandardPaths::CacheLocation)));
}

const QString& AppPaths::dataDirectory() const noexcept {
  return dataDirectory_;
}

const QString& AppPaths::cacheDirectory() const noexcept {
  return cacheDirectory_;
}

} // namespace hcb
