import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct CalendarHomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routerPath) private var router
    @Environment(NetworkMonitor.self) private var networkMonitor
    @State private var selectedDate = Date()
    @SceneStorage("calendarGridMode") private var storedMode: String = CalendarGridMode.month.rawValue
    @State private var mode: CalendarGridMode = .month
    @State private var searchQuery: String = ""
    @State private var pendingCrossCalendarMove: CrossCalendarMoveRequest?
    @State private var importResultMessage: String?
    @State private var selectedEventIDs: Set<String> = []
    @State private var isGoToDateShown = false
    @State private var snoozeCustomTask: TaskMirror?
    @State private var pendingDeleteEvent: CalendarEventMirror?

    var body: some View {
        VStack(spacing: 0) {
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
            contentArea
            .hcbSurface(.calendarGrid) // §6.11 — covers day/week/month/year/agenda subtree
        }
        .appBackground()
        .focusedSceneValue(\.calendarCommandActions, calendarCommandActions)
        // Adding a .toolbar here serves two jobs: (a) provides the + button
        // for event/task quick-create parity with the Tasks and Notes tabs,
        // (b) gets SwiftUI to render the native macOS titlebar so the
        // traffic-light cluster integrates with the sidebar top the same way
        // Tasks/Notes do — CalendarHomeView previously had no .toolbar, so
        // the window used a borderless titlebar and the sidebar appeared to
        // start below the lights on Calendar but above them on Tasks/Notes.
        .toolbar {
            ToolbarItemGroup {
                Button {
                    router?.present(.quickCreate(Date(), allDay: true))
                } label: {
                    Label("New Event or Task", systemImage: "plus")
                }
                .help("Open the quick-create popover to add an event or task")
                .disabled(model.account == nil)
            }
        }
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
        .sheet(item: $snoozeCustomTask) { task in
            SnoozePickerSheet(task: task) { newDate in
                Task {
                    _ = await model.updateTask(task, title: task.title, notes: task.notes, dueDate: newDate)
                }
            }
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
            Button("Every event in the series", role: .destructive) {
                Task { await performCrossCalendarMove(request, scope: .allInSeries) }
            }
            Button("Cancel", role: .cancel) {
                pendingCrossCalendarMove = nil
            }
        } message: { request in
            Text("\"\(request.eventSummary)\" is part of a recurring series. \"Every event in the series\" moves past occurrences too — not just upcoming ones. This is destructive and can't be undone.")
        }
        .confirmationDialog(
            "Delete this event?",
            isPresented: Binding(
                get: { pendingDeleteEvent != nil },
                set: { if $0 == false { pendingDeleteEvent = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let event = pendingDeleteEvent {
                Button("Delete", role: .destructive) {
                    Task {
                        _ = await model.deleteEvent(event)
                        pendingDeleteEvent = nil
                    }
                }
            }
            Button("Cancel", role: .cancel) { pendingDeleteEvent = nil }
        } message: {
            if let event = pendingDeleteEvent {
                Text("Delete \"\(event.summary)\" from Google Calendar?")
            }
        }
        .onAppear {
            let restored = CalendarGridMode(rawValue: storedMode) ?? .month
            mode = visibleCalendarModes.contains(restored) ? restored : (visibleCalendarModes.first ?? .month)
        }
        .onChange(of: mode) { _, newValue in
            storedMode = newValue.rawValue
        }
        .onChange(of: model.settings.hiddenCalendarViewModes) { _, _ in
            // if the user just hid the currently-selected mode, fall back to
            // the first still-visible one so the detail area doesn't render
            // a mode that's gone from the picker.
            if visibleCalendarModes.contains(mode) == false, let first = visibleCalendarModes.first {
                mode = first
            }
        }
    }

    @ViewBuilder
    private var contentArea: some View {
        Group {
            if model.account == nil && model.authState == .authenticating {
                restoringPrompt
            } else if model.account == nil {
                connectPrompt
            } else if model.calendarSnapshot.selectedCalendars.isEmpty {
                calendarsEmptyPrompt
            } else {
                activeCalendarSurface
            }
        }
    }

    private var activeCalendarSurface: some View {
        ZStack(alignment: .bottom) {
            currentModeContent

            if selectedEventIDs.count >= 2 {
                EventBulkActionBar(
                    selection: $selectedEventIDs,
                    events: selectedEvents
                )
                .hcbScaledPadding(.bottom, 16)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: selectedEventIDs.count >= 2)
    }

    @ViewBuilder
    private var currentModeContent: some View {
        switch mode {
        case .agenda:
            agendaContent
        case .day:
            DayGridView(anchorDate: $selectedDate, searchQuery: searchQuery)
        case .multiDay:
            VStack(spacing: 0) {
                multiDayStepperBar
                WeekGridView(
                    anchorDate: $selectedDate,
                    searchQuery: searchQuery,
                    selectedEventIDs: $selectedEventIDs,
                    multiDayCount: model.settings.multiDayCount
                )
            }
        case .week:
            WeekGridView(anchorDate: $selectedDate, searchQuery: searchQuery, selectedEventIDs: $selectedEventIDs)
        case .month:
            MonthGridView(anchorDate: $selectedDate, searchQuery: searchQuery)
        case .year:
            YearGridView(anchorDate: $selectedDate, onPickDay: { day in
                selectedDate = day
                mode = .day
            })
        }
    }

    private var navigationBar: some View {
        HStack(spacing: 12) {
            Button { shift(by: -1) } label: {
                Image(systemName: "chevron.left").hcbFont(.body, weight: .semibold)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Previous \(mode.title.lowercased())")

            Button("Today") { selectedDate = Date() }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .accessibilityLabel("Jump to today")

            Button { shift(by: 1) } label: {
                Image(systemName: "chevron.right").hcbFont(.body, weight: .semibold)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Next \(mode.title.lowercased())")

            if mode != .month {
                Button {
                    isGoToDateShown.toggle()
                } label: {
                    Text(periodTitle)
                        .hcbFont(.title3, weight: .semibold)
                        .foregroundStyle(AppColor.ink)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Jump to date")
                .popover(isPresented: $isGoToDateShown, arrowEdge: .bottom) {
                    GoToDateSheet(initialDate: selectedDate) { newDate in
                        selectedDate = newDate
                    }
                }
            }

            Spacer(minLength: 0)

            Picker("View", selection: $mode) {
                ForEach(visibleCalendarModes, id: \.self) { m in
                    Label(m.title, systemImage: m.systemImage).tag(m)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .fixedSize()
        }
        .hcbScaledPadding(.horizontal, 16)
        .hcbScaledPadding(.vertical, 10)
        .disabled(model.account == nil)
    }

    private var selectedEvents: [CalendarEventMirror] {
        model.events.filter { selectedEventIDs.contains($0.id) }
    }

    // CalendarGridMode.allCases filtered by user-hidden set from Layout settings.
    // If the user hides every mode, allCases still returns something — the
    // AppModel.setCalendarViewModeHidden setter refuses to hide the last one.
    private var visibleCalendarModes: [CalendarGridMode] {
        CalendarGridMode.allCases.filter { model.settings.hiddenCalendarViewModes.contains($0.rawValue) == false }
    }

    private var calendarCommandActions: CalendarCommandActions {
        let canNavigate = model.account != nil
        return CalendarCommandActions(
            previous: { shift(by: -1) },
            today: { selectedDate = Date() },
            next: { shift(by: 1) },
            jumpBack: { jumpLarge(by: -1) },
            jumpForward: { jumpLarge(by: 1) },
            goToDate: { isGoToDateShown = true },
            focusSearch: {
                NotificationCenter.default.post(name: .hcbFocusCalendarSearch, object: nil)
            },
            showAgenda: { selectMode(.agenda) },
            showDay: { selectMode(.day) },
            showWeek: { selectMode(.week) },
            showMonth: { selectMode(.month) },
            canNavigate: canNavigate,
            canShowAgenda: canNavigate && visibleCalendarModes.contains(.agenda),
            canShowDay: canNavigate && visibleCalendarModes.contains(.day),
            canShowWeek: canNavigate && visibleCalendarModes.contains(.week),
            canShowMonth: canNavigate && visibleCalendarModes.contains(.month)
        )
    }

    // Keyboard shortcuts route here so hidden modes no-op rather than forcing
    // the picker back onto a mode the user chose to remove.
    private func selectMode(_ target: CalendarGridMode) {
        guard visibleCalendarModes.contains(target) else { return }
        mode = target
    }

    private var periodTitle: String {
        let calendar = Calendar.current
        switch mode {
        case .agenda:
            return selectedDate.formatted(.dateTime.weekday(.wide).month(.wide).day())
        case .day:
            return selectedDate.formatted(.dateTime.weekday(.wide).month(.wide).day().year())
        case .multiDay:
            let count = max(2, min(7, model.settings.multiDayCount))
            let first = calendar.startOfDay(for: selectedDate)
            let last = calendar.date(byAdding: .day, value: count - 1, to: first) ?? first
            return "\(first.formatted(.dateTime.month(.abbreviated).day())) – \(last.formatted(.dateTime.month(.abbreviated).day().year()))"
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
        case .year:
            return selectedDate.formatted(.dateTime.year())
        }
    }

    // §7.01 Phase D2 — ± stepper for Multi-Day view day count.
    private var multiDayStepperBar: some View {
        HStack(spacing: 12) {
            Button {
                var next = model.settings
                next.multiDayCount = max(2, next.multiDayCount - 1)
                model.updateSettings(next)
            } label: {
                Image(systemName: "minus.circle")
            }
            .buttonStyle(.plain)
            .disabled(model.settings.multiDayCount <= 2)
            .help("Fewer days")
            Text("\(model.settings.multiDayCount) days")
                .hcbFont(.caption, weight: .semibold)
                .monospacedDigit()
                .frame(minWidth: 50)
            Button {
                var next = model.settings
                next.multiDayCount = min(7, next.multiDayCount + 1)
                model.updateSettings(next)
            } label: {
                Image(systemName: "plus.circle")
            }
            .buttonStyle(.plain)
            .disabled(model.settings.multiDayCount >= 7)
            .help("More days")
            Spacer(minLength: 8)
        }
        .hcbScaledPadding(.horizontal, 12)
        .hcbScaledPadding(.vertical, 6)
    }

    @ViewBuilder
    private var connectPrompt: some View {
        ContentUnavailableView {
            Label("Not connected to Google", systemImage: "person.crop.circle.badge.plus")
        } description: {
            Text("Connect your Google account to see your calendars here.")
        } actions: {
            Button("Open Settings") {
                NotificationCenter.default.post(name: .hcbOpenSettingsWindow, object: nil)
            }
            .buttonStyle(.borderedProminent)
            .tint(AppColor.ember)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var restoringPrompt: some View {
        // Shown during the brief pre-load window where we haven't yet decided
        // if the user is signed in. Replaces the alarming "Not connected"
        // message that used to flash during cold launch.
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.large)
            Text("Connecting to Google…")
                .hcbFont(.subheadline)
                .foregroundStyle(.secondary)
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
                    NotificationCenter.default.post(name: .hcbOpenSettingsWindow, object: nil)
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
        case .agenda, .day:
            selectedDate = calendar.date(byAdding: .day, value: direction, to: selectedDate) ?? selectedDate
        case .multiDay:
            let step = max(1, model.settings.multiDayCount)
            selectedDate = calendar.date(byAdding: .day, value: direction * step, to: selectedDate) ?? selectedDate
        case .week:
            selectedDate = calendar.date(byAdding: .weekOfYear, value: direction, to: selectedDate) ?? selectedDate
        case .month:
            selectedDate = calendar.date(byAdding: .month, value: direction, to: selectedDate) ?? selectedDate
        case .year:
            selectedDate = calendar.date(byAdding: .year, value: direction, to: selectedDate) ?? selectedDate
        }
    }

    private func jumpLarge(by direction: Int) {
        let calendar = Calendar.current
        switch mode {
        case .agenda, .day:
            selectedDate = calendar.date(byAdding: .weekOfYear, value: direction, to: selectedDate) ?? selectedDate
        case .multiDay:
            selectedDate = calendar.date(byAdding: .weekOfYear, value: direction, to: selectedDate) ?? selectedDate
        case .week:
            selectedDate = calendar.date(byAdding: .month, value: direction, to: selectedDate) ?? selectedDate
        case .month:
            selectedDate = calendar.date(byAdding: .year, value: direction, to: selectedDate) ?? selectedDate
        case .year:
            selectedDate = calendar.date(byAdding: .year, value: direction * 5, to: selectedDate) ?? selectedDate
        }
    }

    // §7.01 Phase D4 — TickTick-style flat chronological agenda. Date-header
    // sections, events (time-sorted) and tasks (due that day) interleaved.
    // Range: 14 days starting at selectedDate. DatePicker at top scrolls range.
    private var agendaContent: some View {
        let range = agendaDays()
        let eventsByDay = agendaEventsByDay(for: range)
        let tasksByDay = agendaTasksByDay(for: range)
        return List {
            Section {
                DatePicker("Agenda starts", selection: $selectedDate, displayedComponents: [.date])
            }
            ForEach(range, id: \.self) { day in
                let dayEvents = eventsByDay[day] ?? []
                let dayTasks = tasksByDay[day] ?? []
                if dayEvents.isEmpty == false || dayTasks.isEmpty == false {
                    Section {
                        ForEach(dayEvents) { event in
                            Button {
                                router?.present(.editEvent(event.id))
                            } label: {
                                EventListRow(event: event, accentColor: calendarColor(for: event))
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                EventContextMenu(
                                    event: event,
                                    onOpen: { router?.present(.editEvent(event.id)) },
                                    onConvertToTask: { router?.present(.convertEventToTask(event.id)) },
                                    onConvertToNote: { router?.present(.convertEventToNote(event.id)) },
                                    onDelete: { pendingDeleteEvent = event }
                                )
                            }
                        }
                        ForEach(dayTasks) { task in
                            agendaTaskRow(task)
                        }
                    } header: {
                        agendaDateHeader(day)
                    }
                }
            }
            if eventsByDay.values.allSatisfy(\.isEmpty), tasksByDay.values.allSatisfy(\.isEmpty) {
                Section {
                    Text("Nothing scheduled in the next \(range.count) days.")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func agendaDays(count: Int = 14) -> [Date] {
        let cal = Calendar.current
        let start = cal.startOfDay(for: selectedDate)
        return (0..<count).compactMap { cal.date(byAdding: .day, value: $0, to: start) }
    }

    private func agendaEventsByDay(for range: [Date]) -> [Date: [CalendarEventMirror]] {
        // Use the prebuilt model.eventsByDay IDs (rebuildSnapshots already walks
        // the full event corpus once) instead of re-iterating on every body
        // eval. Apply calendar-selection filter per lookup; sort per day.
        guard range.isEmpty == false else { return [:] }
        let selectedIDs = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        var bucket: [Date: [CalendarEventMirror]] = [:]
        for day in range {
            let key = day.timeIntervalSinceReferenceDate
            guard let eventIDs = model.eventsByDay[key], eventIDs.isEmpty == false else { continue }
            let entries = eventIDs.compactMap { model.event(id: $0) }
            let filtered = entries.filter { selectedIDs.contains($0.calendarID) }
            guard filtered.isEmpty == false else { continue }
            bucket[day] = filtered.sorted { lhs, rhs in
                if lhs.isAllDay != rhs.isAllDay { return lhs.isAllDay && rhs.isAllDay == false }
                return lhs.startDate < rhs.startDate
            }
        }
        return bucket
    }

    private func agendaTasksByDay(for range: [Date]) -> [Date: [TaskMirror]] {
        // Use model.tasksByDueDate IDs; rebuildSnapshots already walks tasks
        // once and excludes deleted/completed. We only need to filter to
        // the visible task-list set and sort alphabetically per day.
        let visibleLists: Set<TaskListMirror.ID> = model.settings.hasConfiguredTaskListSelection
            ? model.settings.selectedTaskListIDs
            : Set(model.taskLists.map(\.id))
        var bucket: [Date: [TaskMirror]] = [:]
        for day in range {
            let key = day.timeIntervalSinceReferenceDate
            guard let taskIDs = model.tasksByDueDate[key], taskIDs.isEmpty == false else { continue }
            let entries = taskIDs.compactMap { model.task(id: $0) }
            let filtered = entries.filter { visibleLists.contains($0.taskListID) }
            guard filtered.isEmpty == false else { continue }
            bucket[day] = filtered.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        }
        return bucket
    }

    private func agendaDateHeader(_ day: Date) -> some View {
        let cal = Calendar.current
        let isToday = cal.isDateInToday(day)
        return HStack(spacing: 10) {
            Text(day.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))
                .hcbFont(.subheadline, weight: .semibold)
                .foregroundStyle(isToday ? AppColor.ember : AppColor.ink)
            if isToday {
                Text("Today")
                    .hcbFont(.caption2, weight: .semibold)
                    .hcbScaledPadding(.horizontal, 6)
                    .hcbScaledPadding(.vertical, 2)
                    .background(Capsule().fill(AppColor.ember.opacity(0.18)))
                    .foregroundStyle(AppColor.ember)
            }
            Spacer(minLength: 0)
        }
    }

    private func agendaTaskRow(_ task: TaskMirror) -> some View {
        HStack(spacing: 8) {
            CalendarTaskCheckbox(task: task, size: 14)
            Button {
                router?.present(.editTask(task.id))
            } label: {
                HStack(spacing: 8) {
                    Text(task.title)
                        .hcbFont(.subheadline)
                        .strikethrough(task.isCompleted)
                        .foregroundStyle(AppColor.ink)
                    if let listTitle = model.taskLists.first(where: { $0.id == task.taskListID })?.title {
                        Text(listTitle)
                            .hcbFont(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .opacity(task.isCompleted ? 0.6 : 1.0)
        .contextMenu {
            TaskContextMenu(
                task: task,
                onOpen: { router?.present(.editTask(task.id)) },
                onCustomSnooze: { snoozeCustomTask = task },
                onConvertToEvent: { router?.present(.convertTaskToEvent(task.id)) },
                onConvertToTaskOrNote: {
                    if task.dueDate == nil {
                        router?.present(.convertNoteToTask(task.id))
                    } else {
                        router?.present(.convertTaskToNote(task.id))
                    }
                },
                onDelete: {
                    Task { _ = await model.deleteTask(task) }
                }
            )
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

    private func calendarColor(for event: CalendarEventMirror) -> Color {
        if let hex = CalendarEventColor.from(colorId: event.colorId).hex {
            return Color(hex: hex)
        }
        guard let cal = model.calendars.first(where: { $0.id == event.calendarID }) else {
            return AppColor.blue
        }
        return Color(hex: cal.colorHex)
    }
}

struct EventRowView: View {
    let event: CalendarEventMirror
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            EventListRow(event: event)
                .cardSurface(cornerRadius: 18)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(event.summary)
    }
}

private struct EventListRow: View {
    let event: CalendarEventMirror
    var accentColor: Color = AppColor.blue

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 6)
                .fill(accentColor)
                .hcbScaledFrame(width: 6)
            VStack(alignment: .leading, spacing: 5) {
                Text(event.summary)
                    .hcbFont(.headline)
                    .foregroundStyle(AppColor.ink)
                Text(timeRange)
                    .hcbFont(.subheadline, weight: .medium)
                    .foregroundStyle(.secondary)
                if !event.details.isEmpty {
                    Text(event.details)
                        .hcbFont(.caption)
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
                .hcbScaledFrame(width: 12, height: 12)
            Text(calendar.summary)
                .hcbFont(.headline)
            Spacer()
            Text(calendar.accessRole)
                .hcbFont(.caption, weight: .medium)
                .foregroundStyle(.secondary)
        }
    }
}

struct AddEventSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @Environment(\.routerPath) private var router
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
    @State private var quickCreateText = ""
    @State private var parsedPreview: ParsedQuickAddEvent?
    // Non-nil when the sheet is editing an existing event. Editing mode
    // hides the Quick Create block, flips the title + primary button, and
    // dispatches updateEvent instead of createEvent.
    @State private var editingEvent: CalendarEventMirror?
    // Editing-state flag: true in create mode; false when opened on an
    // existing event (view-only). The view-only pass disables every field
    // and swaps the primary toolbar button to "Edit" — clicking Edit flips
    // this true and the form becomes live. Clicking Open on the hover
    // preview now lands users here first, not in a destructive edit.
    @State private var isEditing: Bool
    // Recurring-scope picker state (shown only when saving a recurring event
    // in edit mode). Mirrors the legacy EditEventSheet behaviour.
    @State private var pendingRecurringScope = false
    // Save-as-template state (edit-mode overflow menu).
    @State private var isNamingTemplate = false
    @State private var templateName: String = ""
    // Delete confirmation state for the view-only toolbar Delete button.
    // Simple single confirm for one-off events; recurring events go through
    // a scope picker in the same flow so users can choose occurrence vs
    // series without re-opening the overflow menu.
    @State private var isConfirmingDelete = false
    @State private var pendingRecurringDeleteScope = false
    // Birthday mode mirrors QuickCreatePopover's third creation type. When
    // true: hide attendees / location / Meet / reminder / recurrence /
    // color blocks, force isAllDay + single-day + RRULE:FREQ=YEARLY on
    // save. Only togglable in create mode (editing keeps the sheet's
    // shape so users editing existing birthday events still see all
    // fields if they need to change calendar/notes).
    @State private var isBirthdayMode: Bool = false

    init(prefilledStart: Date? = nil, prefilledIsAllDay: Bool = false, prefilledEnd: Date? = nil) {
        let start = prefilledStart ?? Date()
        let defaultEnd = prefilledIsAllDay ? start : start.addingTimeInterval(3600)
        _startDate = State(initialValue: start)
        _endDate = State(initialValue: prefilledEnd ?? defaultEnd)
        _isAllDay = State(initialValue: prefilledIsAllDay)
        _isEditing = State(initialValue: true) // create mode is always editable
    }

    // Edit-mode init: prefill every field from `existingEvent` so the same
    // "New Event" sheet becomes an edit surface. Starts in VIEW-ONLY mode
    // (isEditing = false) per user-requested flow — clicking Open on the
    // hover preview shouldn't immediately drop users into a destructive
    // edit; they tap "Edit" in the toolbar to unlock fields.
    init(existingEvent: CalendarEventMirror) {
        let cal = Calendar.current
        _startDate = State(initialValue: existingEvent.startDate)
        _endDate = State(initialValue: existingEvent.isAllDay
            ? (cal.date(byAdding: .day, value: -1, to: existingEvent.endDate) ?? existingEvent.endDate)
            : existingEvent.endDate)
        _isAllDay = State(initialValue: existingEvent.isAllDay)
        _isEditing = State(initialValue: false)
        _summary = State(initialValue: existingEvent.summary)
        _details = State(initialValue: existingEvent.details)
        _location = State(initialValue: existingEvent.location)
        _selectedCalendarID = State(initialValue: existingEvent.calendarID)
        _reminderOption = State(initialValue: EventReminderOption(minutes: existingEvent.reminderMinutes.first))
        _recurrenceRule = State(initialValue: existingEvent.recurrence.lazy.compactMap(RecurrenceRule.parse).first)
        _attendees = State(initialValue: existingEvent.attendeeEmails)
        _addGoogleMeet = State(initialValue: existingEvent.meetLink.isEmpty == false)
        _eventColor = State(initialValue: CalendarEventColor.from(colorId: existingEvent.colorId))
        _editingEvent = State(initialValue: existingEvent)
    }

    var body: some View {
        NavigationStack {
            Group {
                if model.calendars.isEmpty {
                    ContentUnavailableView(
                        "No calendars loaded",
                        systemImage: "calendar.badge.exclamationmark",
                        description: Text("Connect Google and refresh before creating an event.")
                    )
                } else if editingEvent != nil, isEditing == false {
                    // Purpose-formatted read card: renders only fields that
                    // actually carry a value. Details render as markdown, not
                    // raw text. Two-column layout when the event has enough
                    // meat to fill it; single stack otherwise.
                    ScrollView {
                        viewOnlyBody
                            .hcbScaledPadding(18)
                    }
                } else {
                    ScrollView {
                        twoColumnBody
                            .hcbScaledPadding(18)
                    }
                }
            }
            .appBackground()
            .navigationTitle(navTitle)
            .task {
                selectedCalendarID = selectedCalendarID ?? defaultCalendarID
                applyDeepLinkPrefillIfAny()
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSaving)
                }
                // Overflow menu with Delete / Duplicate / Copy as Markdown /
                // Export .ics / Save as Template only surfaces once the user
                // actively enters edit mode — the view-only pass keeps the
                // toolbar minimal apart from the explicit Delete button
                // added below.
                if editingEvent != nil, isEditing {
                    ToolbarItem(placement: .primaryAction) {
                        editMoreMenu
                    }
                }
                // View-only pass gets an explicit Delete button alongside
                // Cancel / Edit so users don't have to enter edit mode just
                // to remove an event. Routes through the confirmation /
                // recurring-scope picker below.
                if editingEvent != nil, isEditing == false {
                    ToolbarItem(placement: .destructiveAction) {
                        Button(role: .destructive) {
                            if isRecurringEvent {
                                pendingRecurringDeleteScope = true
                            } else {
                                isConfirmingDelete = true
                            }
                        } label: {
                            Text("Delete")
                        }
                        .disabled(isSaving)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if editingEvent != nil, isEditing == false {
                        // View-only pass: primary button escalates to edit.
                        Button("Edit") {
                            withAnimation(.easeInOut(duration: 0.12)) {
                                details = HCBTextMarkup.markdownSource(from: details)
                                isEditing = true
                            }
                        }
                    } else {
                        Button(editingEvent == nil ? "Create" : "Save") {
                            if editingEvent != nil, isRecurringEvent {
                                pendingRecurringScope = true
                            } else {
                                Task { await createOrUpdateEvent(scope: .thisOccurrence) }
                            }
                        }
                        .disabled(canCreate == false || isSaving)
                    }
                }
            }
            .confirmationDialog(
                "Delete this event?",
                isPresented: $isConfirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    guard let existing = editingEvent else { return }
                    Task { await deleteExistingEvent(existing) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This deletes the event from Google Calendar. It cannot be undone.")
            }
            .confirmationDialog(
                "Delete which occurrences?",
                isPresented: $pendingRecurringDeleteScope,
                titleVisibility: .visible
            ) {
                Button("This event only", role: .destructive) {
                    guard let existing = editingEvent else { return }
                    Task { await deleteEventWithScope(existing, scope: .thisOccurrence) }
                }
                Button("This and following events", role: .destructive) {
                    guard let existing = editingEvent else { return }
                    Task { await deleteEventWithScope(existing, scope: .thisAndFollowing) }
                }
                Button("Every event in the series (past + future)", role: .destructive) {
                    guard let existing = editingEvent else { return }
                    Task { await deleteEventWithScope(existing, scope: .allInSeries) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This event is part of a recurring series. \"Every event in the series\" deletes past occurrences too — not just upcoming. No guest updates are sent.")
            }
            .confirmationDialog(
                CalendarEventInstance.isRecurring(editingEvent ?? placeholderEvent)
                    ? "Update which occurrences?"
                    : "Update",
                isPresented: $pendingRecurringScope,
                titleVisibility: .visible
            ) {
                Button("This event only") {
                    Task { await createOrUpdateEvent(scope: .thisOccurrence) }
                }
                Button("This and following events", role: .destructive) {
                    Task { await createOrUpdateEvent(scope: .thisAndFollowing) }
                }
                Button("Every event in the series (past + future)", role: .destructive) {
                    Task { await createOrUpdateEvent(scope: .allInSeries) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This event is part of a recurring series. \"Every event in the series\" updates past occurrences too — not just upcoming. No guest updates are sent.")
            }
            .alert("Save as template", isPresented: $isNamingTemplate) {
                TextField("Template name", text: $templateName)
                Button("Save") {
                    let trimmed = templateName.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard let existing = editingEvent, trimmed.isEmpty == false else { return }
                    model.saveAsEventTemplate(existing, name: trimmed)
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Saves this event's summary, duration, reminders, attendees, and color as a reusable blueprint in Settings.")
            }
        }
        .hcbScaledFrame(minWidth: 820, idealWidth: 920, minHeight: 560, idealHeight: 680)
        .focusedSceneValue(\.calendarEventEditorCommandActions, calendarEventEditorCommandActions)
        .interactiveDismissDisabled(isSaving)
    }

    private var calendarEventEditorCommandActions: CalendarEventEditorCommandActions {
        CalendarEventEditorCommandActions(
            duplicateEvent: { duplicateExisting(offsetDays: 0) },
            canDuplicateEvent: editingEvent != nil && isSaving == false
        )
    }

    // True if the event being edited carries a recurrence rule or is an
    // instance of a recurring series. Drives the scope-picker dialog.
    private var isRecurringEvent: Bool {
        guard let editingEvent else { return false }
        return CalendarEventInstance.isRecurring(editingEvent)
    }

    // Sheet title flips through three states: create (New Event), view-only
    // on an existing event (Event), and active edit (Edit Event).
    private var navTitle: String {
        guard editingEvent != nil else {
            return isBirthdayMode ? "New Birthday" : "New Event"
        }
        return isEditing ? "Edit Event" : "Event"
    }

    // Sentinel used only to satisfy the confirmationDialog title interpolation
    // when editingEvent is nil (dialog won't be shown in that case; this is
    // belt-and-braces).
    private var placeholderEvent: CalendarEventMirror {
        CalendarEventMirror(
            id: "", calendarID: "", summary: "", details: "",
            startDate: Date(), endDate: Date(), isAllDay: false,
            status: .confirmed, recurrence: [], etag: nil, updatedAt: nil
        )
    }

    // Overflow menu shown in edit mode — migrated from the old
    // EventActionPanel on EventDetailView: Delete, Duplicate (5 offsets),
    // Copy as Markdown, Export .ics, Save as Template.
    @ViewBuilder
    private var editMoreMenu: some View {
        Menu {
            Button(role: .destructive) {
                guard let existing = editingEvent else { return }
                Task { await deleteExistingEvent(existing) }
            } label: {
                Label("Delete Event", systemImage: "trash")
            }
            Divider()
            Menu {
                Button {
                    guard let existing = editingEvent else { return }
                    router?.present(.convertEventToTask(existing.id))
                } label: {
                    Label("Convert to Task…", systemImage: "checklist")
                }
                Button {
                    guard let existing = editingEvent else { return }
                    router?.present(.convertEventToNote(existing.id))
                } label: {
                    Label("Convert to Note…", systemImage: "note.text")
                }
            } label: {
                Label("Convert", systemImage: "arrow.triangle.swap")
            }
            Divider()
            Menu("Duplicate") {
                Button("Duplicate here") { duplicateExisting(offsetDays: 0) }
                Button("Duplicate to tomorrow") { duplicateExisting(offsetDays: 1) }
                Button("Duplicate to next week") { duplicateExisting(offsetDays: 7) }
                Button("Duplicate in 2 weeks") { duplicateExisting(offsetDays: 14) }
                Button("Duplicate to next month") { duplicateExisting(offsetDays: 30) }
            }
            Divider()
            Button {
                guard let existing = editingEvent else { return }
                let calendarTitle = model.calendars.first(where: { $0.id == existing.calendarID })?.summary
                let markdown = EventMarkdownExporter.markdown(for: existing, calendarTitle: calendarTitle)
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(markdown, forType: .string)
            } label: {
                Label("Copy as Markdown", systemImage: "doc.on.clipboard")
            }
            Button {
                guard let existing = editingEvent else { return }
                exportEventAsICS(existing)
            } label: {
                Label("Export .ics…", systemImage: "square.and.arrow.up")
            }
            Button {
                templateName = editingEvent?.summary ?? ""
                isNamingTemplate = true
            } label: {
                Label("Save as Template…", systemImage: "doc.badge.plus")
            }
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
        .disabled(isSaving)
    }

    private func duplicateExisting(offsetDays: Int) {
        guard let existing = editingEvent else { return }
        Task {
            _ = await model.duplicateEvent(existing, offsetDays: offsetDays)
            dismiss()
        }
    }

    private func deleteExistingEvent(_ existing: CalendarEventMirror) async {
        await deleteEventWithScope(existing, scope: .thisOccurrence)
    }

    // Scope-aware delete for the view-only toolbar Delete button. Recurring
    // events land here via the scope picker; one-offs always use
    // .thisOccurrence (scope is a no-op server-side for non-recurring IDs).
    private func deleteEventWithScope(_ existing: CalendarEventMirror, scope: AppModel.RecurringEventScope) async {
        // Close the sheet IMMEDIATELY. model.deleteEvent optimistically strips
        // the event from the mirror before awaiting the Google API; while the
        // await is in flight the router's .editEvent route re-evaluates
        // model.event(id:), sees nil, and swaps the sheet content to
        // "Event not found" — a 5-15s phantom dialog the user can't dismiss.
        // Closing first lets the delete + undo toast land cleanly.
        dismiss()
        _ = await model.deleteEvent(existing, scope: scope)
    }

    private func exportEventAsICS(_ existing: CalendarEventMirror) {
        let content = EventICSExporter.ics(for: existing)
        let panel = NSSavePanel()
        let sanitized = existing.summary
            .replacingOccurrences(of: "/", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let base = sanitized.isEmpty ? "event" : sanitized
        panel.nameFieldStringValue = "\(base).ics"
        panel.allowedContentTypes = [UTType(filenameExtension: "ics") ?? .data]
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            try? content.data(using: .utf8)?.write(to: url)
        }
    }

    private var twoColumnBody: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Mode picker matches QuickCreatePopover so the detailed sheet
            // exposes the same Event/Birthday split. Hidden in edit mode —
            // changing mode mid-edit would scramble the field set.
            if editingEvent == nil {
                Picker("", selection: $isBirthdayMode) {
                    Text("Event").tag(false)
                    Text("Birthday").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 320)
            }
            if isBirthdayMode {
                birthdayBody
            } else {
                eventTwoColumnBody
            }
        }
    }

    @ViewBuilder
    private var eventTwoColumnBody: some View {
        HStack(alignment: .top, spacing: 18) {
            VStack(alignment: .leading, spacing: 14) {
                if editingEvent == nil {
                    quickCreateBlock
                }
                summaryBlock
                timeBlock
                detailsBlock
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)

            VStack(alignment: .leading, spacing: 14) {
                calendarBlock
                colorReminderBlock
                guestsBlock
                repeatBlock
                meetBlock
                if editingEvent == nil, model.settings.eventTemplates.isEmpty == false {
                    templateBlock
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }

    // Birthday body: only the fields that apply. Save path forces all-day
    // single-day + RRULE:FREQ=YEARLY (handled in createEvent).
    @ViewBuilder
    private var birthdayBody: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionCard("Birthday") {
                TextField("Whose birthday?", text: $summary)
                    .textFieldStyle(.roundedBorder)
            }
            sectionCard("Date") {
                DatePicker("Date", selection: $startDate, displayedComponents: [.date])
                    .labelsHidden()
                Text("Repeats yearly. Saved as an all-day event on the selected calendar.")
                    .hcbFont(.caption2)
                    .foregroundStyle(.secondary)
            }
            calendarBlock
            sectionCard("Notes") {
                MarkdownEditor(text: $details, placeholder: "Optional notes (markdown supported)", minHeight: 90, maxHeight: 200)
            }
        }
        .frame(maxWidth: 560, alignment: .topLeading)
    }

    @ViewBuilder
    private func sectionCard<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .hcbFont(.caption2, weight: .bold)
                .foregroundStyle(.secondary)
            content()
        }
        .hcbScaledPadding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(AppColor.cream.opacity(0.5))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(AppColor.cardStroke, lineWidth: 0.6)
        )
    }

    private var quickCreateBlock: some View {
        sectionCard("Quick Create") {
            TextField("e.g., \"Lunch with Bob tomorrow 1pm at Philz for 45 min\"", text: $quickCreateText)
                .textFieldStyle(.roundedBorder)
                .onSubmit(applyQuickCreate)
                .onChange(of: quickCreateText) { _, newValue in
                    parsedPreview = newValue.isEmpty ? nil : NaturalLanguageEventParser().parse(newValue)
                }
            if let preview = parsedPreview, preview.hasParsedMetadata || quickCreateColorTagResolution(for: preview) != nil {
                HStack(spacing: 6) {
                    ForEach(Array(preview.matchedTokens.enumerated()), id: \.offset) { _, token in
                        Text(token.display)
                            .hcbFont(.caption, weight: .medium)
                            .hcbScaledPadding(.horizontal, 6)
                            .hcbScaledPadding(.vertical, 2)
                            .background(Capsule().fill(AppColor.blue.opacity(0.15)))
                            .foregroundStyle(AppColor.blue)
                    }
                    if let color = quickCreateEventColor(for: preview) {
                        Text(color.title)
                            .hcbFont(.caption, weight: .medium)
                            .hcbScaledPadding(.horizontal, 6)
                            .hcbScaledPadding(.vertical, 2)
                            .background(Capsule().fill(quickCreateColorTint(color).opacity(0.15)))
                            .foregroundStyle(quickCreateColorTint(color))
                    }
                    Spacer(minLength: 0)
                    Button("Apply") { applyQuickCreate() }
                        .buttonStyle(.borderless)
                }
            }
        }
    }

    private var summaryBlock: some View {
        sectionCard("Event") {
            TextField("Summary", text: $summary)
                .textFieldStyle(.roundedBorder)
            TextField("Location", text: $location)
                .textFieldStyle(.roundedBorder)
            if location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
                // Editable binding — the full-view sheet surfaces a text
                // field that writes back to `location` so users can refine
                // the address from the map surface.
                LocationMapPreview(locationText: $location, isEditable: true)
            }
        }
    }

    private var timeBlock: some View {
        sectionCard("Time") {
            Toggle("All-day event", isOn: $isAllDay)
            DatePicker("Starts", selection: $startDate, displayedComponents: isAllDay ? [.date] : [.date, .hourAndMinute])
            DatePicker("Ends", selection: $endDate, displayedComponents: isAllDay ? [.date] : [.date, .hourAndMinute])
            if isValidDateRange == false {
                Text(isAllDay ? "End date cannot be before start date." : "End time must be after start time.")
                    .hcbFont(.footnote)
                    .foregroundStyle(.red)
            }
        }
    }

    private var detailsBlock: some View {
        sectionCard("Details") {
            MarkdownEditor(text: $details, placeholder: "Notes (markdown supported)", minHeight: 90, maxHeight: 200)
        }
    }

    private var calendarBlock: some View {
        sectionCard("Calendar") {
            Picker("Calendar", selection: $selectedCalendarID) {
                ForEach(model.calendars) { calendar in
                    Text(calendar.summary).tag(Optional(calendar.id))
                }
            }
            .labelsHidden()
        }
    }

    private var colorReminderBlock: some View {
        sectionCard("Color · Reminder") {
            EventColorPicker(selection: $eventColor)
            EventReminderPicker(selection: $reminderOption)
        }
    }

    private var guestsBlock: some View {
        sectionCard("Guests") {
            // Read-only response chips — only shown in edit mode when
            // responses exist. Migrated from AttendeeResponsesCard on the
            // removed EventDetailView.
            if let existing = editingEvent, existing.attendeeResponses.isEmpty == false {
                AttendeeResponsesCard(responses: existing.attendeeResponses)
                    .hcbScaledPadding(.bottom, 6)
            }
            GuestsSection(attendees: $attendees, draft: $attendeeDraft, notifyGuests: $notifyGuests)
        }
    }

    private var repeatBlock: some View {
        sectionCard("Repeat") {
            RecurrenceEditor(rule: $recurrenceRule)
        }
    }

    private var meetBlock: some View {
        sectionCard("Video call") {
            Toggle("Add Google Meet video conferencing", isOn: $addGoogleMeet)
            // Read-only link row when an existing event already has a Meet
            // URL — migrated from MeetLinkCard on the removed EventDetailView.
            if let existing = editingEvent, existing.meetLink.isEmpty == false,
               let meetURL = URL(string: existing.meetLink) {
                Link(destination: meetURL) {
                    Label(existing.meetLink, systemImage: "video.fill")
                        .foregroundStyle(AppColor.blue)
                        .lineLimit(1)
                }
                .hcbScaledPadding(.top, 4)
            }
        }
    }

    private var templateBlock: some View {
        sectionCard("Template") {
            Menu {
                ForEach(model.settings.eventTemplates) { template in
                    Button(template.name) { applyTemplate(template) }
                }
            } label: {
                Label("New from template…", systemImage: "doc.on.doc")
            }
        }
    }

    // MARK: - View-only card (read-only surface for the Open flow).

    // Conditional two-column layout: if a populated location or 2+ optional
    // right-side sections warrant the horizontal weight, split; else stack
    // vertically so minimal events don't look lopsided.
    @ViewBuilder
    private var viewOnlyBody: some View {
        let hasLocation = location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        let rightExtras = countOfPopulatedRightSections()
        let useTwoColumn = hasLocation || rightExtras >= 2

        if useTwoColumn {
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 14) {
                    readSummaryCard
                    readTimeCard
                    if details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
                        readDetailsCard
                    }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
                VStack(alignment: .leading, spacing: 14) {
                    readCalendarCard
                    if hasCustomColorOrReminder { readColorReminderCard }
                    if hasGuests { readGuestsCard }
                    if recurrenceRule != nil { readRepeatCard }
                    if hasMeet { readMeetCard }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        } else {
            VStack(alignment: .leading, spacing: 14) {
                readSummaryCard
                readTimeCard
                if details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
                    readDetailsCard
                }
                readCalendarCard
                if hasCustomColorOrReminder { readColorReminderCard }
                if hasGuests { readGuestsCard }
                if recurrenceRule != nil { readRepeatCard }
                if hasMeet { readMeetCard }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }

    private func countOfPopulatedRightSections() -> Int {
        var n = 1 // calendar is always shown
        if hasCustomColorOrReminder { n += 1 }
        if hasGuests { n += 1 }
        if recurrenceRule != nil { n += 1 }
        if hasMeet { n += 1 }
        return n - 1 // "extras" beyond the mandatory calendar card
    }

    private var hasCustomColorOrReminder: Bool {
        eventColor != .defaultColor || reminderOption != .useDefault
    }

    private var hasGuests: Bool {
        attendees.isEmpty == false || (editingEvent?.attendeeResponses.isEmpty == false)
    }

    private var hasMeet: Bool {
        guard let existing = editingEvent else { return false }
        return existing.meetLink.isEmpty == false
    }

    private var readSummaryCard: some View {
        sectionCard("Event") {
            Text(summary.isEmpty ? "Untitled" : summary)
                .hcbFont(.title3, weight: .semibold)
                .foregroundStyle(AppColor.ink)
                .textSelection(.enabled)
            if location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
                Label(location, systemImage: "mappin.and.ellipse")
                    .hcbFont(.subheadline)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                LocationMapPreview(locationText: .constant(location), isEditable: false)
            }
        }
    }

    private var readTimeCard: some View {
        sectionCard("Time") {
            if isAllDay {
                let cal = Calendar.current
                let sameDay = cal.isDate(startDate, inSameDayAs: endDate)
                if sameDay {
                    Text(startDate.formatted(.dateTime.weekday(.wide).day().month(.wide).year()))
                        .hcbFont(.subheadline)
                        .foregroundStyle(AppColor.ink)
                } else {
                    Text("\(startDate.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))) → \(endDate.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))")
                        .hcbFont(.subheadline)
                        .foregroundStyle(AppColor.ink)
                }
                Text("All-day")
                    .hcbFont(.caption, weight: .medium)
                    .foregroundStyle(.secondary)
            } else {
                Text(startDate.formatted(.dateTime.weekday(.wide).day().month(.wide).year()))
                    .hcbFont(.subheadline)
                    .foregroundStyle(AppColor.ink)
                Text("\(startDate.formatted(.dateTime.hour().minute())) – \(endDate.formatted(.dateTime.hour().minute()))")
                    .hcbFont(.subheadline, weight: .medium)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var readDetailsCard: some View {
        sectionCard("Details") {
            MarkdownBlock(source: details)
                .hcbFont(.body)
                .foregroundStyle(AppColor.ink)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var readCalendarCard: some View {
        sectionCard("Calendar") {
            let cal = model.calendars.first(where: { $0.id == selectedCalendarID })
            HStack(spacing: 8) {
                if let hex = cal?.colorHex {
                    Circle()
                        .fill(Color(hex: hex))
                        .hcbScaledFrame(width: 10, height: 10)
                }
                Text(cal?.summary ?? "Calendar")
                    .hcbFont(.subheadline)
                    .foregroundStyle(AppColor.ink)
            }
        }
    }

    private var readColorReminderCard: some View {
        sectionCard("Color · Reminder") {
            if eventColor != .defaultColor {
                HStack(spacing: 8) {
                    if let hex = eventColor.hex {
                        Circle()
                            .fill(Color(hex: hex))
                            .hcbScaledFrame(width: 14, height: 14)
                    }
                    Text(eventColor.title)
                        .hcbFont(.subheadline)
                        .foregroundStyle(AppColor.ink)
                }
            }
            if reminderOption != .useDefault {
                Label(reminderOption.title, systemImage: "bell")
                    .hcbFont(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var readGuestsCard: some View {
        sectionCard("Guests") {
            if let existing = editingEvent, existing.attendeeResponses.isEmpty == false {
                AttendeeResponsesCard(responses: existing.attendeeResponses)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(attendees, id: \.self) { email in
                        Label(email, systemImage: "person.crop.circle")
                            .hcbFont(.subheadline)
                            .foregroundStyle(AppColor.ink)
                            .textSelection(.enabled)
                    }
                }
            }
        }
    }

    private var readRepeatCard: some View {
        sectionCard("Repeat") {
            if let rule = recurrenceRule {
                Label(rule.summary, systemImage: "repeat")
                    .hcbFont(.subheadline)
                    .foregroundStyle(AppColor.ink)
            }
        }
    }

    private var readMeetCard: some View {
        sectionCard("Video call") {
            if let existing = editingEvent, let url = URL(string: existing.meetLink) {
                Link(destination: url) {
                    Label(existing.meetLink, systemImage: "video.fill")
                        .hcbFont(.subheadline)
                        .foregroundStyle(AppColor.blue)
                        .lineLimit(1)
                }
            }
        }
    }

    private var defaultCalendarID: CalendarListMirror.ID? {
        model.calendarSnapshot.selectedCalendars.first?.id ?? model.calendars.first?.id
    }

    private func applyDeepLinkPrefillIfAny() {
        // hotcrossbuns://new/event?… stages a prefill struct on AppModel. The
        // sheet consumes it here and nils it so a subsequent plain New Event
        // doesn't inherit stale values.
        guard let prefill = model.pendingEventPrefill else { return }
        defer { model.pendingEventPrefill = nil }

        if let t = prefill.title, t.isEmpty == false, summary.isEmpty {
            summary = t
        }
        if let loc = prefill.location, loc.isEmpty == false, location.isEmpty {
            location = loc
        }
        if let start = prefill.startDate {
            startDate = start
            if let end = prefill.endDate, end > start {
                endDate = end
            } else if prefill.isAllDay {
                endDate = start
            } else {
                endDate = start.addingTimeInterval(3600)
            }
        }
        if prefill.isAllDay { isAllDay = true }
        if let calRef = prefill.calendarIdOrSummary, calRef.isEmpty == false,
           let match = resolveCalendar(calRef) {
            selectedCalendarID = match.id
        }
    }

    private func resolveCalendar(_ ref: String) -> CalendarListMirror? {
        if let exact = model.calendars.first(where: { $0.id == ref }) { return exact }
        return model.calendars.first(where: { $0.summary.localizedCaseInsensitiveCompare(ref) == .orderedSame })
    }

    private var canCreate: Bool {
        summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            && selectedCalendarID != nil
            && (isBirthdayMode || isValidDateRange)
            && model.account != nil
    }

    private var isValidDateRange: Bool {
        if isAllDay {
            return Calendar.current.startOfDay(for: endDate) >= Calendar.current.startOfDay(for: startDate)
        }

        return endDate > startDate
    }

    private func applyTemplate(_ template: EventTemplate) {
        summary = template.summary
        details = template.details
        location = template.location
        isAllDay = template.isAllDay
        let start = startDate
        endDate = template.isAllDay ? start : start.addingTimeInterval(TimeInterval(template.durationMinutes) * 60)
        if let mins = template.reminderMinutes {
            reminderOption = .preset(mins)
        }
        if let colorId = template.colorId {
            eventColor = CalendarEventColor.from(colorId: colorId)
        }
        attendees = template.attendees
        addGoogleMeet = template.addGoogleMeet
    }

    private func applyQuickCreate() {
        let parsed = NaturalLanguageEventParser().parse(quickCreateText)
        guard parsed.summary.isEmpty == false else { return }
        summary = quickCreateSummaryForSubmission(parsed)
        if let color = quickCreateEventColor(for: parsed) {
            eventColor = color
        }
        if let loc = parsed.location { location = loc }
        if let start = parsed.startDate {
            startDate = start
            isAllDay = parsed.isAllDay
            if let end = parsed.endDate {
                endDate = parsed.isAllDay ? start : end
            }
        }
        quickCreateText = ""
        parsedPreview = nil
    }

    private func quickCreateColorTagResolution(for parsed: ParsedQuickAddEvent) -> ColorTagResolver.Resolution? {
        guard model.settings.colorTagAutoApplyEnabled else { return nil }
        return ColorTagResolver.resolve(
            title: parsed.summary,
            bindings: model.settings.colorTagBindings,
            policy: model.settings.colorTagMatchPolicy
        )
    }

    private func quickCreateEventColor(for parsed: ParsedQuickAddEvent) -> CalendarEventColor? {
        guard let colorId = quickCreateColorTagResolution(for: parsed)?.colorId else { return nil }
        return CalendarEventColor.from(colorId: colorId)
    }

    private func quickCreateColorTint(_ color: CalendarEventColor) -> Color {
        if let hex = color.hex { return Color(hex: hex) }
        return AppColor.blue
    }

    private func quickCreateSummaryForSubmission(_ parsed: ParsedQuickAddEvent) -> String {
        let raw = parsed.summary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let tag = quickCreateColorTagResolution(for: parsed)?.matchedTag else { return raw }
        let stripped = ColorTagResolver.stripTag(tag, from: raw)
        return stripped.isEmpty ? raw : stripped
    }

    private func createOrUpdateEvent(scope: AppModel.RecurringEventScope = .thisOccurrence) async {
        if let existing = editingEvent {
            await updateExistingEvent(existing, scope: scope)
        } else {
            await createEvent()
        }
    }

    private func createEvent() async {
        guard let selectedCalendarID else {
            return
        }

        isSaving = true
        defer { isSaving = false }

        let didCreate: Bool
        if isBirthdayMode {
            // Force the birthday shape regardless of what the user touched
            // in the (hidden) event-only fields. Same payload shape as
            // QuickCreatePopover's birthday branch — keeps the two surfaces
            // bit-identical so users get the same Google representation
            // either way.
            let day = Calendar.current.startOfDay(for: startDate)
            didCreate = await model.createEvent(
                summary: summary,
                details: details,
                startDate: day,
                endDate: day,
                isAllDay: true,
                reminderMinutes: nil,
                calendarID: selectedCalendarID,
                location: "",
                recurrence: ["RRULE:FREQ=YEARLY"],
                attendeeEmails: [],
                notifyGuests: false,
                addGoogleMeet: false,
                colorId: nil
            )
        } else {
            didCreate = await model.createEvent(
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
        }

        if didCreate {
            dismiss()
        }
    }

    // Edit-mode save path. Scope defaults to .thisOccurrence for non-
    // recurring events; the toolbar's confirmation dialog asks for
    // this-occurrence / this-and-following / all-in-series when the event
    // is part of a recurring series.
    private func updateExistingEvent(_ existing: CalendarEventMirror, scope: AppModel.RecurringEventScope) async {
        guard let selectedCalendarID else { return }
        isSaving = true
        defer { isSaving = false }
        let didUpdate = await model.updateEvent(
            existing,
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
            addGoogleMeet: addGoogleMeet,
            colorId: eventColor.wireValue
        )
        if didUpdate {
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
                ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        Text("Drop on a calendar to move:")
                            .hcbFont(.caption2, weight: .semibold)
                            .foregroundStyle(.secondary)
                            .hcbScaledPadding(.leading, 6)
                        ForEach(writable) { calendar in
                            chip(for: calendar)
                        }
                    }
                    .hcbScaledPadding(.vertical, 6)
                    .hcbScaledPadding(.horizontal, 10)
                }
                .scrollIndicators(.hidden)
            }
        }
    }

    private func chip(for calendar: CalendarListMirror) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(Color(hex: calendar.colorHex))
                .hcbScaledFrame(width: 8, height: 8)
            Text(calendar.summary)
                .hcbFont(.caption)
                .lineLimit(1)
        }
        .hcbScaledPadding(.horizontal, 10)
        .hcbScaledPadding(.vertical, 4)
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
                .hcbFont(.caption)
                .foregroundStyle(.secondary)
            TextField("Filter events", text: $text)
                .textFieldStyle(.plain)
                .hcbScaledFrame(width: 180)
                .hcbFont(.subheadline)
                .focused($isFocused)
            if text.isEmpty == false {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .hcbFont(.caption)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .hcbScaledPadding(.horizontal, 8)
        .hcbScaledPadding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(.quaternary.opacity(0.4))
        )
        .onReceive(NotificationCenter.default.publisher(for: .hcbFocusCalendarSearch)) { _ in
            isFocused = true
        }
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
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)
            }
            if isEditingCustom {
                HStack(spacing: 8) {
                    TextField("Minutes before", text: $customMinutes)
                        .textFieldStyle(.roundedBorder)
                        .hcbScaledFrame(maxWidth: 120)
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
                                .hcbScaledFrame(width: 24, height: 24)
                        } else {
                            Circle()
                                .strokeBorder(AppColor.cardStroke, lineWidth: 1)
                                .hcbScaledFrame(width: 24, height: 24)
                                .overlay(
                                    Image(systemName: "slash.circle")
                                        .hcbFont(.caption2)
                                        .foregroundStyle(.secondary)
                                )
                        }
                        if selection == color {
                            Circle()
                                .strokeBorder(AppColor.ink, lineWidth: 2)
                                .hcbScaledFrame(width: 30, height: 30)
                        }
                    }
                    .hcbScaledFrame(width: 32, height: 32)
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
struct AttendeeResponsesCard: View {
    let responses: [CalendarEventAttendee]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("GUESTS (\(responses.count))")
                .hcbFont(.caption, weight: .bold)
                .foregroundStyle(.secondary)
            ForEach(responses, id: \.email) { attendee in
                HStack(spacing: 10) {
                    Image(systemName: attendee.responseStatus.symbol)
                        .foregroundStyle(tint(for: attendee.responseStatus))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(attendee.displayName ?? attendee.email)
                            .hcbFont(.subheadline)
                            .foregroundStyle(AppColor.ink)
                        if attendee.displayName != nil {
                            Text(attendee.email)
                                .hcbFont(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 8)
                    Text(attendee.responseStatus.displayTitle)
                        .hcbFont(.caption, weight: .medium)
                        .foregroundStyle(tint(for: attendee.responseStatus))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface(cornerRadius: 18)
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
                    .hcbFont(.headline)
                    .foregroundStyle(AppColor.ink)
                HStack(spacing: 6) {
                    Image(systemName: reachability.systemSymbol)
                        .hcbFont(.caption)
                        .foregroundStyle(reachabilityTint)
                        .help("Network: \(reachability.displayTitle)")
                    Text(syncState.title)
                        .hcbFont(.caption)
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
        .hcbScaledPadding(.horizontal, 16)
        .hcbScaledPadding(.vertical, 8)
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
            .hcbScaledPadding(.horizontal, 8)
            .hcbScaledPadding(.vertical, 2)
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
                .hcbFont(.caption2, weight: .medium)
                .foregroundStyle(.secondary)
        }
        .hcbScaledPadding(.vertical, 4)
        .hcbScaledPadding(.horizontal, 10)
        .background(
            Capsule().fill((tint ?? AppColor.cream).opacity(0.35))
        )
    }
}

#Preview {
    NavigationStack {
        CalendarHomeView()
            .environment(AppModel.preview)
            .environment(\.routerPath, RouterPath())
    }
}
