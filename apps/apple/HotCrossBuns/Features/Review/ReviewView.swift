import SwiftUI

struct ReviewView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                header
                ForEach(summaries) { summary in
                    card(summary: summary)
                }
                if summaries.isEmpty {
                    ContentUnavailableView(
                        "No task lists",
                        systemImage: "checklist.checked",
                        description: Text("Connect Google to load your task lists for review.")
                    )
                    .padding(.top, 80)
                }
            }
            .padding(20)
        }
        .appBackground()
        .navigationTitle("Review")
    }

    private var summaries: [ReviewListSummary] {
        let visible: Set<TaskListMirror.ID> = model.settings.hasConfiguredTaskListSelection
            ? model.settings.selectedTaskListIDs
            : Set(model.taskLists.map(\.id))
        return ReviewBuilder.build(
            taskLists: model.taskLists,
            tasks: model.tasks,
            visibleTaskListIDs: visible
        )
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Weekly review")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text("Surface lists that haven't been touched recently so nothing drifts.")
                .font(.title3)
                .foregroundStyle(AppColor.ink)
        }
    }

    private func card(summary: ReviewListSummary) -> some View {
        let stale = (summary.daysSinceActivity ?? 0) >= ReviewBuilder.staleAfterDays
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Label(summary.taskList.title, systemImage: "checklist")
                    .font(.headline)
                Spacer(minLength: 0)
                if let days = summary.daysSinceActivity {
                    Text(days == 0 ? "Active today" : "\(days) day\(days == 1 ? "" : "s") idle")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(stale ? AppColor.ember : .secondary)
                } else {
                    Text("No activity recorded")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if summary.openTasks.isEmpty {
                Text("Inbox zero — all items complete.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 6) {
                    ForEach(summary.openTasks.prefix(5)) { task in
                        Button {
                            router.navigate(to: .task(task.id))
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "circle")
                                    .foregroundStyle(AppColor.ember)
                                Text(TagExtractor.stripped(from: TaskStarring.displayTitle(for: task)))
                                    .font(.subheadline)
                                    .foregroundStyle(AppColor.ink)
                                Spacer(minLength: 0)
                                if let due = task.dueDate {
                                    Text(due.formatted(.dateTime.month(.abbreviated).day()))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(10)
                            .background(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(AppColor.cream.opacity(0.4))
                            )
                        }
                        .buttonStyle(.plain)
                    }
                    if summary.openTasks.count > 5 {
                        Text("+\(summary.openTasks.count - 5) more")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(stale ? AppColor.ember.opacity(0.08) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(stale ? AppColor.ember.opacity(0.35) : AppColor.cardStroke, lineWidth: stale ? 1 : 0.6)
        )
    }
}
