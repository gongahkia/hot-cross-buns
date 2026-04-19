import SwiftUI

struct QuickCreatePopover: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model

    let initialDate: Date
    // Non-nil when the user came in via a click-and-drag, carrying the
    // dragged endpoint. All-day month/week-strip drags pass the exclusive
    // day-after as `initialEnd`; timed day/week drags pass the actual end
    // instant. When nil, we fall back to a single-point default (1h event
    // or all-day task).
    let initialEnd: Date?
    let isAllDay: Bool

    @State private var mode: CreateMode = .event
    @State private var summary: String = ""
    @State private var selectedListID: TaskListMirror.ID?
    @State private var selectedCalendarID: CalendarListMirror.ID?
    @State private var isSaving = false
    @FocusState private var summaryFocused: Bool

    enum CreateMode: String, Hashable { case event, task }

    init(initialDate: Date, isAllDay: Bool, initialEnd: Date? = nil) {
        self.initialDate = initialDate
        self.initialEnd = initialEnd
        self.isAllDay = isAllDay
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            Divider()
            TextField("What would you like to do?", text: $summary, axis: .vertical)
                .textFieldStyle(.plain)
                .hcbFont(.title3)
                .lineLimit(2...5)
                .hcbScaledPadding(16)
                .focused($summaryFocused)
                .onSubmit { Task { await save() } }
            Divider()
            bottomBar
        }
        .hcbScaledFrame(width: 420)
        .background(.regularMaterial)
        .task {
            selectedListID = model.taskLists.first?.id
            selectedCalendarID = model.calendarSnapshot.selectedCalendars.first?.id ?? model.calendars.first?.id
            summaryFocused = true
        }
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            Label(dateLabel, systemImage: "calendar")
                .labelStyle(.titleAndIcon)
                .hcbFont(.caption, weight: .semibold)
                .foregroundStyle(AppColor.ember)
            Spacer(minLength: 8)
            Picker("", selection: $mode) {
                Text("Event").tag(CreateMode.event)
                Text("Task").tag(CreateMode.task)
            }
            .pickerStyle(.segmented)
            .fixedSize()
        }
        .hcbScaledPadding(.horizontal, 14)
        .hcbScaledPadding(.vertical, 10)
    }

    private var bottomBar: some View {
        HStack(spacing: 10) {
            destinationMenu
            Spacer(minLength: 8)
            Button("Cancel") { dismiss() }
                .keyboardShortcut(.cancelAction)
            Button("Create") { Task { await save() } }
                .buttonStyle(.borderedProminent)
                .tint(AppColor.ember)
                .keyboardShortcut(.defaultAction)
                .disabled(canCreate == false)
        }
        .hcbScaledPadding(.horizontal, 12)
        .hcbScaledPadding(.vertical, 10)
    }

    @ViewBuilder
    private var destinationMenu: some View {
        switch mode {
        case .event:
            Menu {
                ForEach(model.calendars) { cal in
                    Button(cal.summary) { selectedCalendarID = cal.id }
                }
            } label: {
                Label(currentCalendarTitle, systemImage: "calendar.circle")
                    .hcbFont(.caption)
                    .lineLimit(1)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        case .task:
            Menu {
                ForEach(model.taskLists) { list in
                    Button(list.title) { selectedListID = list.id }
                }
            } label: {
                Label(currentListTitle, systemImage: "tray")
                    .hcbFont(.caption)
                    .lineLimit(1)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        }
    }

    private var dateLabel: String {
        let cal = Calendar.current
        let startStr = initialDate.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))

        // Drag came in without an end — single point, existing label.
        guard let end = initialEnd else { return startStr }

        if isAllDay {
            // Month drag / week all-day strip drag. `initialEnd` is the
            // exclusive day-after, so the visible range is end - 1 day.
            let inclusiveEnd = cal.date(byAdding: .day, value: -1, to: end) ?? end
            if cal.isDate(initialDate, inSameDayAs: inclusiveEnd) { return "\(startStr) · all-day" }
            let endStr = inclusiveEnd.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
            return "\(startStr) → \(endStr) · all-day"
        }

        // Timed drag in the day/week body.
        let startTime = initialDate.formatted(.dateTime.hour().minute())
        let endTime = end.formatted(.dateTime.hour().minute())
        if cal.isDate(initialDate, inSameDayAs: end) {
            return "\(startStr) · \(startTime) – \(endTime)"
        }
        // Cross-day timed drag from the week grid.
        let endStr = end.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
        return "\(startStr), \(startTime) → \(endStr), \(endTime)"
    }

    private var currentListTitle: String {
        model.taskLists.first(where: { $0.id == selectedListID })?.title ?? "Inbox"
    }

    private var currentCalendarTitle: String {
        model.calendars.first(where: { $0.id == selectedCalendarID })?.summary ?? "Calendar"
    }

    private var canCreate: Bool {
        let trimmed = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false, isSaving == false else { return false }
        switch mode {
        case .event: return selectedCalendarID != nil
        case .task: return selectedListID != nil
        }
    }

    @MainActor
    private func save() async {
        let trimmed = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return }
        isSaving = true
        defer { isSaving = false }
        let cal = Calendar.current
        switch mode {
        case .event:
            guard let calID = selectedCalendarID else { return }
            // Event start/end honours the drag-derived range when present.
            // All-day drags pass an exclusive day-after as `initialEnd`;
            // model.createEvent stores the inclusive end date internally,
            // so we subtract a day before passing through.
            let start: Date
            let end: Date
            if isAllDay {
                start = cal.startOfDay(for: initialDate)
                if let e = initialEnd {
                    end = cal.date(byAdding: .day, value: -1, to: e) ?? start
                } else {
                    end = start
                }
            } else {
                start = initialDate
                end = initialEnd ?? start.addingTimeInterval(3600)
            }
            let didCreate = await model.createEvent(
                summary: trimmed,
                details: "",
                startDate: start,
                endDate: end,
                isAllDay: isAllDay,
                reminderMinutes: nil,
                calendarID: calID
            )
            if didCreate { dismiss() }
        case .task:
            // Tasks have no time/duration in Google Tasks — any drag span
            // collapses to the first day as the due date.
            guard let listID = selectedListID else { return }
            let didCreate = await model.createTask(
                title: trimmed,
                notes: "",
                dueDate: cal.startOfDay(for: initialDate),
                taskListID: listID
            )
            if didCreate { dismiss() }
        }
    }
}
