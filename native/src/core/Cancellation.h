#pragma once

#include <stop_token>

namespace hcb {

class CancellationSource final {
public:
  CancellationSource() = default;
  CancellationSource(const CancellationSource&) = delete;
  CancellationSource& operator=(const CancellationSource&) = delete;

  [[nodiscard]] std::stop_token token() const noexcept { return source_.get_token(); }
  [[nodiscard]] bool requestStop() noexcept { return source_.request_stop(); }
  [[nodiscard]] bool stopRequested() const noexcept { return source_.stop_requested(); }

private:
  std::stop_source source_;
};

} // namespace hcb
