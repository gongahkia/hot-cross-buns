import SwiftUI

struct EventHoverPreview: View {
    @Environment(AppModel.self) private var model
    let event: CalendarEventMirror

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(accent)
                    .hcbScaledFrame(width: 4, height: 20)
                Text(event.summary)
                    .hcbFont(.headline)
                    .lineLimit(2)
            }
            VStack(alignment: .leading, spacing: 4) {
                Label(timeLabel, systemImage: "clock")
                    .hcbFont(.subheadline)
                if let cal = model.calendars.first(where: { $0.id == event.calendarID }) {
                    Label(cal.summary, systemImage: "calendar")
                        .hcbFont(.caption)
                        .foregroundStyle(.secondary)
                }
                if event.location.isEmpty == false {
                    Label(event.location, systemImage: "mappin.and.ellipse")
                        .hcbFont(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            if event.details.isEmpty == false {
                Divider()
                Text(event.details)
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(6)
            }
        }
        .hcbScaledPadding(12)
        .hcbScaledFrame(width: 300, alignment: .leading)
    }

    private var accent: Color {
        if let hex = CalendarEventColor.from(colorId: event.colorId).hex {
            return Color(hex: hex)
        }
        if let cal = model.calendars.first(where: { $0.id == event.calendarID }) {
            return Color(hex: cal.colorHex)
        }
        return AppColor.blue
    }

    private var timeLabel: String {
        if event.isAllDay {
            return "All day · \(event.startDate.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))"
        }
        let sameDay = Calendar.current.isDate(event.startDate, inSameDayAs: event.endDate)
        if sameDay {
            return "\(event.startDate.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())) – \(event.endDate.formatted(.dateTime.hour().minute()))"
        }
        return "\(event.startDate.formatted(.dateTime.month(.abbreviated).day().hour().minute())) – \(event.endDate.formatted(.dateTime.month(.abbreviated).day().hour().minute()))"
    }
}

// Popover shown on click for events in day/week/month grids. Includes an
// "Open" button to escalate to the full detail view. Agenda view keeps its
// existing row-tap-navigates behavior.
struct CalendarEventPreviewButton<Label: View>: View {
    @Environment(RouterPath.self) private var router
    let event: CalendarEventMirror
    @ViewBuilder let label: () -> Label
    @State private var isPresented = false

    var body: some View {
        Button {
            isPresented = true
        } label: {
            label()
        }
        .buttonStyle(.plain)
        .popover(isPresented: $isPresented, arrowEdge: .trailing) {
            VStack(alignment: .leading, spacing: 10) {
                EventHoverPreview(event: event)
                HStack {
                    Spacer(minLength: 0)
                    Button("Open") {
                        isPresented = false
                        router.navigate(to: .event(event.id))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppColor.ember)
                }
                .hcbScaledPadding(.horizontal, 12)
                .hcbScaledPadding(.bottom, 10)
            }
        }
    }
}

struct CalendarTaskPreviewButton<Label: View>: View {
    @Environment(RouterPath.self) private var router
    @Environment(AppModel.self) private var model
    let task: TaskMirror
    @ViewBuilder let label: () -> Label
    @State private var isPresented = false

    private var listName: String {
        model.taskLists.first(where: { $0.id == task.taskListID })?.title ?? "Unknown list"
    }

    var body: some View {
        Button {
            isPresented = true
        } label: {
            label()
        }
        .buttonStyle(.plain)
        .popover(isPresented: $isPresented, arrowEdge: .trailing) {
            VStack(alignment: .leading, spacing: 10) {
                TaskHoverPreview(task: task)
                HStack {
                    Spacer(minLength: 0)
                    Button("Open") {
                        isPresented = false
                        router.navigate(to: .task(task.id))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppColor.ember)
                }
                .hcbScaledPadding(.horizontal, 12)
                .hcbScaledPadding(.bottom, 10)
            }
        }
    }
}

struct EventHoverPreviewModifier: ViewModifier {
    let event: CalendarEventMirror
    @State private var showPreview = false
    @State private var hoverTask: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .onHover { hovering in
                hoverTask?.cancel()
                if hovering {
                    hoverTask = Task {
                        try? await Task.sleep(nanoseconds: 600_000_000)
                        guard Task.isCancelled == false else { return }
                        await MainActor.run { showPreview = true }
                    }
                } else {
                    showPreview = false
                }
            }
            .popover(isPresented: $showPreview, arrowEdge: .trailing) {
                EventHoverPreview(event: event)
            }
    }
}
