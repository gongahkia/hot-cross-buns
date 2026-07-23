#include "app/AppPaths.h"

#include <QDir>
#include <QStandardPaths>

#include <utility>

namespace hcb {

AppPaths::AppPaths(DataDirectory dataDirectory, CacheDirectory cacheDirectory)
    : dataDirectory_(std::move(dataDirectory.value)),
      cacheDirectory_(std::move(cacheDirectory.value)) {}

AppPaths AppPaths::discover() {
  return AppPaths(DataDirectory{QDir::cleanPath(
                      QStandardPaths::writableLocation(QStandardPaths::AppDataLocation))},
                  CacheDirectory{QDir::cleanPath(
                      QStandardPaths::writableLocation(QStandardPaths::CacheLocation))});
}

const QString& AppPaths::dataDirectory() const noexcept { return dataDirectory_; }

const QString& AppPaths::cacheDirectory() const noexcept { return cacheDirectory_; }

} // namespace hcb
