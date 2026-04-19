import SwiftUI

struct QuickCreatePopover: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model

    let initialDate: Date
    let isAllDay: Bool

    @State private var mode: CreateMode = .event
    @State private var summary: String = ""
    @State private var selectedListID: TaskListMirror.ID?
    @State private var selectedCalendarID: CalendarListMirror.ID?
    @State private var isSaving = false
    @FocusState private var summaryFocused: Bool

    enum CreateMode: String, Hashable { case event, task }

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
        initialDate.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
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
        switch mode {
        case .event:
            guard let calID = selectedCalendarID else { return }
            let start = isAllDay ? Calendar.current.startOfDay(for: initialDate) : initialDate
            let end = isAllDay ? start : start.addingTimeInterval(3600)
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
            guard let listID = selectedListID else { return }
            let didCreate = await model.createTask(
                title: trimmed,
                notes: "",
                dueDate: Calendar.current.startOfDay(for: initialDate),
                taskListID: listID
            )
            if didCreate { dismiss() }
        }
    }
}
