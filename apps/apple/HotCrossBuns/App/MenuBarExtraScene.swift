import AppKit
import SwiftUI

struct MenuBarExtraContent: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if model.settings.showDetailedMenuBar {
                DetailedMenuBarPanel()
            } else {
                CompactMenuBarPanel()
            }
        }
    }
}

private struct CompactMenuBarPanel: View {
    @Environment(AppModel.self) private var model

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Hot Cross Buns")
                .font(.headline)
            Spacer()
            Text(model.syncState.title)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            Divider()
            overview
            Divider()
            MenuBarQuickAddRow()
            Divider()
            MenuBarQuickActions()
        }
        .padding(14)
        .frame(width: 300)
    }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 6) {
            StatusLine(label: "Due today", value: "\(model.todaySnapshot.dueTasks.count)")
            StatusLine(label: "Overdue", value: "\(model.todaySnapshot.overdueCount)")
            StatusLine(label: "Events today", value: "\(model.todaySnapshot.scheduledEvents.count)")
            if let lastSync = model.lastSuccessfulSyncAt {
                StatusLine(label: "Last sync", value: lastSync.formatted(date: .omitted, time: .shortened))
            } else {
                StatusLine(label: "Last sync", value: "Never")
            }
        }
    }
}

private struct DetailedMenuBarPanel: View {
    @Environment(AppModel.self) private var model
    @State private var displayedMonth = Calendar.current.startOfMonth(for: Date())
    @State private var selectedDay = Calendar.current.startOfDay(for: Date())

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            weekdayHeader
            dayGrid
            Divider()
            agenda
            Divider()
            MenuBarQuickAddRow()
            Divider()
            MenuBarQuickActions()
        }
        .padding(12)
        .frame(width: 352)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(displayedMonth.formatted(.dateTime.month(.abbreviated).year()))
                .font(.headline.weight(.semibold))
            Spacer(minLength: 0)
            Button {
                displayedMonth = Calendar.current.date(byAdding: .month, value: -1, to: displayedMonth) ?? displayedMonth
            } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.plain)

            Button {
                displayedMonth = Calendar.current.startOfMonth(for: Date())
                selectedDay = Calendar.current.startOfDay(for: Date())
            } label: {
                Text("Today")
                    .font(.caption.weight(.medium))
            }
            .buttonStyle(.borderless)

            Button {
                displayedMonth = Calendar.current.date(byAdding: .month, value: 1, to: displayedMonth) ?? displayedMonth
            } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.plain)
        }
    }

    private var weekdayHeader: some View {
        let symbols = Calendar.current.shortStandaloneWeekdaySymbolsAlignedToFirstWeekday
        return HStack(spacing: 0) {
            ForEach(symbols, id: \.self) { symbol in
                Text(symbol.uppercased())
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var dayGrid: some View {
        LazyVGrid(columns: columns, spacing: 6) {
            ForEach(Calendar.current.menuBarMonthGrid(for: displayedMonth)) { day in
                Button {
                    selectedDay = day.date
                } label: {
                    VStack(spacing: 2) {
                        Text("\(Calendar.current.component(.day, from: day.date))")
                            .font(.system(size: 12, weight: day.isToday ? .bold : .regular))
                            .foregroundStyle(dayTextColor(for: day))
                            .frame(maxWidth: .infinity)
                        markerDots(for: day.date)
                    }
                    .padding(.vertical, 4)
                    .background(dayBackground(for: day))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var agenda: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                if agendaSections.isEmpty {
                    Text("No tasks or events for the next two weeks.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 8)
                } else {
                    ForEach(agendaSections) { section in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(section.title)
                                    .font(.subheadline.weight(.semibold))
                                Spacer()
                                Text(section.date.formatted(.dateTime.month().day()))
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }

                            ForEach(section.items) { item in
                                HStack(alignment: .top, spacing: 8) {
                                    Circle()
                                        .fill(item.color)
                                        .frame(width: 7, height: 7)
                                        .padding(.top, 5)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(item.title)
                                            .font(.subheadline)
                                            .lineLimit(1)
                                        if item.subtitle.isEmpty == false {
                                            Text(item.subtitle)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(1)
                                        }
                                    }
                                }
                            }
                        }

                        Divider()
                    }
                }
            }
            .padding(.top, 2)
        }
        .frame(maxHeight: 190)
    }

    private func dayTextColor(for day: MenuBarGridDay) -> Color {
        if day.isInDisplayedMonth == false {
            return .secondary.opacity(0.55)
        }
        if Calendar.current.isDate(selectedDay, inSameDayAs: day.date) {
            return .white
        }
        return .primary
    }

    @ViewBuilder
    private func dayBackground(for day: MenuBarGridDay) -> some View {
        if Calendar.current.isDate(selectedDay, inSameDayAs: day.date) {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(Color.accentColor.opacity(0.9))
        } else if day.isToday {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .stroke(Color.accentColor.opacity(0.8), lineWidth: 1.4)
        } else {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(Color.clear)
        }
    }

    private func markerDots(for date: Date) -> some View {
        let colors = markerColors(for: date)
        return HStack(spacing: 2) {
            ForEach(Array(colors.enumerated()), id: \.offset) { _, color in
                Circle()
                    .fill(color)
                    .frame(width: 4, height: 4)
            }
        }
        .frame(height: 5)
    }

    private func markerColors(for date: Date) -> [Color] {
        let start = Calendar.current.startOfDay(for: date)
        let end = Calendar.current.date(byAdding: .day, value: 1, to: start) ?? start
        let calendarColors: [String: Color] = Dictionary(
            uniqueKeysWithValues: model.calendars.map { ($0.id, Color(hex: $0.colorHex)) }
        )

        let eventColors = model.events
            .filter { $0.status != .cancelled && $0.endDate > start && $0.startDate < end }
            .compactMap { calendarColors[$0.calendarID] }

        let hasDueTasks = model.tasks.contains { task in
            guard task.isDeleted == false, task.isCompleted == false, let dueDate = task.dueDate else { return false }
            return Calendar.current.isDate(dueDate, inSameDayAs: date)
        }

        var colors = eventColors
        if hasDueTasks {
            colors.append(AppColor.ember)
        }

        var unique: [Color] = []
        for color in colors where unique.count < 3 {
            if unique.contains(color) == false {
                unique.append(color)
            }
        }
        return unique
    }

    private var agendaSections: [MenuAgendaSection] {
        let horizon = 14
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: selectedDay)
        let calendarTitles = Dictionary(uniqueKeysWithValues: model.calendars.map { ($0.id, $0.summary) })

        return (0..<horizon).compactMap { offset in
            let day = calendar.date(byAdding: .day, value: offset, to: start) ?? start
            let dayEnd = calendar.date(byAdding: .day, value: 1, to: day) ?? day

            let eventItems: [MenuAgendaItem] = model.events
                .filter { $0.status != .cancelled && $0.endDate > day && $0.startDate < dayEnd }
                .sorted { $0.startDate < $1.startDate }
                .map { event in
                    let subtitle: String
                    if event.isAllDay {
                        subtitle = "All day · \(calendarTitles[event.calendarID] ?? "Calendar")"
                    } else {
                        subtitle = "\(event.startDate.formatted(date: .omitted, time: .shortened))–\(event.endDate.formatted(date: .omitted, time: .shortened)) · \(calendarTitles[event.calendarID] ?? "Calendar")"
                    }
                    return MenuAgendaItem(
                        title: event.summary,
                        subtitle: subtitle,
                        color: Color(hex: model.calendars.first(where: { $0.id == event.calendarID })?.colorHex ?? "#4A90E2")
                    )
                }

            let taskItems: [MenuAgendaItem] = model.tasks
                .filter { task in
                    guard task.isDeleted == false, task.isCompleted == false, let dueDate = task.dueDate else { return false }
                    return calendar.isDate(dueDate, inSameDayAs: day)
                }
                .sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
                .map { task in
                    let taskListTitle = model.taskLists.first(where: { $0.id == task.taskListID })?.title ?? "Tasks"
                    return MenuAgendaItem(
                        title: task.title,
                        subtitle: taskListTitle,
                        color: AppColor.ember
                    )
                }

            let items = eventItems + taskItems
            guard items.isEmpty == false else { return nil }

            return MenuAgendaSection(
                date: day,
                title: dayHeading(for: day),
                items: items
            )
        }
    }

    private func dayHeading(for day: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) {
            return "Today"
        }
        if calendar.isDateInTomorrow(day) {
            return "Tomorrow"
        }
        return day.formatted(.dateTime.weekday(.wide))
    }
}

