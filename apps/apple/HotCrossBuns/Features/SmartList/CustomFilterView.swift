import SwiftUI

struct CustomFilterView: View {
    @Environment(AppModel.self) private var model
    let filterID: CustomFilterDefinition.ID

    @State private var selection: TaskMirror.ID?
    @State private var isInspectorPresented = true
    @State private var searchQuery: String = ""

    var body: some View {
        Group {
            if let filter = definition {
                content(filter: filter)
            } else {
                ContentUnavailableView(
                    "Filter was removed",
                    systemImage: "line.3.horizontal.decrease.circle",
                    description: Text("Open Settings → Custom Filters to manage filters.")
                )
            }
        }
        .appBackground()
        .navigationTitle(definition?.name ?? "Filter")
    }

    private var definition: CustomFilterDefinition? {
        model.settings.customFilters.first(where: { $0.id == filterID })
    }

    private func content(filter: CustomFilterDefinition) -> some View {
        let matches: [TaskMirror] = model.tasks.filter { filter.matches($0) }
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let visible: [TaskMirror] = q.isEmpty
            ? matches
            : matches.filter {
                $0.title.localizedCaseInsensitiveContains(q) ||
                $0.notes.localizedCaseInsensitiveContains(q)
            }

        return Group {
            if visible.isEmpty {
                ContentUnavailableView(
                    "Nothing matches",
                    systemImage: filter.systemImage,
                    description: Text("Adjust the filter in Settings → Custom Filters.")
                )
            } else {
                List(selection: $selection) {
                    Section("\(visible.count) \(visible.count == 1 ? "task" : "tasks")") {
                        ForEach(visible) { task in
                            TaskRow(task: task)
                                .tag(task.id)
                                .contentShape(Rectangle())
                        }
                    }
                }
                .searchable(text: $searchQuery, placement: .sidebar, prompt: "Filter matches")
            }
        }
        .inspector(isPresented: inspectorBinding) {
            inspectorContent
                .inspectorColumnWidth(min: 340, ideal: 380, max: 520)
        }
    }

    @ViewBuilder
    private var inspectorContent: some View {
        if let id = selection, let task = model.task(id: id) {
            TaskInspectorView(task: task, close: {
                selection = nil
                isInspectorPresented = false
            })
        } else {
            TaskInspectorEmptyState()
        }
    }

    private var inspectorBinding: Binding<Bool> {
        Binding(
            get: { isInspectorPresented },
            set: { isInspectorPresented = $0 }
        )
    }
}

private struct TaskRow: View {
    let task: TaskMirror

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(task.isCompleted ? AppColor.moss : AppColor.ember)
            VStack(alignment: .leading, spacing: 2) {
                Text(TagExtractor.stripped(from: TaskStarring.displayTitle(for: task)))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(AppColor.ink)
                if let due = task.dueDate {
                    Text(due.formatted(.dateTime.month(.abbreviated).day()))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
    }
}
