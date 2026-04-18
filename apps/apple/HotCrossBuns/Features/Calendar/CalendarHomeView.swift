import SwiftUI

struct CalendarHomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router

    var body: some View {
        List {
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
        .appBackground()
        .navigationTitle("Google Calendar")
        .toolbar {
            Button {
                router.present(.addEvent)
            } label: {
                Label("Add Event", systemImage: "plus")
            }
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
            return "All day"
        }
        return "\(event.startDate.formatted(date: .omitted, time: .shortened)) - \(event.endDate.formatted(date: .omitted, time: .shortened))"
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
    @Environment(AppModel.self) private var model
    let eventID: CalendarEventMirror.ID

    var body: some View {
        Group {
            if let event = model.event(id: eventID) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(event.summary)
                            .font(.system(.largeTitle, design: .serif, weight: .bold))
                            .foregroundStyle(AppColor.ink)
                        if !event.details.isEmpty {
                            Text(event.details)
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                        DetailField(label: "Starts", value: event.startDate.formatted(date: .abbreviated, time: .shortened))
                        DetailField(label: "Ends", value: event.endDate.formatted(date: .abbreviated, time: .shortened))
                        DetailField(label: "Calendar ID", value: event.calendarID)
                        DetailField(label: "Google ID", value: event.id)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
                }
                .appBackground()
            } else {
                ContentUnavailableView("Event not found", systemImage: "calendar.badge.exclamationmark", description: Text("This event may have been deleted in Google Calendar."))
            }
        }
        .navigationTitle("Event")
    }
}

struct AddEventSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var selectedCalendarID: CalendarListMirror.ID?
    @State private var summary = ""
    @State private var details = ""
    @State private var startDate = Date()
    @State private var endDate = Date().addingTimeInterval(3600)
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
                    }

                    Section("Calendar") {
                        Picker("Calendar", selection: $selectedCalendarID) {
                            ForEach(model.calendars) { calendar in
                                Text(calendar.summary).tag(Optional(calendar.id))
                            }
                        }
                    }

                    Section("Time") {
                        DatePicker("Starts", selection: $startDate)
                        DatePicker("Ends", selection: $endDate)
                        if endDate <= startDate {
                            Text("End time must be after start time.")
                                .font(.footnote)
                                .foregroundStyle(.red)
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
            && endDate > startDate
            && model.account != nil
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
            startDate: startDate,
            endDate: endDate,
            calendarID: selectedCalendarID
        )

        if didCreate {
            dismiss()
        }
    }
}

#Preview {
    NavigationStack {
        CalendarHomeView()
            .environment(AppModel.preview)
            .environment(RouterPath())
    }
}
