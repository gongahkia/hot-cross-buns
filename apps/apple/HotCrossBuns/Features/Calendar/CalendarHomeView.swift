import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct CalendarHomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router
    @Environment(NetworkMonitor.self) private var networkMonitor
    @State private var selectedDate = Date()
    @SceneStorage("calendarGridMode") private var storedMode: String = CalendarGridMode.week.rawValue
    @SceneStorage("calendarShowDrawer") private var storedShowDrawer: Bool = false
    @State private var mode: CalendarGridMode = .week
    @State private var showTaskDrawer: Bool = false
    @State private var searchQuery: String = ""
    @State private var pendingCrossCalendarMove: CrossCalendarMoveRequest?
    @State private var importResultMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            CalendarTodayStatusHeader(
                snapshot: model.todaySnapshot,
                syncState: model.syncState,
                pendingCount: model.pendingMutations.count,
                reachability: networkMonitor.reachability,
                refresh: { Task { await model.refreshNow() } }
            )
            Divider()
            CalendarDropChipsStrip(
                calendars: model.calendars,
                onDrop: { droppedEvent, destinationCalendarID in
                    Task {
                        await handleCrossCalendarDrop(droppedEvent, destinationCalendarID: destinationCalendarID)
                    }
                }
            )
            navigationBar
            Divider()
            Group {
                if model.account == nil {
                    connectPrompt
                } else if model.calendarSnapshot.selectedCalendars.isEmpty {
                    calendarsEmptyPrompt
                } else {
                    switch mode {
                    case .agenda: agendaContent
                    case .week:
                        HStack(spacing: 10) {
                            if showTaskDrawer {
                                TaskDrawerPanel()
                                    .transition(.move(edge: .leading).combined(with: .opacity))
                            }
                            WeekGridView(anchorDate: $selectedDate, searchQuery: searchQuery)
                        }
                        .animation(.easeInOut(duration: 0.2), value: showTaskDrawer)
                    case .month: MonthGridView(anchorDate: $selectedDate, searchQuery: searchQuery)
                    }
                }
            }
        }
        .appBackground()
        .navigationTitle("Google Calendar")
        .onDrop(of: [.fileURL], isTargeted: nil) { providers in
            handleICSDrop(providers)
        }
        .alert(
            "ICS import",
            isPresented: Binding(
                get: { importResultMessage != nil },
                set: { if $0 == false { importResultMessage = nil } }
            )
        ) {
            Button("OK") { importResultMessage = nil }
        } message: {
            Text(importResultMessage ?? "")
        }
        .confirmationDialog(
            "Move which occurrences?",
            isPresented: Binding(
                get: { pendingCrossCalendarMove != nil },
                set: { if $0 == false { pendingCrossCalendarMove = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingCrossCalendarMove
        ) { request in
            Button("This event only") {
                Task { await performCrossCalendarMove(request, scope: .thisOccurrence) }
            }
            Button("All events in the series") {
                Task { await performCrossCalendarMove(request, scope: .allInSeries) }
            }
            Button("Cancel", role: .cancel) {
                pendingCrossCalendarMove = nil
            }
        } message: { request in
            Text("\"\(request.eventSummary)\" is part of a recurring series.")
        }
        .toolbar {
            ToolbarItem(placement: .navigation) {
                CalendarSearchField(text: $searchQuery)
            }
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
        .background(
            HStack(spacing: 0) {
                Button("Jump back") { jumpLarge(by: -1) }
                    .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
                Button("Jump forward") { jumpLarge(by: 1) }
                    .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
            }
            .opacity(0)
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        )
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

    @ViewBuilder
    private var connectPrompt: some View {
        ContentUnavailableView {
            Label("Not connected to Google", systemImage: "person.crop.circle.badge.plus")
        } description: {
            Text("Connect your Google account to see your calendars here.")
        } actions: {
            Button("Open Settings") {
                NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
            }
            .buttonStyle(.borderedProminent)
            .tint(AppColor.ember)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var calendarsEmptyPrompt: some View {
        ContentUnavailableView {
            Label("No calendars selected", systemImage: "calendar.badge.exclamationmark")
        } description: {
            if model.calendars.isEmpty {
                if case .syncing = model.syncState {
                    Text("Loading calendars from Google…")
                } else {
                    Text("We haven't seen any calendars yet. Try Refresh, or check Settings → Calendars.")
                }
            } else {
                Text("Pick at least one calendar in Settings → Calendars to see events here.")
            }
        } actions: {
            if model.calendars.isEmpty {
                Button("Refresh") {
                    Task { await model.refreshNow() }
                }
                .buttonStyle(.borderedProminent)
                .tint(AppColor.ember)
            } else {
                Button("Open Settings") {
                    NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppColor.ember)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func handleICSDrop(_ providers: [NSItemProvider]) -> Bool {
        let calendarID = model.calendarSnapshot.selectedCalendars.first?.id ?? model.calendars.first?.id
        guard let calendarID else {
            importResultMessage = "No calendar selected to import events into."
            return true
        }
        Task {
            var imported = 0
            var failed = 0
            var duplicates = 0
            for provider in providers {
                guard let url = await loadFileURL(from: provider) else { continue }
                guard url.pathExtension.lowercased() == "ics" else { continue }
                guard let contents = try? String(contentsOf: url, encoding: .utf8) else {
                    failed += 1
                    continue
                }
                let drafts = ICSImporter.parse(contents)
                for draft in drafts {
                    if isDuplicateOfExistingEvent(draft, targetCalendarID: calendarID) {
                        duplicates += 1
                        continue
                    }
                    let didCreate = await model.createEvent(
                        summary: draft.summary,
                        details: draft.description,
                        startDate: draft.startDate,
                        endDate: draft.endDate,
                        isAllDay: draft.isAllDay,
                        reminderMinutes: nil,
                        calendarID: calendarID,
                        location: draft.location,
                        recurrence: draft.recurrence
                    )
                    if didCreate { imported += 1 } else { failed += 1 }
                }
            }
            var parts: [String] = []
            if imported > 0 {
                parts.append("Imported \(imported) event\(imported == 1 ? "" : "s")")
            }
            if duplicates > 0 {
                parts.append("skipped \(duplicates) duplicate\(duplicates == 1 ? "" : "s")")
            }
            if failed > 0 {
                parts.append("\(failed) failed")
            }
            if parts.isEmpty {
                importResultMessage = "No events found in the dropped files."
            } else {
                importResultMessage = parts.joined(separator: ", ") + "."
            }
        }
        return true
    }

    // Dropping the same .ics twice (the user re-exports weekly and
    // drags the file for a backup, then drags again for another backup)
    // would otherwise produce exact duplicates in Google Calendar —
    // there's no canonical ID to key on since Google assigns a fresh
    // one per insertEvent. Match against existing events by summary,
    // start time within a minute, and isAllDay alignment in the
    // destination calendar.
    private func isDuplicateOfExistingEvent(
        _ draft: ICSEventDraft,
        targetCalendarID: CalendarListMirror.ID
    ) -> Bool {
        let tolerance: TimeInterval = 60
        return model.events.contains { existing in
            guard existing.calendarID == targetCalendarID else { return false }
            guard existing.status != .cancelled else { return false }
            guard existing.isAllDay == draft.isAllDay else { return false }
            guard existing.summary.caseInsensitiveCompare(draft.summary) == .orderedSame else { return false }
            return abs(existing.startDate.timeIntervalSince(draft.startDate)) < tolerance
        }
    }

    private func loadFileURL(from provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                continuation.resume(returning: url)
            }
        }
    }

    private func handleCrossCalendarDrop(_ dropped: DraggedEvent, destinationCalendarID: CalendarListMirror.ID) async {
        guard destinationCalendarID != dropped.calendarID else { return }
        guard let event = model.event(id: dropped.eventID) else { return }
        let summary = event.summary
        let isRecurring = CalendarEventInstance.isRecurring(event)
        if isRecurring {
            // Recurring cross-calendar moves need scope — this occurrence vs.
            // the whole series. Pose the question and defer until the user
            // picks one.
            pendingCrossCalendarMove = CrossCalendarMoveRequest(
                eventID: event.id,
                destinationCalendarID: destinationCalendarID,
                eventSummary: summary
            )
            return
        }
        _ = await model.updateEvent(
            event,
            summary: event.summary,
            details: event.details,
            startDate: event.startDate,
            endDate: event.isAllDay
                ? (Calendar.current.date(byAdding: .day, value: -1, to: event.endDate) ?? event.endDate)
                : event.endDate,
            isAllDay: event.isAllDay,
            reminderMinutes: event.reminderMinutes.first,
            calendarID: destinationCalendarID,
            location: event.location,
            recurrence: event.recurrence,
            attendeeEmails: event.attendeeEmails,
            notifyGuests: false,
            scope: .thisOccurrence,
            colorId: event.colorId
        )
    }

    private func performCrossCalendarMove(_ request: CrossCalendarMoveRequest, scope: AppModel.RecurringEventScope) async {
        pendingCrossCalendarMove = nil
        guard let event = model.event(id: request.eventID) else { return }
        _ = await model.updateEvent(
            event,
            summary: event.summary,
            details: event.details,
            startDate: event.startDate,
            endDate: event.isAllDay
                ? (Calendar.current.date(byAdding: .day, value: -1, to: event.endDate) ?? event.endDate)
                : event.endDate,
            isAllDay: event.isAllDay,
            reminderMinutes: event.reminderMinutes.first,
            calendarID: request.destinationCalendarID,
            location: event.location,
            recurrence: event.recurrence,
            attendeeEmails: event.attendeeEmails,
            notifyGuests: false,
            scope: scope,
            colorId: event.colorId
        )
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

    private func jumpLarge(by direction: Int) {
        let calendar = Calendar.current
        switch mode {
        case .agenda:
            selectedDate = calendar.date(byAdding: .weekOfYear, value: direction, to: selectedDate) ?? selectedDate
        case .week:
            selectedDate = calendar.date(byAdding: .month, value: direction, to: selectedDate) ?? selectedDate
        case .month:
            selectedDate = calendar.date(byAdding: .year, value: direction, to: selectedDate) ?? selectedDate
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
                        if event.meetLink.isEmpty == false {
                            MeetLinkCard(link: event.meetLink)
                        }
                        if event.attendeeResponses.isEmpty == false {
                            AttendeeResponsesCard(responses: event.attendeeResponses)
                        } else if event.attendeeEmails.isEmpty == false {
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
                        Button("This and following events", role: .destructive) {
                            Task { await delete(event, scope: .thisAndFollowing) }
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
        EventReminderOption.label(forMinutes: minutes)
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
    @State private var startDate: Date
    @State private var endDate: Date
    @State private var isAllDay: Bool
    @State private var reminderOption: EventReminderOption = .preset(15)
    @State private var recurrenceRule: RecurrenceRule?
    @State private var attendees: [String] = []
    @State private var attendeeDraft: String = ""
    @State private var notifyGuests: Bool = false
    @State private var addGoogleMeet: Bool = false
    @State private var eventColor: CalendarEventColor = .defaultColor
    @State private var isSaving = false

    init(prefilledStart: Date? = nil, prefilledIsAllDay: Bool = false) {
        let start = prefilledStart ?? Date()
        _startDate = State(initialValue: start)
        _endDate = State(initialValue: prefilledIsAllDay
            ? start
            : start.addingTimeInterval(3600))
        _isAllDay = State(initialValue: prefilledIsAllDay)
    }

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
                        MarkdownEditor(text: $details, placeholder: "Details (markdown supported)", minHeight: 90, maxHeight: 200)
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

                    Section("Video call") {
                        Toggle("Add Google Meet video conferencing", isOn: $addGoogleMeet)
                    }

                    Section("Color") {
                        EventColorPicker(selection: $eventColor)
                    }

                    Section("Reminder") {
                        EventReminderPicker(selection: $reminderOption)
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
            notifyGuests: notifyGuests,
            addGoogleMeet: addGoogleMeet,
            colorId: eventColor.wireValue
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
    @State private var addGoogleMeet: Bool = false
    @State private var eventColor: CalendarEventColor = .defaultColor
    @State private var isSaving = false

    init(event: CalendarEventMirror) {
        self.event = event
        _summary = State(initialValue: event.summary)
        _details = State(initialValue: event.details)
        _location = State(initialValue: event.location)
        _startDate = State(initialValue: event.startDate)
        _endDate = State(initialValue: event.isAllDay ? Calendar.current.date(byAdding: .day, value: -1, to: event.endDate) ?? event.endDate : event.endDate)
        _isAllDay = State(initialValue: event.isAllDay)
        _reminderOption = State(initialValue: EventReminderOption(minutes: event.reminderMinutes.first))
        _selectedCalendarID = State(initialValue: event.calendarID)
        _recurrenceRule = State(initialValue: event.recurrence.lazy.compactMap(RecurrenceRule.parse).first)
        _attendees = State(initialValue: event.attendeeEmails)
        // Pre-check the toggle if the event already carries a Meet link so the
        // picker state reflects reality. Toggling off doesn't remove the
        // existing link — clearing conferenceData via PATCH requires its own
        // API shape and is out of scope for v1.
        _addGoogleMeet = State(initialValue: event.meetLink.isEmpty == false)
        _eventColor = State(initialValue: CalendarEventColor.from(colorId: event.colorId))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Event") {
                    TextField("Summary", text: $summary)
                    MarkdownEditor(text: $details, placeholder: "Details (markdown supported)", minHeight: 90, maxHeight: 200)
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

                Section("Video call") {
                    Toggle("Add Google Meet video conferencing", isOn: $addGoogleMeet)
                        .disabled(event.meetLink.isEmpty == false)
                    if event.meetLink.isEmpty == false {
                        Link(destination: URL(string: event.meetLink) ?? URL(string: "https://meet.google.com")!) {
                            Label(event.meetLink, systemImage: "video.fill")
                                .foregroundStyle(AppColor.blue)
                        }
                    }
                }

                Section("Color") {
                    EventColorPicker(selection: $eventColor)
                }

                Section("Reminder") {
                    EventReminderPicker(selection: $reminderOption)
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
            scope: scope,
            // Only send createRequest when the toggle flipped from off to on.
            // If the event already had a Meet link, the toggle is disabled and
            // addGoogleMeet stays true — but we don't want to re-create the
            // conference on every save. Detect the transition.
            addGoogleMeet: addGoogleMeet && event.meetLink.isEmpty,
            colorId: eventColor.wireValue
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

enum EventReminderOption: Hashable, Identifiable {
    case useDefault
    case preset(Int) // minutes
    case custom(Int) // minutes

    var id: String {
        switch self {
        case .useDefault: "default"
        case .preset(let m): "preset-\(m)"
        case .custom(let m): "custom-\(m)"
        }
    }

    var minutes: Int? {
        switch self {
        case .useDefault: nil
        case .preset(let m), .custom(let m): m
        }
    }

    var title: String {
        switch self {
        case .useDefault: "Calendar default"
        case .preset(let m), .custom(let m): Self.label(forMinutes: m)
        }
    }

    static func label(forMinutes minutes: Int) -> String {
        if minutes == 0 { return "At start" }
        if minutes < 60 { return "\(minutes) minutes before" }
        if minutes < 1440 {
            let hours = minutes / 60
            let remainder = minutes % 60
            if remainder == 0 { return "\(hours) hour\(hours == 1 ? "" : "s") before" }
            return "\(hours)h \(remainder)m before"
        }
        let days = minutes / 1440
        let remainder = minutes % 1440
        if remainder == 0 { return "\(days) day\(days == 1 ? "" : "s") before" }
        return "\(days)d \((remainder + 59) / 60)h before"
    }

    static let presets: [EventReminderOption] = [
        .useDefault,
        .preset(0),
        .preset(5),
        .preset(10),
        .preset(15),
        .preset(30),
        .preset(60),
        .preset(120),
        .preset(1440)
    ]

    init(minutes: Int?) {
        guard let minutes else { self = .useDefault; return }
        if Self.presets.contains(where: { $0.minutes == minutes }) {
            self = .preset(minutes)
        } else {
            self = .custom(minutes)
        }
    }
}

struct CrossCalendarMoveRequest: Identifiable, Hashable {
    let eventID: CalendarEventMirror.ID
    let destinationCalendarID: CalendarListMirror.ID
    let eventSummary: String
    var id: String { "\(eventID)->\(destinationCalendarID)" }
}

struct CalendarDropChipsStrip: View {
    let calendars: [CalendarListMirror]
    let onDrop: (DraggedEvent, CalendarListMirror.ID) -> Void

    var body: some View {
        // Only render calendars the user can actually write to — dropping
        // onto a read-only calendar would fail at the API layer anyway.
        let writable = calendars.filter { role in
            role.accessRole == "owner" || role.accessRole == "writer"
        }
        Group {
            if writable.count <= 1 {
                EmptyView()
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        Text("Drop on a calendar to move:")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(.leading, 6)
                        ForEach(writable) { calendar in
                            chip(for: calendar)
                        }
                    }
                    .padding(.vertical, 6)
                    .padding(.horizontal, 10)
                }
            }
        }
    }

    private func chip(for calendar: CalendarListMirror) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(Color(hex: calendar.colorHex))
                .frame(width: 8, height: 8)
            Text(calendar.summary)
                .font(.caption)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(
            Capsule().fill(AppColor.cream.opacity(0.4))
        )
        .overlay(
            Capsule().strokeBorder(AppColor.cardStroke, lineWidth: 0.6)
        )
        .dropDestination(for: DraggedEvent.self) { items, _ in
            guard let dropped = items.first else { return false }
            onDrop(dropped, calendar.id)
            return true
        }
        .help("Drop an event here to move it to \(calendar.summary)")
    }
}

struct CalendarSearchField: View {
    @Binding var text: String
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("Filter events", text: $text)
                .textFieldStyle(.plain)
                .frame(width: 180)
                .font(.subheadline)
                .focused($isFocused)
            if text.isEmpty == false {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(.quaternary.opacity(0.4))
        )
        .background(
            Button("Focus Search") { isFocused = true }
                .keyboardShortcut("f", modifiers: [.command])
                .opacity(0)
                .frame(width: 0, height: 0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        )
    }
}

struct EventReminderPicker: View {
    @Binding var selection: EventReminderOption
    @State private var customMinutes: String = ""
    @State private var isEditingCustom = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Alert", selection: Binding(
                get: { presetTag(for: selection) },
                set: { newTag in
                    if newTag == -2 {
                        isEditingCustom = true
                        if case .custom(let m) = selection {
                            customMinutes = "\(m)"
                        }
                    } else {
                        isEditingCustom = false
                        selection = EventReminderOption.presets.first { presetTag(for: $0) == newTag } ?? .useDefault
                    }
                }
            )) {
                ForEach(EventReminderOption.presets) { option in
                    Text(option.title).tag(presetTag(for: option))
                }
                Divider()
                Text("Custom…").tag(-2)
            }
            .accessibilityLabel("Event alert")
            .accessibilityHint("Choose when the reminder fires before the event starts")
            if case .custom(let m) = selection {
                Text("Currently \(EventReminderOption.label(forMinutes: m))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if isEditingCustom {
                HStack(spacing: 8) {
                    TextField("Minutes before", text: $customMinutes)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 120)
                        .accessibilityLabel("Custom minutes before event")
                    Button("Set") {
                        if let minutes = Int(customMinutes), minutes >= 0, minutes <= 40320 {
                            selection = .custom(minutes)
                            isEditingCustom = false
                        }
                    }
                    .disabled(Int(customMinutes).map { $0 < 0 || $0 > 40320 } ?? true)
                    Button("Cancel", role: .cancel) {
                        isEditingCustom = false
                        customMinutes = ""
                    }
                }
            }
        }
    }

    private func presetTag(for option: EventReminderOption) -> Int {
        switch option {
        case .useDefault: -1
        case .preset(let m), .custom(let m): m
        }
    }
}

struct EventColorPicker: View {
    @Binding var selection: CalendarEventColor

    private let columns = Array(repeating: GridItem(.flexible(minimum: 28), spacing: 8), count: 6)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(CalendarEventColor.allCases) { color in
                Button {
                    selection = color
                } label: {
                    ZStack {
                        if let hex = color.hex {
                            Circle()
                                .fill(Color(hex: hex))
                                .frame(width: 24, height: 24)
                        } else {
                            Circle()
                                .strokeBorder(AppColor.cardStroke, lineWidth: 1)
                                .frame(width: 24, height: 24)
                                .overlay(
                                    Image(systemName: "slash.circle")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                )
                        }
                        if selection == color {
                            Circle()
                                .strokeBorder(AppColor.ink, lineWidth: 2)
                                .frame(width: 30, height: 30)
                        }
                    }
                    .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .help(color.title)
                .accessibilityLabel(color.title)
                .accessibilityAddTraits(selection == color ? [.isSelected, .isButton] : .isButton)
                .accessibilityHint("Sets event color to \(color.title)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Event color")
    }
}

struct MeetLinkCard: View {
    let link: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("VIDEO CALL")
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
            Link(destination: URL(string: link) ?? URL(string: "https://meet.google.com")!) {
                HStack(spacing: 10) {
                    Image(systemName: "video.fill")
                        .foregroundStyle(AppColor.blue)
                    Text(link)
                        .font(.body.monospaced())
                        .foregroundStyle(AppColor.blue)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            .buttonStyle(.plain)
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(link, forType: .string)
            } label: {
                Label("Copy link", systemImage: "doc.on.doc")
                    .font(.caption)
            }
            .buttonStyle(.borderless)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface(cornerRadius: 22)
    }
}

struct AttendeeResponsesCard: View {
    let responses: [CalendarEventAttendee]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("GUESTS (\(responses.count))")
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
            ForEach(responses, id: \.email) { attendee in
                HStack(spacing: 10) {
                    Image(systemName: attendee.responseStatus.symbol)
                        .foregroundStyle(tint(for: attendee.responseStatus))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(attendee.displayName ?? attendee.email)
                            .font(.subheadline)
                            .foregroundStyle(AppColor.ink)
                        if attendee.displayName != nil {
                            Text(attendee.email)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 8)
                    Text(attendee.responseStatus.displayTitle)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(tint(for: attendee.responseStatus))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface(cornerRadius: 22)
    }

    private func tint(for status: AttendeeResponseStatus) -> Color {
        switch status {
        case .accepted: AppColor.moss
        case .declined: AppColor.ember
        case .tentative: AppColor.blue
        case .needsAction: .secondary
        }
    }
}

struct CalendarTodayStatusHeader: View {
    let snapshot: TodaySnapshot
    let syncState: SyncState
    let pendingCount: Int
    var reachability: NetworkReachability = .unknown
    let refresh: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(snapshot.date.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                    .font(.headline)
                    .foregroundStyle(AppColor.ink)
                HStack(spacing: 6) {
                    Image(systemName: reachability.systemSymbol)
                        .font(.caption)
                        .foregroundStyle(reachabilityTint)
                        .help("Network: \(reachability.displayTitle)")
                    Text(syncState.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if pendingCount > 0 {
                        PendingSyncPill(count: pendingCount)
                    }
                }
            }
            Spacer(minLength: 12)
            StatusPill(value: "\(snapshot.dueTasks.count)", label: "Tasks")
            StatusPill(value: "\(snapshot.scheduledEvents.count)", label: "Events")
            StatusPill(value: "\(snapshot.overdueCount)", label: "Overdue", tint: snapshot.overdueCount > 0 ? AppColor.ember : nil)
            Button(action: refresh) {
                Label("Refresh", systemImage: "arrow.clockwise")
                    .labelStyle(.iconOnly)
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Refresh Google data")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private var reachabilityTint: Color {
        switch reachability {
        case .online: AppColor.moss
        case .constrained: AppColor.ember
        case .offline: .red
        case .unknown: .secondary
        }
    }
}

struct PendingSyncPill: View {
    let count: Int

    var body: some View {
        Label("\(count) pending", systemImage: "icloud.slash")
            .font(.caption2.weight(.semibold).monospacedDigit())
            .labelStyle(.titleAndIcon)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Capsule().fill(AppColor.ember.opacity(0.18)))
            .foregroundStyle(AppColor.ember)
            .help("Tasks or events created while offline are waiting for Google to accept them.")
            .accessibilityLabel("\(count) pending sync operations")
    }
}

private struct StatusPill: View {
    let value: String
    let label: String
    var tint: Color? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value)
                .font(.title3.bold().monospacedDigit())
                .foregroundStyle(tint ?? AppColor.ink)
            Text(label)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 10)
        .background(
            Capsule().fill((tint ?? AppColor.cream).opacity(0.35))
        )
    }
}

#Preview {
    NavigationStack {
        CalendarHomeView()
            .environment(AppModel.preview)
            .environment(RouterPath())
    }
}
