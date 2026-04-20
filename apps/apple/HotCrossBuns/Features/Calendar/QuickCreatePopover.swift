import SwiftUI

// Single unified popover for click-to-create + drag-to-create events and
// tasks. Apple-Calendar-inspired layout: title row with color swatch,
// location row, collapsible date section (click the summary to expand,
// tap outside the date panel to collapse), invitees, notes.
//
// Default: all top-level fields are visible up-front. The date section
// itself toggles on click. Users who want the pre-§7.01 compact
// behaviour (only title + destination + [+ More]) can flip
// `quickCreateExpandedByDefault` off in Settings.
//
// Google coverage of each field:
// - Color (event.colorId) ✅
// - Location (event.location) ✅
// - Google Meet (event.conferenceData.createRequest) ✅
// - Start / end / all-day ✅
// - Repeat (event.recurrence RRULE) ✅
// - Alert (event.reminders.overrides) ✅
// - Invitees (event.attendees) ✅
// - Notes (event.description) ✅
// - Travel Time — NOT in Google Calendar API, intentionally omitted.
// - End Repeat UNTIL/COUNT — our RecurrenceRule model only carries
//   freq+interval today. Extending is a separate change.
// - Attachments — requires a Google Drive file picker; out of scope here.
// - Task priority / location / time-of-day — not in Google Tasks API.
struct QuickCreatePopover: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model

    let initialDate: Date
    let initialEnd: Date?
    let initiallyAllDay: Bool
    let taskOnly: Bool
    let initialTaskListID: TaskListMirror.ID?
    // Flips the sheet's identity to "New Note" and defaults hasDueDate off.
    // A note is the same Google Task underneath (TaskMirror with dueDate=nil);
    // setting a due date later moves it from the Notes tab to the Tasks tab
    // — no conversion UI needed, it's purely where the task shows up.
    let noteMode: Bool

    @State private var mode: CreateMode = .event
    @State private var summary: String = ""
    @State private var selectedListID: TaskListMirror.ID?
    @State private var selectedCalendarID: CalendarListMirror.ID?
    @State private var isSaving = false
    @FocusState private var summaryFocused: Bool
    // Outer compact fallback — only honoured when
    // AppSettings.quickCreateExpandedByDefault is false. True by default so
    // the popover starts fully detailed.
    @State private var showOptionalFields: Bool = true
    // Inner date-panel expansion. Independent of the outer collapse. Click
    // anywhere in the popover body that is not the date panel to collapse.
    @State private var isDatePanelExpanded: Bool = false

    // Editable event fields
    @State private var isAllDay: Bool = false
    @State private var startDate: Date = Date()
    @State private var endDate: Date = Date()
    @State private var eventColor: CalendarEventColor = .defaultColor
    @State private var location: String = ""
    @State private var addGoogleMeet: Bool = false
    @State private var recurrenceRule: RecurrenceRule?
    @State private var reminderMinutes: Int? = nil
    @State private var attendeesRaw: String = ""
    @State private var notes: String = ""

    // Editable task fields
    @State private var taskDueDate: Date = Date()
    @State private var hasDueDate: Bool = true
    // Per-section expansion for the task popover (Apple Reminders style).
    // Tapping a card expands it; tapping anywhere outside the card in the
    // popover body collapses it.
    @State private var isTaskDateCardExpanded: Bool = false
    @State private var isTaskListCardExpanded: Bool = false

    // Event end-repeat UI state. Lives on the popover so we can render
    // "Never / After / On Date" without exposing the enum construction
    // in the Picker directly.
    @State private var eventEndRepeatKind: RecurrenceEndKind = .never
    @State private var eventEndRepeatCount: Int = 5
    @State private var eventEndRepeatDate: Date = Date().addingTimeInterval(60 * 60 * 24 * 30)

    private enum RecurrenceEndKind: Hashable { case never, after, onDate }

    enum CreateMode: String, Hashable { case event, task }

    init(
        initialDate: Date,
        isAllDay: Bool,
        initialEnd: Date? = nil,
        taskOnly: Bool = false,
        initialTaskListID: TaskListMirror.ID? = nil,
        noteMode: Bool = false
    ) {
        self.initialDate = initialDate
        self.initialEnd = initialEnd
        self.initiallyAllDay = isAllDay
        self.taskOnly = taskOnly
        self.initialTaskListID = initialTaskListID
        self.noteMode = noteMode
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    summaryRow
                    if effectiveExpanded {
                        Group {
                            switch mode {
                            case .event: eventFields
                            case .task: taskFields
                            }
                        }
                    }
                }
                .hcbScaledPadding(.horizontal, 14)
                .hcbScaledPadding(.vertical, 12)
                // Empty-area taps inside the scroll view collapse the
                // date panel. Interactive widgets (pickers, buttons,
                // fields) consume their own taps first so they don't
                // trigger this gesture.
                .contentShape(Rectangle())
                .onTapGesture {
                    if isDatePanelExpanded || isTaskDateCardExpanded || isTaskListCardExpanded {
                        withAnimation(.easeInOut(duration: 0.14)) {
                            isDatePanelExpanded = false
                            isTaskDateCardExpanded = false
                            isTaskListCardExpanded = false
                        }
                    }
                }
            }
            .frame(maxHeight: 520)
            Divider()
            bottomBar
        }
        .hcbScaledFrame(width: 440)
        .background(.regularMaterial)
        .task {
            selectedListID = initialTaskListID ?? model.taskLists.first?.id
            selectedCalendarID = model.calendarSnapshot.selectedCalendars.first?.id ?? model.calendars.first?.id
            if taskOnly {
                mode = .task
                // Task-only callers originate from the Notes/Tasks surface
                // where "undated" is the common default — leave hasDueDate
                // on so users can pick a date, but flip to .task mode so
                // the first tap doesn't create an event.
            }
            if noteMode {
                // Note-mode flips hasDueDate off by default. Adding a date
                // later promotes it out of the Notes tab automatically.
                hasDueDate = false
            }
            summaryFocused = true
            // Seed the editable date/time fields from the drag-derived
            // bounds so click-only (no drag) gets a 1-hour window and
            // drags carry their exact range in.
            isAllDay = initiallyAllDay
            let cal = Calendar.current
            if initiallyAllDay {
                startDate = cal.startOfDay(for: initialDate)
                if let e = initialEnd {
                    endDate = cal.date(byAdding: .day, value: -1, to: e) ?? startDate
                } else {
                    endDate = startDate
                }
            } else {
                startDate = initialDate
                endDate = initialEnd ?? initialDate.addingTimeInterval(3600)
            }
            taskDueDate = cal.startOfDay(for: initialDate)
            showOptionalFields = model.settings.quickCreateExpandedByDefault
        }
    }

    private var effectiveExpanded: Bool {
        model.settings.quickCreateExpandedByDefault || showOptionalFields
    }

    // MARK: - Top bar (Event | Task toggle)

    private var topBar: some View {
        HStack(spacing: 10) {
            if taskOnly {
                // Task-only entry (e.g. clicking empty Kanban space) — the
                // Event/Task switcher is omitted so the popover can't slip
                // back into event mode from the Tasks tab. Note-mode tweaks
                // the label + icon to make the Notes-tab origin obvious.
                Label(noteMode ? "New Note" : "New Task",
                      systemImage: noteMode ? "note.text" : "checklist")
                    .hcbFont(.subheadline, weight: .semibold)
                    .foregroundStyle(AppColor.ink)
            } else {
                Picker("", selection: $mode) {
                    Text("Event").tag(CreateMode.event)
                    Text("Task").tag(CreateMode.task)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            Spacer(minLength: 0)
            destinationMenu
        }
        .hcbScaledPadding(.horizontal, 14)
        .hcbScaledPadding(.vertical, 10)
    }

    // Title row with inline color swatch (events only)
    private var summaryRow: some View {
        HStack(alignment: .top, spacing: 8) {
            TextField(noteMode ? "New Note" : (mode == .event ? "New Event" : "New Task"), text: $summary, axis: .vertical)
                .textFieldStyle(.plain)
                .hcbFont(.title3, weight: .medium)
                .lineLimit(1...4)
                .focused($summaryFocused)
                .onSubmit { Task { await save() } }
            if mode == .event {
                Menu {
                    ForEach(CalendarEventColor.allCases) { color in
                        Button {
                            eventColor = color
                        } label: {
                            // SF-Symbol dot renders reliably in macOS Menu
                            // items (custom Circle views get dropped). We
                            // tint with foregroundStyle so each row carries
                            // the palette swatch inline.
                            Label {
                                HStack {
                                    Text(color.title)
                                    if color == eventColor {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            } icon: {
                                if let hex = color.hex {
                                    Image(systemName: "circle.fill")
                                        .foregroundStyle(Color(hex: hex))
                                } else {
                                    Image(systemName: "circle.dashed")
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                } label: {
                    colorSwatch(eventColor)
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .help("Event color")
            }
        }
    }

    private func colorSwatch(_ color: CalendarEventColor) -> some View {
        HStack(spacing: 4) {
            if let hex = color.hex {
                Circle()
                    .fill(Color(hex: hex))
                    .hcbScaledFrame(width: 16, height: 16)
            } else {
                Circle()
                    .strokeBorder(AppColor.cardStroke, lineWidth: 1)
                    .hcbScaledFrame(width: 16, height: 16)
            }
            Image(systemName: "chevron.up.chevron.down")
                .hcbFont(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Event fields

    @ViewBuilder
    private var eventFields: some View {
        locationRow
        datePanel
        attendeesRow
        notesRow
    }

    private var locationRow: some View {
        HStack(spacing: 8) {
            TextField("Add Location", text: $location)
                .textFieldStyle(.plain)
                .hcbFont(.body)
            Toggle(isOn: $addGoogleMeet) {
                Image(systemName: "video")
                    .hcbFont(.body)
            }
            .toggleStyle(.button)
            .tint(AppColor.ember)
            .help(addGoogleMeet ? "Google Meet link will be created" : "Add Google Meet")
        }
        .hcbScaledPadding(10)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(AppColor.cream.opacity(0.35))
        )
    }

    // Click-to-expand date panel. Collapsed: one-line summary + hint.
    // Expanded: editable fields. Outer body's tapGesture collapses.
    private var datePanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            if isDatePanelExpanded == false {
                Button {
                    withAnimation(.easeInOut(duration: 0.14)) { isDatePanelExpanded = true }
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(compactDateLine)
                            .hcbFont(.body)
                            .foregroundStyle(AppColor.ink)
                        Text(compactHintLine)
                            .hcbFont(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .hcbScaledPadding(10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else {
                expandedDatePanel
                    .hcbScaledPadding(10)
                    .contentShape(Rectangle())
                    // Swallow taps inside the expanded panel so the
                    // outer ScrollView's collapse gesture doesn't fire
                    // when the user interacts with a picker/toggle.
                    .onTapGesture { /* no-op */ }
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(AppColor.cream.opacity(0.35))
        )
    }

    private var compactDateLine: String {
        let cal = Calendar.current
        let startStr = startDate.formatted(.dateTime.day().month(.abbreviated).year())
        if isAllDay {
            if cal.isDate(startDate, inSameDayAs: endDate) { return "\(startStr) · all-day" }
            let endStr = endDate.formatted(.dateTime.day().month(.abbreviated).year())
            return "\(startStr) → \(endStr) · all-day"
        }
        let startTime = startDate.formatted(.dateTime.hour().minute())
        let endTime = endDate.formatted(.dateTime.hour().minute())
        if cal.isDate(startDate, inSameDayAs: endDate) {
            return "\(startStr)  \(startTime) – \(endTime)"
        }
        let endStr = endDate.formatted(.dateTime.day().month(.abbreviated).year())
        return "\(startStr) \(startTime) → \(endStr) \(endTime)"
    }

    private var compactHintLine: String {
        var parts: [String] = []
        if let rule = recurrenceRule { parts.append(rule.summary) }
        if let m = reminderMinutes { parts.append(alertLabel(for: m)) }
        return parts.isEmpty ? "Add Alert or Repeat" : parts.joined(separator: " · ")
    }

    private var expandedDatePanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("All Day", isOn: $isAllDay)
                .toggleStyle(.switch)
                .tint(AppColor.ember)
            HStack {
                Text("Starts")
                    .hcbFont(.subheadline)
                    .frame(width: 90, alignment: .leading)
                if isAllDay {
                    DatePicker("", selection: $startDate, displayedComponents: [.date])
                        .labelsHidden()
                } else {
                    DatePicker("", selection: $startDate, displayedComponents: [.date, .hourAndMinute])
                        .labelsHidden()
                }
            }
            HStack {
                Text("Ends")
                    .hcbFont(.subheadline)
                    .frame(width: 90, alignment: .leading)
                if isAllDay {
                    DatePicker("", selection: $endDate, in: startDate..., displayedComponents: [.date])
                        .labelsHidden()
                } else {
                    DatePicker("", selection: $endDate, in: startDate..., displayedComponents: [.date, .hourAndMinute])
                        .labelsHidden()
                }
            }
            HStack {
                Text("Repeat")
                    .hcbFont(.subheadline)
                    .frame(width: 90, alignment: .leading)
                Picker("", selection: eventFrequencyBinding) {
                    Text("Never").tag(RecurrenceFrequency?.none)
                    Text("Every Day").tag(Optional(RecurrenceFrequency.daily))
                    Text("Every Week").tag(Optional(RecurrenceFrequency.weekly))
                    Text("Every Month").tag(Optional(RecurrenceFrequency.monthly))
                    Text("Every Year").tag(Optional(RecurrenceFrequency.yearly))
                }
                .labelsHidden()
                .pickerStyle(.menu)
            }
            if recurrenceRule != nil {
                HStack {
                    Text("End Repeat")
                        .hcbFont(.subheadline)
                        .frame(width: 90, alignment: .leading)
                    Picker("", selection: $eventEndRepeatKind) {
                        Text("Never").tag(RecurrenceEndKind.never)
                        Text("After").tag(RecurrenceEndKind.after)
                        Text("On Date").tag(RecurrenceEndKind.onDate)
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                    .onChange(of: eventEndRepeatKind) { _, _ in applyEndRepeatToRule() }
                }
                switch eventEndRepeatKind {
                case .never:
                    EmptyView()
                case .after:
                    HStack {
                        Spacer().frame(width: 90)
                        Stepper(value: $eventEndRepeatCount, in: 1...999) {
                            Text("\(eventEndRepeatCount) occurrence\(eventEndRepeatCount == 1 ? "" : "s")")
                                .monospacedDigit()
                        }
                        .onChange(of: eventEndRepeatCount) { _, _ in applyEndRepeatToRule() }
                    }
                case .onDate:
                    HStack {
                        Spacer().frame(width: 90)
                        DatePicker("", selection: $eventEndRepeatDate, in: startDate..., displayedComponents: [.date])
                            .labelsHidden()
                            .onChange(of: eventEndRepeatDate) { _, _ in applyEndRepeatToRule() }
                    }
                }
            }
            HStack {
                Text("Alert")
                    .hcbFont(.subheadline)
                    .frame(width: 90, alignment: .leading)
                Picker("", selection: reminderBinding) {
                    Text("None").tag(Int?.none)
                    Text("At time of event").tag(Int?.some(0))
                    Text("5 minutes before").tag(Int?.some(5))
                    Text("10 minutes before").tag(Int?.some(10))
                    Text("15 minutes before").tag(Int?.some(15))
                    Text("30 minutes before").tag(Int?.some(30))
                    Text("1 hour before").tag(Int?.some(60))
                    Text("2 hours before").tag(Int?.some(120))
                    Text("1 day before").tag(Int?.some(60 * 24))
                    Text("2 days before").tag(Int?.some(60 * 24 * 2))
                }
                .labelsHidden()
                .pickerStyle(.menu)
            }
            Text("Travel Time and attachments sync through google.com but aren't exposed through the Google Calendar API — add them from the web UI after creating.")
                .hcbFont(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func alertLabel(for minutes: Int) -> String {
        switch minutes {
        case 0: return "At time"
        case 60 * 24: return "1 day before"
        case 60 * 24 * 2: return "2 days before"
        case ..<60: return "\(minutes) min before"
        default: return "\(minutes / 60) h before"
        }
    }

    private var attendeesRow: some View {
        HStack {
            TextField("Add Invitees (comma-separated emails)", text: $attendeesRaw)
                .textFieldStyle(.plain)
                .hcbFont(.body)
        }
        .hcbScaledPadding(10)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(AppColor.cream.opacity(0.35))
        )
    }

    private var notesRow: some View {
        HStack(alignment: .top) {
            TextField("Add Notes or URL", text: $notes, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...6)
                .hcbFont(.body)
        }
        .hcbScaledPadding(10)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(AppColor.cream.opacity(0.35))
        )
    }

    // MARK: - Task fields (Apple-Reminders-style card layout)

    @ViewBuilder
    private var taskFields: some View {
        taskNotesCard
        sectionHeader("Date & Time")
        taskDateCard
        sectionHeader("Organisation")
        taskListCard
    }

    private func sectionHeader(_ text: String) -> some View {
        Text(text)
            .hcbFont(.caption, weight: .semibold)
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .hcbScaledPadding(.horizontal, 4)
            .hcbScaledPadding(.top, 4)
    }

    private var taskNotesCard: some View {
        TextField("Notes", text: $notes, axis: .vertical)
            .textFieldStyle(.plain)
            .lineLimit(1...6)
            .hcbFont(.body)
            .hcbScaledPadding(10)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(AppColor.cream.opacity(0.35))
            )
    }

    // Date card — collapsed shows Date label + toggle + subtitle; tap
    // card to expand the inline DatePicker.
    private var taskDateCard: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.14)) { isTaskDateCardExpanded.toggle() }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "calendar")
                        .hcbFont(.body)
                        .foregroundStyle(.secondary)
                        .hcbScaledFrame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Date")
                            .hcbFont(.body)
                            .foregroundStyle(AppColor.ink)
                        if hasDueDate {
                            Text(taskDueDate.formatted(.dateTime.weekday(.wide).day().month(.wide).year()))
                                .hcbFont(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 8)
                    Toggle("", isOn: $hasDueDate)
                        .labelsHidden()
                        .toggleStyle(.switch)
                        .tint(AppColor.ember)
                }
                .hcbScaledPadding(10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if isTaskDateCardExpanded, hasDueDate {
                Divider().hcbScaledPadding(.horizontal, 10)
                HStack {
                    Spacer(minLength: 0)
                    DatePicker("", selection: $taskDueDate, displayedComponents: [.date])
                        .labelsHidden()
                        .datePickerStyle(.stepperField)
                }
                .hcbScaledPadding(10)
                .onTapGesture { /* swallow */ }
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(AppColor.cream.opacity(0.35))
        )
    }


    private var taskListCard: some View {
        HStack(spacing: 10) {
            Image(systemName: "list.bullet")
                .hcbFont(.body)
                .foregroundStyle(.secondary)
                .hcbScaledFrame(width: 22)
            Text("List")
                .hcbFont(.body)
                .foregroundStyle(AppColor.ink)
            Spacer(minLength: 8)
            Menu {
                ForEach(model.taskLists) { list in
                    Button(list.title) { selectedListID = list.id }
                }
            } label: {
                HStack(spacing: 4) {
                    Circle()
                        .fill(AppColor.blue)
                        .hcbScaledFrame(width: 8, height: 8)
                    Text(currentListTitle)
                        .hcbFont(.body)
                    Image(systemName: "chevron.up.chevron.down")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        }
        .hcbScaledPadding(10)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(AppColor.cream.opacity(0.35))
        )
    }

    // MARK: - Bottom bar

    private var bottomBar: some View {
        HStack(spacing: 10) {
            if model.settings.quickCreateExpandedByDefault == false {
                Button {
                    withAnimation(.easeInOut(duration: 0.14)) { showOptionalFields.toggle() }
                } label: {
                    Label(showOptionalFields ? "Less" : "More", systemImage: showOptionalFields ? "chevron.up" : "plus")
                        .hcbFont(.caption)
                }
                .buttonStyle(.borderless)
                .help("Compact mode — toggle the setting in Preferences to default to detailed")
            }
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

    // MARK: - Bindings

    private var reminderBinding: Binding<Int?> {
        Binding(get: { reminderMinutes }, set: { reminderMinutes = $0 })
    }

    private var eventFrequencyBinding: Binding<RecurrenceFrequency?> {
        Binding(
            get: { recurrenceRule?.frequency },
            set: { new in
                if let new {
                    let carriedEnd = recurrenceRule?.end ?? .never
                    recurrenceRule = RecurrenceRule(frequency: new, interval: recurrenceRule?.interval ?? 1, end: carriedEnd)
                } else {
                    recurrenceRule = nil
                    eventEndRepeatKind = .never
                }
            }
        )
    }

    private func applyEndRepeatToRule() {
        guard var rule = recurrenceRule else { return }
        switch eventEndRepeatKind {
        case .never:
            rule.end = .never
        case .after:
            rule.end = .after(max(1, eventEndRepeatCount))
        case .onDate:
            rule.end = .until(eventEndRepeatDate)
        }
        recurrenceRule = rule
    }

    // MARK: - Derived

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

    // MARK: - Save

    @MainActor
    private func save() async {
        let trimmed = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return }
        isSaving = true
        defer { isSaving = false }
        switch mode {
        case .event:
            guard let calID = selectedCalendarID else { return }
            let attendees = attendeesRaw
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { $0.isEmpty == false }
            let recurrence: [String] = recurrenceRule.map { [$0.rruleString()] } ?? []
            let didCreate = await model.createEvent(
                summary: trimmed,
                details: notes,
                startDate: startDate,
                endDate: endDate,
                isAllDay: isAllDay,
                reminderMinutes: reminderMinutes,
                calendarID: calID,
                location: location,
                recurrence: recurrence,
                attendeeEmails: attendees,
                notifyGuests: false,
                addGoogleMeet: addGoogleMeet,
                colorId: eventColor.wireValue
            )
            if didCreate { dismiss() }
        case .task:
            guard let listID = selectedListID else { return }
            let didCreate = await model.createTask(
                title: trimmed,
                notes: notes,
                dueDate: hasDueDate ? Calendar.current.startOfDay(for: taskDueDate) : nil,
                taskListID: listID
            )
            if didCreate { dismiss() }
        }
    }
}