private struct MenuBarQuickAddRow: View {
    @Environment(AppModel.self) private var model
    @State private var input: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .foregroundStyle(AppColor.ember)
                TextField("Add a task — tmr 9am #work", text: $input)
                    .textFieldStyle(.plain)
                    .font(.subheadline)
                    .onSubmit { Task { await submit() } }
                if isSubmitting {
                    ProgressView().controlSize(.small)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(.quaternary.opacity(0.5))
            )
            if let errorMessage {
                Text(errorMessage)
                    .font(.caption2)
                    .foregroundStyle(AppColor.ember)
            }
        }
        .disabled(model.account == nil || model.taskLists.isEmpty)
    }

    private func submit() async {
        let parsed = NaturalLanguageTaskParser().parse(input)
        guard parsed.title.isEmpty == false else { return }
        guard let listID = resolvedListID(hint: parsed.taskListHint) else {
            errorMessage = "Connect Google and pick a task list first."
            return
        }
        isSubmitting = true
        errorMessage = nil
        let created = await model.createTask(
            title: parsed.title,
            notes: "",
            dueDate: parsed.dueDate,
            taskListID: listID
        )
        isSubmitting = false
        if created {
            input = ""
        } else {
            errorMessage = model.lastMutationError ?? "Couldn't add task."
        }
    }

    private func resolvedListID(hint: String?) -> TaskListMirror.ID? {
        if let hint {
            if let exact = model.taskLists.first(where: { $0.title.localizedCaseInsensitiveCompare(hint) == .orderedSame }) {
                return exact.id
            }
            if let fuzzy = model.taskLists.first(where: { $0.title.localizedCaseInsensitiveContains(hint) }) {
                return fuzzy.id
            }
        }
        return model.taskLists.first?.id
    }
}

