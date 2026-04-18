import SwiftUI

struct UndoToast: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack {
            Spacer(minLength: 0)
            if let id = model.recentlyCompletedTaskID, let task = model.task(id: id) {
                content(task: task)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: id) {
                        try? await Task.sleep(for: .seconds(5))
                        if model.recentlyCompletedTaskID == id {
                            model.clearRecentCompletion()
                        }
                    }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: model.recentlyCompletedTaskID)
        .allowsHitTesting(model.recentlyCompletedTaskID != nil)
    }

    private func content(task: TaskMirror) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(AppColor.moss)
            VStack(alignment: .leading, spacing: 2) {
                Text("Completed")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(TaskStarring.displayTitle(for: task))
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
            }
            Spacer(minLength: 16)
            Button("Undo") {
                Task { await model.undoRecentCompletion() }
            }
            .buttonStyle(.bordered)
            Button {
                model.clearRecentCompletion()
            } label: {
                Image(systemName: "xmark")
                    .font(.caption)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.regularMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(AppColor.cardStroke, lineWidth: 0.8)
        )
        .shadow(color: .black.opacity(0.15), radius: 10, x: 0, y: 3)
        .padding(18)
    }
}
