import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct CalendarHomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router
    @State private var selectedDate = Date()
    @SceneStorage("calendarGridMode") private var storedMode: String = CalendarGridMode.week.rawValue
    @SceneStorage("calendarShowDrawer") private var storedShowDrawer: Bool = false
    @State private var mode: CalendarGridMode = .week
    @State private var showTaskDrawer: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            navigationBar
            Divider()
            Group {
                switch mode {
                case .agenda: agendaContent
                case .week:
                    HStack(spacing: 10) {
                        if showTaskDrawer {
                            TaskDrawerPanel()
                                .transition(.move(edge: .leading).combined(with: .opacity))
                        }
                        WeekGridView(anchorDate: $selectedDate)
                    }
                    .animation(.easeInOut(duration: 0.2), value: showTaskDrawer)
                case .month: MonthGridView(anchorDate: $selectedDate)
                }
            }
        }
        .appBackground()
        .navigationTitle("Google Calendar")
        .toolbar {
            ToolbarItemGroup {
                if mode == .week {
                    Button {
                        showTaskDrawer.toggle()
                    } label: {
                        Label("Tasks Drawer", systemImage: showTaskDrawer ? "sidebar.left" : "sidebar.squares.left")
                    }
                    .keyboardShortcut("j", modifiers: [.command])
                    .help("Toggle task drawer (Cmd+J)")
                }
                Button {
                    router.present(.addEvent)
                } label: {
                    Label("Add Event", systemImage: "plus")
                }
            }
        }
        .onAppear {
            mode = CalendarGridMode(rawValue: storedMode) ?? .week
            showTaskDrawer = storedShowDrawer
        }
        .onChange(of: mode) { _, newValue in
            storedMode = newValue.rawValue
        }
        .onChange(of: showTaskDrawer) { _, newValue in
            storedShowDrawer = newValue
        }
    }

    private var navigationBar: some View {
        HStack(spacing: 12) {
            Button { shift(by: -1) } label: {
                Image(systemName: "chevron.left").font(.body.weight(.semibold))
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.leftArrow, modifiers: [.command])
            .accessibilityLabel("Previous \(mode.title.lowercased())")

            Button {
                selectedDate = Date()
            } label: {
                Text("Today")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(
                        Capsule().fill(AppColor.cream.opacity(0.7))
                    )
            }
            .buttonStyle(.plain)
            .keyboardShortcut("t", modifiers: [.command])
            .accessibilityLabel("Jump to today")

            Button { shift(by: 1) } label: {
                Image(systemName: "chevron.right").font(.body.weight(.semibold))
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.rightArrow, modifiers: [.command])
            .accessibilityLabel("Next \(mode.title.lowercased())")

            Text(periodTitle)
                .font(.title3.weight(.semibold))
                .foregroundStyle(AppColor.ink)

            Spacer(minLength: 0)

            Picker("View", selection: $mode) {
                ForEach(CalendarGridMode.allCases, id: \.self) { m in
                    Label(m.title, systemImage: m.systemImage).tag(m)
                }
            }
            .pickerStyle(.segmented)
            .fixedSize()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var periodTitle: String {
        let calendar = Calendar.current
        switch mode {
        case .agenda:
            return selectedDate.formatted(.dateTime.weekday(.wide).month(.wide).day())
        case .week:
            let days = CalendarGridLayout.weekDays(containing: selectedDate, calendar: calendar)
            let first = days.first ?? selectedDate
            let last = days.last ?? selectedDate
            let sameMonth = calendar.component(.month, from: first) == calendar.component(.month, from: last)
            if sameMonth {
                return "\(first.formatted(.dateTime.month(.wide))) \(calendar.component(.day, from: first))–\(calendar.component(.day, from: last)), \(calendar.component(.year, from: first))"
            }
            return "\(first.formatted(.dateTime.month(.abbreviated).day())) – \(last.formatted(.dateTime.month(.abbreviated).day().year()))"
        case .month:
            return selectedDate.formatted(.dateTime.month(.wide).year())
        }
    }

    private func shift(by direction: Int) {
        let calendar = Calendar.current
        switch mode {
        case .agenda:
            selectedDate = calendar.date(byAdding: .day, value: direction, to: selectedDate) ?? selectedDate
        case .week:
            selectedDate = calendar.date(byAdding: .weekOfYear, value: direction, to: selectedDate) ?? selectedDate
        case .month:
            selectedDate = calendar.date(byAdding: .month, value: direction, to: selectedDate) ?? selectedDate
        }
    }

    private var agendaContent: some View {
        List {
            Section("Agenda date") {
                DatePicker("Show events for", selection: $selectedDate, displayedComponents: [.date])
            }

            Section(selectedDate.formatted(.dateTime.weekday(.wide).month(.wide).day())) {
                let eventsForSelectedDate = events(on: selectedDate)
                if eventsForSelectedDate.isEmpty {
                    Text("No events on this date in selected calendars")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(eventsForSelectedDate) { event in
                        Button {
                            router.navigate(to: .event(event.id))
                        } label: {
                            EventListRow(event: event)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            Section("Selected calendars") {
                ForEach(model.calendarSnapshot.selectedCalendars) { calendar in
                    CalendarBadgeRow(calendar: calendar)
                }
            }

            Section("Upcoming events") {
                if model.calendarSnapshot.upcomingEvents.isEmpty {
                    Text("No upcoming events in selected calendars")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.calendarSnapshot.upcomingEvents) { event in
                        Button {
                            router.navigate(to: .event(event.id))
                        } label: {
                            EventListRow(event: event)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func events(on date: Date) -> [CalendarEventMirror] {
        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: date)
        let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay) ?? startOfDay
        let selectedCalendarIDs = Set(model.calendarSnapshot.selectedCalendars.map(\.id))

        return model.events
            .filter { event in
                event.status != .cancelled
                    && selectedCalendarIDs.contains(event.calendarID)
                    && event.startDate < endOfDay
                    && event.endDate > startOfDay
            }
            .sorted { lhs, rhs in
                lhs.startDate < rhs.startDate
            }
    }
}

struct EventRowView: View {
    let event: CalendarEventMirror
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            EventListRow(event: event)
                .cardSurface(cornerRadius: 24)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(event.summary)
    }
}

private struct EventListRow: View {
    let event: CalendarEventMirror

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(AppColor.blue)
                .frame(width: 6)
            VStack(alignment: .leading, spacing: 5) {
                Text(event.summary)
                    .font(.headline)
                    .foregroundStyle(AppColor.ink)
                Text(timeRange)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                if !event.details.isEmpty {
                    Text(event.details)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }

    private var timeRange: String {
        if event.isAllDay {
            return event.startDate.formatted(date: .abbreviated, time: .omitted) + " - All day"
        }
        return "\(event.startDate.formatted(date: .abbreviated, time: .shortened)) - \(event.endDate.formatted(date: .omitted, time: .shortened))"
    }
}

private struct CalendarBadgeRow: View {
    let calendar: CalendarListMirror

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color(hex: calendar.colorHex))
                .frame(width: 12, height: 12)
            Text(calendar.summary)
                .font(.headline)
            Spacer()
            Text(calendar.accessRole)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }
    }
}

struct EventDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    let eventID: CalendarEventMirror.ID
    @State private var isEditing = false
    @State private var isMutating = false
    @State private var isConfirmingDelete = false

    var body: some View {
        Group {
            if let event = model.event(id: eventID) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(event.summary)
                            .font(.system(.largeTitle, design: .serif, weight: .bold))
                            .foregroundStyle(AppColor.ink)
                        if !event.details.isEmpty {
                            Text.markdown(event.details)
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                        DetailField(label: "Starts", value: formattedStart(for: event))
                        DetailField(label: "Ends", value: formattedEnd(for: event))
                        if event.location.isEmpty == false {
                            DetailField(label: "Location", value: event.location)
                        }
                        if event.attendeeEmails.isEmpty == false {
                            DetailField(label: "Guests", value: event.attendeeEmails.joined(separator: "\n"))
                        }
                        if event.reminderMinutes.isEmpty == false {
                            DetailField(label: "Reminders", value: event.reminderMinutes.map(reminderLabel).joined(separator: ", "))
                        }
                        DetailField(label: "Calendar ID", value: event.calendarID)
                        EventActionPanel(
                            event: event,
                            isMutating: isMutating,
                            onEdit: {
                                isEditing = true
                            },
                            onDelete: {
                                isConfirmingDelete = true
                            }
                        )
                        DetailField(label: "Google ID", value: event.id)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
                }
                .appBackground()
                .sheet(isPresented: $isEditing) {
                    EditEventSheet(event: event)
                }
                .confirmationDialog(
                    CalendarEventInstance.isRecurring(event) ? "Delete which events?" : "Delete this event?",
                    isPresented: $isConfirmingDelete,
                    titleVisibility: .visible
                ) {
                    if CalendarEventInstance.isRecurring(event) {
                        Button("This event only", role: .destructive) {
                            Task { await delete(event, scope: .thisOccurrence) }
                        }
                        Button("All events in the series", role: .destructive) {
                            Task { await delete(event, scope: .allInSeries) }
                        }
                    } else {
                        Button("Delete Event", role: .destructive) {
                            Task { await delete(event, scope: .thisOccurrence) }
                        }
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("This deletes the event from Google Calendar without sending guest updates.")
                }
            } else {
                ContentUnavailableView("Event not found", systemImage: "calendar.badge.exclamationmark", description: Text("This event may have been deleted in Google Calendar."))
            }
        }
        .navigationTitle("Event")
    }

    private func formattedStart(for event: CalendarEventMirror) -> String {
        event.isAllDay
            ? event.startDate.formatted(date: .abbreviated, time: .omitted)
            : event.startDate.formatted(date: .abbreviated, time: .shortened)
    }

    private func formattedEnd(for event: CalendarEventMirror) -> String {
        if event.isAllDay {
            let inclusiveEndDate = Calendar.current.date(byAdding: .day, value: -1, to: event.endDate) ?? event.endDate
            return inclusiveEndDate.formatted(date: .abbreviated, time: .omitted)
        }

        return event.endDate.formatted(date: .abbreviated, time: .shortened)
    }

    private func reminderLabel(_ minutes: Int) -> String {
        EventReminderOption(minutes: minutes)?.title ?? "\(minutes) minutes before"
    }

    private func delete(_ event: CalendarEventMirror, scope: AppModel.RecurringEventScope) async {
        isMutating = true
        defer { isMutating = false }
        let didDelete = await model.deleteEvent(event, scope: scope)
        if didDelete {
            dismiss()
        }
    }
}

private struct EventActionPanel: View {
    @Environment(AppModel.self) private var model
    let event: CalendarEventMirror
    let isMutating: Bool
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onEdit) {
                Label("Edit Event", systemImage: "square.and.pencil")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(AppColor.blue)
            .disabled(isMutating)

            Button(role: .destructive, action: onDelete) {
                Label("Delete Event", systemImage: "trash")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(isMutating)

            Button {
                Task { _ = await model.duplicateEvent(event) }
            } label: {
                Label("Duplicate", systemImage: "plus.square.on.square")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .keyboardShortcut("d", modifiers: [.command])

            Button(action: copyAsMarkdown) {
                Label("Copy as Markdown", systemImage: "doc.on.clipboard")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)

            Button(action: exportICS) {
                Label("Export .ics", systemImage: "square.and.arrow.up")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .cardSurface(cornerRadius: 22)
    }

    private func copyAsMarkdown() {
        let calendarTitle = model.calendars.first(where: { $0.id == event.calendarID })?.summary
        let markdown = EventMarkdownExporter.markdown(for: event, calendarTitle: calendarTitle)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(markdown, forType: .string)
    }

    private func exportICS() {
        let content = EventICSExporter.ics(for: event)
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename()
        panel.allowedContentTypes = [UTType(filenameExtension: "ics") ?? .data]
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            try? content.data(using: .utf8)?.write(to: url)
        }
    }

    private func suggestedFilename() -> String {
        let sanitized = event.summary
            .replacingOccurrences(of: "/", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let base = sanitized.isEmpty ? "event" : sanitized
        return "\(base).ics"
    }
}

struct AddEventSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var selectedCalendarID: CalendarListMirror.ID?
    @State private var summary = ""
    @State private var details = ""
    @State private var location = ""
    @State private var startDate = Date()
    @State private var endDate = Date().addingTimeInterval(3600)
    @State private var isAllDay = false
    @State private var reminderOption: EventReminderOption = .fifteenMinutes
    @State private var recurrenceRule: RecurrenceRule?
    @State private var attendees: [String] = []
    @State private var attendeeDraft: String = ""
    @State private var notifyGuests: Bool = false
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                if model.calendars.isEmpty {
                    Section {
                        ContentUnavailableView(
                            "No calendars loaded",
                            systemImage: "calendar.badge.exclamationmark",
                            description: Text("Connect Google and refresh before creating an event.")
                        )
                    }
                } else {
                    Section("Event") {
                        TextField("Summary", text: $summary)
                        TextField("Details", text: $details, axis: .vertical)
                            .lineLimit(3...6)
                            .enableWritingTools()
                        TextField("Location", text: $location)
                    }

                    Section("Calendar") {
                        Picker("Calendar", selection: $selectedCalendarID) {
                            ForEach(model.calendars) { calendar in
                                Text(calendar.summary).tag(Optional(calendar.id))
                            }
                        }
                    }

                    Section("Time") {
                        Toggle("All-day event", isOn: $isAllDay)
                        DatePicker("Starts", selection: $startDate, displayedComponents: isAllDay ? [.date] : [.date, .hourAndMinute])
                        DatePicker("Ends", selection: $endDate, displayedComponents: isAllDay ? [.date] : [.date, .hourAndMinute])
                        if isValidDateRange == false {
                            Text(isAllDay ? "End date cannot be before start date." : "End time must be after start time.")
                                .font(.footnote)
                                .foregroundStyle(.red)
                        }
                    }

                    Section("Repeat") {
                        RecurrenceEditor(rule: $recurrenceRule)
                    }

                    Section("Guests") {
                        GuestsSection(attendees: $attendees, draft: $attendeeDraft, notifyGuests: $notifyGuests)
                    }

                    Section("Reminder") {
                        Picker("Alert", selection: $reminderOption) {
                            ForEach(EventReminderOption.allCases) { option in
                                Text(option.title).tag(option)
                            }
                        }
                    }
                }
            }
            .navigationTitle("New Event")
            .task {
                selectedCalendarID = selectedCalendarID ?? defaultCalendarID
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isSaving)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task {
                            await createEvent()
                        }
                    }
                    .disabled(canCreate == false || isSaving)
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private var defaultCalendarID: CalendarListMirror.ID? {
        model.calendarSnapshot.selectedCalendars.first?.id ?? model.calendars.first?.id
    }

    private var canCreate: Bool {
        summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            && selectedCalendarID != nil
            && isValidDateRange
            && model.account != nil
    }

    private var isValidDateRange: Bool {
        if isAllDay {
            return Calendar.current.startOfDay(for: endDate) >= Calendar.current.startOfDay(for: startDate)
        }

        return endDate > startDate
    }

    private func createEvent() async {
        guard let selectedCalendarID else {
            return
        }

        isSaving = true
        defer { isSaving = false }

        let didCreate = await model.createEvent(
            summary: summary,
            details: details,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate,
            isAllDay: isAllDay,
            reminderMinutes: reminderOption.minutes,
            calendarID: selectedCalendarID,
            location: location,
            recurrence: recurrenceRule.map { [$0.rruleString()] } ?? [],
            attendeeEmails: attendees,
            notifyGuests: notifyGuests
        )

        if didCreate {
            dismiss()
        }
    }

    private var normalizedStartDate: Date {
        isAllDay ? Calendar.current.startOfDay(for: startDate) : startDate
    }

    private var normalizedEndDate: Date {
        isAllDay ? Calendar.current.startOfDay(for: endDate) : endDate
    }
}

struct EditEventSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    let event: CalendarEventMirror
    @State private var isShowingScopeDialog = false
    @State private var summary: String
    @State private var details: String
    @State private var location: String
    @State private var startDate: Date
    @State private var endDate: Date
    @State private var isAllDay: Bool
    @State private var reminderOption: EventReminderOption
    @State private var selectedCalendarID: CalendarListMirror.ID?
    @State private var recurrenceRule: RecurrenceRule?
    @State private var attendees: [String] = []
    @State private var attendeeDraft: String = ""
    @State private var notifyGuests: Bool = false
    @State private var isSaving = false

    init(event: CalendarEventMirror) {
        self.event = event
        _summary = State(initialValue: event.summary)
        _details = State(initialValue: event.details)
        _location = State(initialValue: event.location)
        _startDate = State(initialValue: event.startDate)
        _endDate = State(initialValue: event.isAllDay ? Calendar.current.date(byAdding: .day, value: -1, to: event.endDate) ?? event.endDate : event.endDate)
        _isAllDay = State(initialValue: event.isAllDay)
        _reminderOption = State(initialValue: EventReminderOption(minutes: event.reminderMinutes.first) ?? .none)
        _selectedCalendarID = State(initialValue: event.calendarID)
        _recurrenceRule = State(initialValue: event.recurrence.lazy.compactMap(RecurrenceRule.parse).first)
        _attendees = State(initialValue: event.attendeeEmails)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Event") {
                    TextField("Summary", text: $summary)
                    TextField("Details", text: $details, axis: .vertical)
                        .lineLimit(3...6)
                        .enableWritingTools()
                    TextField("Location", text: $location)
                }

                Section("Time") {
                    Toggle("All-day event", isOn: $isAllDay)
                    DatePicker("Starts", selection: $startDate, displayedComponents: isAllDay ? [.date] : [.date, .hourAndMinute])
                    DatePicker("Ends", selection: $endDate, displayedComponents: isAllDay ? [.date] : [.date, .hourAndMinute])
                    if isValidDateRange == false {
                        Text(isAllDay ? "End date cannot be before start date." : "End time must be after start time.")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }

                Section("Repeat") {
                    RecurrenceEditor(rule: $recurrenceRule)
                }

                Section("Guests") {
                    GuestsSection(attendees: $attendees, draft: $attendeeDraft, notifyGuests: $notifyGuests)
                }

                Section("Reminder") {
                    Picker("Alert", selection: $reminderOption) {
                        ForEach(EventReminderOption.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                }

                Section("Calendar") {
                    Picker("Calendar", selection: $selectedCalendarID) {
                        ForEach(model.calendars) { calendar in
                            Text(calendar.summary).tag(Optional(calendar.id))
                        }
                    }
                }
            }
            .navigationTitle("Edit Event")
            .confirmationDialog(
                "Apply to which events?",
                isPresented: $isShowingScopeDialog,
                titleVisibility: .visible
            ) {
                Button("This event only") {
                    Task { await saveEvent(scope: .thisOccurrence) }
                }
                Button("All events in the series") {
                    Task { await saveEvent(scope: .allInSeries) }
                }
                Button("Cancel", role: .cancel) {}
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isSaving)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if CalendarEventInstance.isRecurring(event) {
                            isShowingScopeDialog = true
                        } else {
                            Task { await saveEvent(scope: .thisOccurrence) }
                        }
                    }
                    .disabled(canSave == false || isSaving)
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private var canSave: Bool {
        summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            && isValidDateRange
            && selectedCalendarID != nil
            && model.account != nil
    }

    private var isValidDateRange: Bool {
        if isAllDay {
            return Calendar.current.startOfDay(for: endDate) >= Calendar.current.startOfDay(for: startDate)
        }

        return endDate > startDate
    }

    private func saveEvent(scope: AppModel.RecurringEventScope) async {
        guard let selectedCalendarID else {
            return
        }

        isSaving = true
        defer { isSaving = false }

        let didSave = await model.updateEvent(
            event,
            summary: summary,
            details: details,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate,
            isAllDay: isAllDay,
            reminderMinutes: reminderOption.minutes,
            calendarID: selectedCalendarID,
            location: location,
            recurrence: recurrenceRule.map { [$0.rruleString()] } ?? [],
            attendeeEmails: attendees,
            notifyGuests: notifyGuests,
            scope: scope
        )

        if didSave {
            dismiss()
        }
    }

    private var normalizedStartDate: Date {
        isAllDay ? Calendar.current.startOfDay(for: startDate) : startDate
    }

    private var normalizedEndDate: Date {
        isAllDay ? Calendar.current.startOfDay(for: endDate) : endDate
    }
}

private enum EventReminderOption: Int, CaseIterable, Identifiable {
    case none = -1
    case atStart = 0
    case tenMinutes = 10
    case fifteenMinutes = 15
    case thirtyMinutes = 30
    case oneHour = 60
    case oneDay = 1440

    var id: Int { rawValue }

    var minutes: Int? {
        rawValue < 0 ? nil : rawValue
    }

    var title: String {
        switch self {
        case .none:
            "Calendar default"
        case .atStart:
            "At start"
        case .tenMinutes:
            "10 minutes before"
        case .fifteenMinutes:
            "15 minutes before"
        case .thirtyMinutes:
            "30 minutes before"
        case .oneHour:
            "1 hour before"
        case .oneDay:
            "1 day before"
        }
    }

    init?(minutes: Int?) {
        guard let minutes else {
            self = .none
            return
        }

        self.init(rawValue: minutes)
    }
}

#Preview {
    NavigationStack {
        CalendarHomeView()
            .environment(AppModel.preview)
            .environment(RouterPath())
    }
}