private struct MenuBarQuickActions: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 6) {
            Button {
                bringAppToFront()
            } label: {
                Label("Open Hot Cross Buns", systemImage: "arrow.up.right.square")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.bordered)

            Button {
                Task { await model.refreshNow() }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.bordered)
            .disabled(model.account == nil)

            Button {
                NSApp.terminate(nil)
            } label: {
                Label("Quit", systemImage: "power")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.bordered)
        }
    }

    private func bringAppToFront() {
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.canBecomeMain }) {
            window.makeKeyAndOrderFront(nil)
        }
    }
}

private struct MenuBarGridDay: Identifiable {
    let date: Date
    let isInDisplayedMonth: Bool
    let isToday: Bool

    var id: Date { date }
}

private struct MenuAgendaSection: Identifiable {
    let date: Date
    let title: String
    let items: [MenuAgendaItem]

    var id: Date { date }
}

private struct MenuAgendaItem: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let color: Color
}

private struct StatusLine: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.body.monospacedDigit())
        }
        .font(.callout)
    }
}

private extension Calendar {
    func startOfMonth(for date: Date) -> Date {
        let components = dateComponents([.year, .month], from: date)
        return self.date(from: components) ?? date
    }

    var shortStandaloneWeekdaySymbolsAlignedToFirstWeekday: [String] {
        let base = shortStandaloneWeekdaySymbols
        guard base.count == 7 else { return base }
        let shift = max(0, min(6, firstWeekday - 1))
        return Array(base[shift...] + base[..<shift])
    }

    func menuBarMonthGrid(for monthStartDate: Date) -> [MenuBarGridDay] {
        let monthStart = startOfMonth(for: monthStartDate)
        let startWeekday = component(.weekday, from: monthStart)
        let leadingCount = (startWeekday - firstWeekday + 7) % 7
        let gridStart = date(byAdding: .day, value: -leadingCount, to: monthStart) ?? monthStart

        return (0..<42).compactMap { dayOffset in
            guard let date = date(byAdding: .day, value: dayOffset, to: gridStart) else { return nil }
            return MenuBarGridDay(
                date: startOfDay(for: date),
                isInDisplayedMonth: isDate(date, equalTo: monthStart, toGranularity: .month),
                isToday: isDateInToday(date)
            )
        }
    }
}
