#pragma once

#include "app/AppPaths.h"

namespace hcb {

class AppServices final {
public:
  explicit AppServices(AppPaths paths);

  [[nodiscard]] const AppPaths& paths() const noexcept;

private:
  AppPaths paths_;
};

} // namespace hcb
