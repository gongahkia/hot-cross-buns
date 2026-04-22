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
        .hcbScaledFrame(minWidth: 260, idealWidth: 300, maxWidth: 420, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
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
    @Environment(\.routerPath) private var router
    @Environment(AppModel.self) private var model
    let event: CalendarEventMirror
    @ViewBuilder let label: () -> Label
    @State private var isPresented = false
    @State private var isConfirmingDelete = false

    var body: some View {
        Button {
            isPresented = true
        } label: {
            label()
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Open…") {
                router?.present(.editEvent(event.id))
            }
            Button("Mark as Done") {
                Task { _ = await model.dismissEvent(event) }
            }
            Button("Duplicate") {
                Task { _ = await model.duplicateEvent(event) }
            }
            Divider()
            Menu("Convert…") {
                Button("Convert to Task") {
                    router?.present(.convertEventToTask(event.id))
                }
                Button("Convert to Note") {
                    router?.present(.convertEventToNote(event.id))
                }
            }
            Button("Copy as Markdown") {
                let md = EventICSExporter.ics(for: event)
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(md, forType: .string)
            }
            Divider()
            Button("Delete", role: .destructive) {
                isConfirmingDelete = true
            }
        }
        .confirmationDialog(
            "Delete \"\(event.summary)\"?",
            isPresented: $isConfirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                Task { _ = await model.deleteEvent(event) }
            }
            Button("Cancel", role: .cancel) {}
        }
        .popover(isPresented: $isPresented, arrowEdge: .trailing) {
            VStack(alignment: .leading, spacing: 10) {
                EventHoverPreview(event: event)
                HStack(spacing: 8) {
                    // Left-aligned circle button mirrors the task completion
                    // affordance. Hidden on read-only calendars.
                    CalendarEventDismissButton(event: event, size: 16)
                    Spacer(minLength: 0)
                    Button("Open") {
                        isPresented = false
                        router?.present(.editEvent(event.id))
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
    @Environment(\.routerPath) private var router
    @Environment(AppModel.self) private var model
    let task: TaskMirror
    @ViewBuilder let label: () -> Label
    @State private var isPresented = false
    @State private var isConfirmingDelete = false

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
        .contextMenu {
            Button("Open…") {
                router?.present(.editTask(task.id))
            }
            Button(task.isCompleted ? "Mark as Needs Action" : "Mark Complete") {
                Task { _ = await model.setTaskCompleted(!task.isCompleted, task: task) }
            }
            Button("Duplicate") {
                Task { _ = await model.duplicateTask(task) }
            }
            Divider()
            Menu("Convert…") {
                Button("Convert to Event") {
                    router?.present(.convertTaskToEvent(task.id))
                }
                if task.dueDate == nil {
                    Button("Set Due Date…") {
                        router?.present(.convertNoteToTask(task.id))
                    }
                } else {
                    Button("Clear Due Date") {
                        router?.present(.convertTaskToNote(task.id))
                    }
                }
            }
            Button("Copy as Markdown") {
                let md = TaskMarkdownExporter.markdown(for: task, taskListTitle: listName)
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(md, forType: .string)
            }
            Divider()
            Button("Delete", role: .destructive) {
                isConfirmingDelete = true
            }
        }
        .confirmationDialog(
            "Delete \"\(task.title)\"?",
            isPresented: $isConfirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                Task { _ = await model.deleteTask(task) }
            }
            Button("Cancel", role: .cancel) {}
        }
        .popover(isPresented: $isPresented, arrowEdge: .trailing) {
            VStack(alignment: .leading, spacing: 10) {
                TaskHoverPreview(task: task)
                HStack {
                    Spacer(minLength: 0)
                    Button("Open") {
                        isPresented = false
                        router?.present(.editTask(task.id))
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

// Clickable circle-checkmark on calendar event tiles. Google Calendar has
// no completion concept, so clicking this deletes the event on Google —
// but the history log + undo toast record it as .eventDismissed so the
// user sees "Marked 'X' as done" rather than a delete, and Undo recreates
// the event from the snapshot. Hidden when the event's calendar is not
// writeable by the user (reader / freeBusyReader access role).
struct CalendarEventDismissButton: View {
    @Environment(AppModel.self) private var model
    let event: CalendarEventMirror
    var size: CGFloat = 10

    private var canWrite: Bool {
        guard let calendar = model.calendars.first(where: { $0.id == event.calendarID }) else { return false }
        return calendar.accessRole == "owner" || calendar.accessRole == "writer"
    }

    var body: some View {
        if canWrite {
            Button {
                Task { _ = await model.dismissEvent(event) }
            } label: {
                Image(systemName: "circle")
                    .hcbFontSystem(size: size)
                    .foregroundStyle(AppColor.blue)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Mark event as done (⌘K)")
            .keyboardShortcut("k", modifiers: [.command])
        }
    }
}

// §7.01 Phase D1 — clickable checkbox on calendar task tiles. Lets users
// complete / reopen a task without opening the preview or sheet. Routes
// through the same setTaskCompleted path as list-mode completion.
struct CalendarTaskCheckbox: View {
    @Environment(AppModel.self) private var model
    let task: TaskMirror
    var size: CGFloat = 10

    var body: some View {
        Button {
            Task { await model.setTaskCompleted(!task.isCompleted, task: task) }
        } label: {
            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                .hcbFontSystem(size: size)
                .foregroundStyle(task.isCompleted ? AppColor.moss : AppColor.ember)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(task.isCompleted ? "Reopen task" : "Complete task")
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
