#include "app/AppPaths.h"

#include <QStandardPaths>

#include <utility>

namespace hcb {

AppPaths::AppPaths(DataDirectory dataDirectory, CacheDirectory cacheDirectory)
    : dataDirectory_(std::move(dataDirectory.value)),
      cacheDirectory_(std::move(cacheDirectory.value)) {}

std::optional<AppPaths> AppPaths::discover() {
  const std::optional<FilePath> dataDirectory =
      FilePath::fromAbsolute(QStandardPaths::writableLocation(QStandardPaths::AppDataLocation));
  const std::optional<FilePath> cacheDirectory =
      FilePath::fromAbsolute(QStandardPaths::writableLocation(QStandardPaths::CacheLocation));
  if (!dataDirectory.has_value() || !cacheDirectory.has_value()) {
    return std::nullopt;
  }
  return AppPaths(DataDirectory{*dataDirectory}, CacheDirectory{*cacheDirectory});
}

AppPaths AppPaths::fromDirectories(FilePath dataDirectory, FilePath cacheDirectory) {
  return AppPaths(DataDirectory{std::move(dataDirectory)},
                  CacheDirectory{std::move(cacheDirectory)});
}

const FilePath& AppPaths::dataDirectory() const noexcept { return dataDirectory_; }

const FilePath& AppPaths::cacheDirectory() const noexcept { return cacheDirectory_; }

} // namespace hcb
