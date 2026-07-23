#pragma once

#include <QString>

namespace hcb {

class AppPaths final {
public:
  [[nodiscard]] static AppPaths discover();

  [[nodiscard]] const QString& dataDirectory() const noexcept;
  [[nodiscard]] const QString& cacheDirectory() const noexcept;

private:
  struct DataDirectory final {
    QString value;
  };
  struct CacheDirectory final {
    QString value;
  };

  AppPaths(DataDirectory dataDirectory, CacheDirectory cacheDirectory);

  QString dataDirectory_;
  QString cacheDirectory_;
};

} // namespace hcb
