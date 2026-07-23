#include "app/AppServices.h"

#include <utility>

namespace hcb {

AppServices::AppServices(AppPaths paths) : paths_(std::move(paths)) {}

const AppPaths& AppServices::paths() const noexcept {
  return paths_;
}

} // namespace hcb
