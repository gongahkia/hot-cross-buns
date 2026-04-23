import SwiftUI

// Settings UI for §6.13 / §6.13b templates. Templates are stored locally
// and never written to Google; instantiation creates a real task / event
// with fully expanded field values, so the saved entry on google.com looks
// indistinguishable from a manually-created one.
struct TemplatesSection: View {
    @Environment(AppModel.self) private var model
    @State private var taskEditor: TaskTemplate?
    @State private var isCreatingTask = false
    @State private var eventEditor: EventTemplate?
    @State private var isCreatingEvent = false

    var body: some View {
        taskTemplatesSection
        eventTemplatesSection
    }

    // MARK: - Task templates

    private var taskTemplatesSection: some View {
        Section("Task templates") {
            if model.settings.taskTemplates.isEmpty {
                Text("No templates yet. Create one to pre-fill title, notes, due, and list using variables like {{today}}, {{+7d}}, {{nextWeekday:mon}}, {{prompt:Owner}}, or {{clipboard}}.")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.settings.taskTemplates) { template in
                    Button {
                        taskEditor = template
                    } label: {
                        HStack {
                            Label(template.name, systemImage: "doc.text")
                            Spacer()
                            Text(template.title.isEmpty ? "(no title)" : template.title)
                                .hcbFont(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            model.deleteTaskTemplate(template.id)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    .contextMenu {
                        Button {
                            taskEditor = template
                        } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                        Divider()
                        Button(role: .destructive) {
                            model.deleteTaskTemplate(template.id)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
            Button {
                isCreatingTask = true
            } label: {
                Label("New Task Template", systemImage: "plus")
            }
            Text("Instantiate from the command palette: \"Insert Task Template…\". Variables in {{…}} are expanded before the task is created; unknown variables are left visible so typos don't silently drop values.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        }
        .sheet(isPresented: $isCreatingTask) {
            TaskTemplateEditor(draft: TaskTemplate(name: "New Template", title: "")) { updated in
                model.upsertTaskTemplate(updated)
                isCreatingTask = false
            } onCancel: {
                isCreatingTask = false
            }
        }
        .sheet(item: $taskEditor) { current in
            TaskTemplateEditor(draft: current) { updated in
                model.upsertTaskTemplate(updated)
                taskEditor = nil
            } onCancel: { taskEditor = nil }
        }
    }

    // MARK: - Event templates (§6.13b)

    private var eventTemplatesSection: some View {
        Section("Event templates") {
            if model.settings.eventTemplates.isEmpty {
                Text("No event templates yet. Create one to pre-fill title, time, location, attendees, and recurrence using variables like {{today}}, {{nextWeekday:mon}}, {{prompt:Topic}}.")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.settings.eventTemplates) { template in
                    Button {
                        eventEditor = template
                    } label: {
                        HStack {
                            Label(template.name, systemImage: "calendar")
                            Spacer()
                            Text(template.summary.isEmpty ? "(no title)" : template.summary)
                                .hcbFont(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            model.deleteEventTemplate(template.id)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    .contextMenu {
                        Button {
                            eventEditor = template
                        } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                        Divider()
                        Button(role: .destructive) {
                            model.deleteEventTemplate(template.id)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
            Button {
                isCreatingEvent = true
            } label: {
                Label("New Event Template", systemImage: "plus")
            }
            Text("Instantiate from the command palette: \"Insert Event Template…\". Same variable set as task templates; dateAnchor resolves to YYYY-MM-DD, timeAnchor is literal HH:mm. Unknown variables stay visible so typos don't silently drop values.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        }
        .sheet(isPresented: $isCreatingEvent) {
            EventTemplateEditor(
                draft: EventTemplate(name: "New Event Template", summary: "")
            ) { updated in
                model.upsertEventTemplate(updated)
                isCreatingEvent = false
            } onCancel: {
                isCreatingEvent = false
            }
        }
        .sheet(item: $eventEditor) { current in
            EventTemplateEditor(draft: current) { updated in
                model.upsertEventTemplate(updated)
                eventEditor = nil
            } onCancel: { eventEditor = nil }
        }
    }
}

private struct TaskTemplateEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State var draft: TaskTemplate
    let onSave: (TaskTemplate) -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Template") {
                    TextField("Name", text: $draft.name)
                }
                Section("Task") {
                    TextField("Title (required)", text: $draft.title)
                    TextField("Notes", text: $draft.notes, axis: .vertical)
                        .lineLimit(3 ... 8)
                    TextField("Due (e.g. {{today}}, {{+7d}}, 2026-05-01)", text: $draft.due)
                    TextField("List (id, title, or empty for default)", text: $draft.listIdOrTitle)
                }
                Section {
                    let prompts = draft.requiredPrompts()
                    if prompts.isEmpty == false {
                        Text("Prompts at instantiation: \(prompts.joined(separator: ", "))")
                            .hcbFont(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("No {{prompt:Label}} placeholders — the template instantiates without asking for input.")
                            .hcbFont(.caption)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Variables")
                } footer: {
                    Text("{{today}} {{tomorrow}} {{yesterday}} {{+Nd/-Nd/w/m/y}} {{nextWeekday:mon}} {{clipboard}} {{cursor}} {{prompt:Label}}")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Task Template")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .keyboardShortcut(.cancelAction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(draft) }
                        .keyboardShortcut(.defaultAction)
                        .buttonStyle(.borderedProminent)
                        .disabled(draft.name.trimmingCharacters(in: .whitespaces).isEmpty
                            || draft.title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .hcbScaledFrame(minWidth: 480, minHeight: 460)
    }
}

// §6.13b — Event template editor. Provides a form for every templated
// event field. Attendee list is edited as newline-separated addresses.
private struct EventTemplateEditor: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State var draft: EventTemplate
    let onSave: (EventTemplate) -> Void
    let onCancel: () -> Void

    // Newline-separated editor for the attendees array. Round-trips into
    // draft.attendees on every keystroke so requiredPrompts() stays accurate.
    @State private var attendeesRaw: String = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Template") {
                    TextField("Name", text: $draft.name)
                }
                Section("Event") {
                    TextField("Title (required)", text: $draft.summary)
                    TextField("Details", text: $draft.details, axis: .vertical)
                        .lineLimit(3 ... 8)
                    TextField("Location", text: $draft.location)
                }
                Section("When") {
                    Toggle("All-day", isOn: $draft.isAllDay)
                    TextField("Date anchor (e.g. {{today}}, {{nextWeekday:mon}}, 2026-05-01)", text: $draft.dateAnchor)
                    if draft.isAllDay == false {
                        TextField("Time (24h HH:mm — empty rounds up to the next 15m)", text: $draft.timeAnchor)
                    }
                    Stepper(
                        value: $draft.durationMinutes,
                        in: 5 ... 24 * 60,
                        step: 5
                    ) {
                        Text("Duration: \(draft.durationMinutes) min")
                    }
                }
                Section("Recurrence") {
                    TextField("RRULE body (e.g. FREQ=WEEKLY;BYDAY=MO)", text: $draft.recurrenceRule)
                        .textFieldStyle(.roundedBorder)
                    Text("Leave empty for a one-off event. The \"RRULE:\" prefix is added automatically if missing.")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                }
                Section("Destination") {
                    if writableCalendars.isEmpty {
                        TextField("Calendar (id or title)", text: $draft.calendarIdOrTitle)
                        Text("No calendars loaded yet. Leave empty to fall back to the first writable calendar at instantiation.")
                            .hcbFont(.caption2)
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("Calendar", selection: calendarPickerBinding) {
                            Text("First writable (default)").tag("")
                            ForEach(writableCalendars) { cal in
                                Text(cal.summary).tag(cal.id)
                            }
                            // Surface a free-form option so power users can still hand-enter
                            // an id / title the picker doesn't list (e.g. a calendar that
                            // hasn't synced yet).
                            if draft.calendarIdOrTitle.isEmpty == false
                                && writableCalendars.contains(where: { $0.id == draft.calendarIdOrTitle }) == false {
                                Text("Custom: \(draft.calendarIdOrTitle)").tag(draft.calendarIdOrTitle)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                }
                Section("Guests") {
                    TextField("Attendees — one email per line", text: $attendeesRaw, axis: .vertical)
                        .lineLimit(2 ... 6)
                        .onChange(of: attendeesRaw) { _, newValue in
                            draft.attendees = newValue
                                .split(whereSeparator: { $0.isNewline })
                                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                                .filter { $0.isEmpty == false }
                        }
                    Toggle("Add Google Meet link", isOn: $draft.addGoogleMeet)
                }
                Section("Reminder") {
                    Picker("Remind me", selection: reminderBinding) {
                        Text("None").tag(-1)
                        Text("At time of event").tag(0)
                        Text("5 min before").tag(5)
                        Text("10 min before").tag(10)
                        Text("15 min before").tag(15)
                        Text("30 min before").tag(30)
                        Text("1 hour before").tag(60)
                        Text("1 day before").tag(1440)
                    }
                    .pickerStyle(.menu)
                }
                Section {
                    let prompts = draft.requiredPrompts()
                    if prompts.isEmpty == false {
                        Text("Prompts at instantiation: \(prompts.joined(separator: ", "))")
                            .hcbFont(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("No {{prompt:Label}} placeholders — the template instantiates without asking for input.")
                            .hcbFont(.caption)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Variables")
                } footer: {
                    Text("{{today}} {{tomorrow}} {{yesterday}} {{+Nd/-Nd/w/m/y}} {{nextWeekday:mon}} {{clipboard}} {{cursor}} {{prompt:Label}}")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Event Template")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .keyboardShortcut(.cancelAction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(draft) }
                        .keyboardShortcut(.defaultAction)
                        .buttonStyle(.borderedProminent)
                        .disabled(draft.name.trimmingCharacters(in: .whitespaces).isEmpty
                            || draft.summary.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .hcbScaledFrame(minWidth: 520, minHeight: 560)
        .onAppear {
            attendeesRaw = draft.attendees.joined(separator: "\n")
        }
    }

    // -1 = nil (no reminder); 0+ = minutes before.
    private var reminderBinding: Binding<Int> {
        Binding(
            get: { draft.reminderMinutes ?? -1 },
            set: { draft.reminderMinutes = $0 < 0 ? nil : $0 }
        )
    }

    private var writableCalendars: [CalendarListMirror] {
        model.calendars.filter { $0.accessRole == "owner" || $0.accessRole == "writer" }
    }

    private var calendarPickerBinding: Binding<String> {
        Binding(
            get: { draft.calendarIdOrTitle },
            set: { draft.calendarIdOrTitle = $0 }
        )
    }
}
