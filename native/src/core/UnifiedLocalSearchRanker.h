#pragma once

#include <QList>
#include <QString>

#include <cstdint>

namespace hcb {

enum class LocalSearchResource : std::uint8_t {
  TaskList,
  Task,
  Note,
  Calendar,
  Event
};

struct LocalSearchCandidate final {
  LocalSearchResource resource{LocalSearchResource::Task};
  QString id;
  QString title;
  QString detail;
};

struct LocalSearchRankedResult final {
  LocalSearchResource resource{LocalSearchResource::Task};
  QString id;
  QString title;
  QString detail;
  int score{0};
};

class UnifiedLocalSearchRanker final {
public:
  [[nodiscard]] QList<LocalSearchRankedResult>
  rank(QString query, QList<LocalSearchCandidate> candidates, int limit = 50) const;
};

} // namespace hcb
