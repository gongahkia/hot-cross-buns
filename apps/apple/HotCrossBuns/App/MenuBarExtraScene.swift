import AppKit
import SwiftUI

struct MenuBarExtraContent: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            switch model.settings.menuBarStyle {
            case .detailed: DetailedMenuBarPanel()
            case .weekly: WeeklyMenuBarPanel()
            case .focusStrip: FocusStripMenuBarPanel()
            case .dayTimeline: DayTimelineMenuBarPanel()
            case .minimalBadge: MinimalBadgeMenuBarPanel()
            case .compact: CompactMenuBarPanel()
            }
        }
        .id(model.settings.colorSchemeID)
        .withHCBAppearance(model.settings)
        .onChange(of: model.settings.colorSchemeID, initial: true) { _, newID in
            HCBColorSchemeStore.current = HCBColorScheme.scheme(id: newID) ?? .notion
        }
    }
}

private extension AppModel {
    var menuBarSelectedCalendarIDs: Set<CalendarListMirror.ID> {
        let selected = Set(calendarSnapshot.selectedCalendars.map(\.id))
        return selected.isEmpty ? Set(calendars.map(\.id)) : selected
    }

    var menuBarVisibleTaskListIDs: Set<TaskListMirror.ID> {
        settings.hasConfiguredTaskListSelection
            ? settings.selectedTaskListIDs
            : Set(taskLists.map(\.id))
    }
}

private struct CompactMenuBarPanel: View {
    @Environment(AppModel.self) private var model

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Hot Cross Buns")
                .hcbFont(.headline)
            Spacer()
            Text(model.syncState.title)
                .hcbFont(.caption, weight: .medium)
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
        .hcbScaledPadding(14)
        .hcbScaledFrame(width: 300)
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
        .hcbScaledPadding(12)
        .hcbScaledFrame(width: 352)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(displayedMonth.formatted(.dateTime.month(.abbreviated).year()))
                .hcbFont(.headline, weight: .semibold)
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
                    .hcbFont(.caption, weight: .medium)
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
                    .hcbFont(.caption2, weight: .semibold)
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
                    .hcbScaledPadding(.vertical, 4)
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
                        .hcbFont(.footnote)
                        .foregroundStyle(.secondary)
                        .hcbScaledPadding(.vertical, 8)
                } else {
                    ForEach(agendaSections) { section in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(section.title)
                                    .hcbFont(.subheadline, weight: .semibold)
                                Spacer()
                                Text(section.date.formatted(.dateTime.month().day()))
                                    .hcbFont(.subheadline, weight: .semibold)
                                    .foregroundStyle(.secondary)
                            }

                            ForEach(section.items) { item in
                                HStack(alignment: .top, spacing: 8) {
                                    Circle()
                                        .fill(item.color)
                                        .hcbScaledFrame(width: 7, height: 7)
                                        .hcbScaledPadding(.top, 5)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(item.title)
                                            .hcbFont(.subheadline)
                                            .lineLimit(1)
                                        if item.subtitle.isEmpty == false {
                                            Text(item.subtitle)
                                                .hcbFont(.caption)
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
            .hcbScaledPadding(.top, 2)
        }
        .hcbScaledFrame(maxHeight: 190)
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
                    .hcbScaledFrame(width: 4, height: 4)
            }
        }
        .hcbScaledFrame(height: 5)
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

private struct FocusStripMenuBarPanel: View {
    @Environment(AppModel.self) private var model
    @State private var completingTaskIDs: Set<TaskMirror.ID> = []

    private enum Lane: Int, CaseIterable, Identifiable {
        case now
        case next
        case later

        var id: Int { rawValue }

        var title: String {
            switch self {
            case .now: "Now"
            case .next: "Next"
            case .later: "Later"
            }
        }

        var tint: Color {
            switch self {
            case .now: AppColor.ember
            case .next: AppColor.blue
            case .later: AppColor.moss
            }
        }

        var emptyState: String {
            switch self {
            case .now: "You're clear right now."
            case .next: "Nothing queued next."
            case .later: "No later commitments."
            }
        }
    }

    private enum ActionableItem {
        case task(TaskMirror)
        case event(CalendarEventMirror)
    }

    private struct LaneRow: Identifiable {
        let lane: Lane
        let title: String
        let subtitle: String
        let symbol: String
        let color: Color
        let task: TaskMirror?
        let isPlaceholder: Bool

        var id: Int { lane.rawValue }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Focus strip")
                    .hcbFont(.headline)
                Spacer()
                Text(model.syncState.title)
                    .hcbFont(.caption, weight: .medium)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 7) {
                ForEach(Lane.allCases) { lane in
                    laneRow(for: row(for: lane))
                }
            }

            Divider()
            MenuBarQuickAddRow()
            Divider()
            MenuBarQuickActions()
        }
        .hcbScaledPadding(14)
        .hcbScaledFrame(width: 336)
    }

    @ViewBuilder
    private func laneRow(for row: LaneRow) -> some View {
        HStack(spacing: 8) {
            Text(row.lane.title.uppercased())
                .hcbFont(.caption2, weight: .bold)
                .foregroundStyle(row.lane.tint)
                .hcbScaledFrame(width: 40, alignment: .leading)

            VStack(alignment: .leading, spacing: 1) {
                Text(row.title)
                    .font(.subheadline.weight(row.isPlaceholder ? .regular : .semibold))
                    .lineLimit(1)
                    .foregroundStyle(row.isPlaceholder ? .secondary : .primary)
                Text(row.subtitle)
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if let task = row.task {
                Button {
                    complete(task)
                } label: {
                    if completingTaskIDs.contains(task.id) {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "checkmark.circle")
                            .foregroundStyle(AppColor.ember)
                    }
                }
                .buttonStyle(.plain)
                .disabled(completingTaskIDs.contains(task.id))
            } else {
                Image(systemName: row.symbol)
                    .hcbFont(.caption)
                    .foregroundStyle(row.isPlaceholder ? .secondary : row.color)
            }
        }
        .hcbScaledPadding(.horizontal, 8)
        .hcbScaledPadding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(
                    row.isPlaceholder
                        ? AnyShapeStyle(Color.secondary.opacity(0.16))
                        : AnyShapeStyle(row.color.opacity(0.10))
                )
        )
    }

    private var actionable: [ActionableItem] {
        let now = Date()
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: now)
        let selectedCalendars = model.menuBarSelectedCalendarIDs
        let visibleTaskLists = model.menuBarVisibleTaskListIDs

        let taskPool = model.tasks
            .filter { task in
                guard task.isDeleted == false, task.isCompleted == false, task.dueDate != nil else { return false }
                return visibleTaskLists.contains(task.taskListID)
            }
            .sorted {
                ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture)
            }

        let overdueTasks = taskPool.filter { ($0.dueDate ?? .distantFuture) < startOfToday }
        let dueTodayTasks = taskPool.filter { task in
            guard let dueDate = task.dueDate else { return false }
            return calendar.isDate(dueDate, inSameDayAs: now)
        }
        let futureTasks = taskPool.filter { ($0.dueDate ?? .distantPast) > startOfToday }

        let eventPool = model.events
            .filter { event in
                selectedCalendars.contains(event.calendarID) && event.status != .cancelled && event.endDate > now
            }
            .sorted { $0.startDate < $1.startDate }
        let ongoingEvent = eventPool.first(where: { $0.startDate <= now && $0.endDate > now })
        let upcomingEvents = eventPool.filter { $0.startDate > now }

        var items: [ActionableItem] = []
        var seenTaskIDs: Set<TaskMirror.ID> = []
        var seenEventIDs: Set<CalendarEventMirror.ID> = []

        func addTask(_ task: TaskMirror) {
            guard seenTaskIDs.insert(task.id).inserted else { return }
            items.append(.task(task))
        }

        func addEvent(_ event: CalendarEventMirror) {
            guard seenEventIDs.insert(event.id).inserted else { return }
            items.append(.event(event))
        }

        overdueTasks.prefix(2).forEach(addTask)
        if let ongoingEvent {
            addEvent(ongoingEvent)
        }
        upcomingEvents.prefix(3).forEach(addEvent)
        dueTodayTasks.prefix(3).forEach(addTask)
        futureTasks.prefix(3).forEach(addTask)

        return Array(items.prefix(3))
    }

    private func row(for lane: Lane) -> LaneRow {
        guard actionable.indices.contains(lane.rawValue) else {
            return LaneRow(
                lane: lane,
                title: lane.emptyState,
                subtitle: "No immediate tasks or events",
                symbol: "sparkles",
                color: .secondary,
                task: nil,
                isPlaceholder: true
            )
        }

        switch actionable[lane.rawValue] {
        case .task(let task):
            return LaneRow(
                lane: lane,
                title: task.title,
                subtitle: taskSubtitle(for: task),
                symbol: "checkmark.circle",
                color: AppColor.ember,
                task: task,
                isPlaceholder: false
            )
        case .event(let event):
            return LaneRow(
                lane: lane,
                title: event.summary,
                subtitle: eventSubtitle(for: event),
                symbol: "calendar",
                color: AppColor.blue,
                task: nil,
                isPlaceholder: false
            )
        }
    }

    private func taskSubtitle(for task: TaskMirror) -> String {
        let listTitle = model.taskLists.first(where: { $0.id == task.taskListID })?.title ?? "Tasks"
        guard let dueDate = task.dueDate else {
            return listTitle
        }

        let calendar = Calendar.current
        if dueDate < calendar.startOfDay(for: Date()) {
            return "Overdue · \(listTitle)"
        }
        if calendar.isDateInToday(dueDate) {
            return "Due today · \(listTitle)"
        }
        return "Due \(dueDate.formatted(.dateTime.weekday(.abbreviated).month().day())) · \(listTitle)"
    }

    private func eventSubtitle(for event: CalendarEventMirror) -> String {
        let calendarTitle = model.calendars.first(where: { $0.id == event.calendarID })?.summary ?? "Calendar"
        if event.isAllDay {
            return "All day · \(calendarTitle)"
        }
        return "\(event.startDate.formatted(date: .omitted, time: .shortened))–\(event.endDate.formatted(date: .omitted, time: .shortened)) · \(calendarTitle)"
    }

    private func complete(_ task: TaskMirror) {
        guard completingTaskIDs.contains(task.id) == false else { return }
        completingTaskIDs.insert(task.id)
        Task {
            _ = await model.setTaskCompleted(true, task: task)
            _ = await MainActor.run {
                completingTaskIDs.remove(task.id)
            }
        }
    }
}

private struct DayTimelineMenuBarPanel: View {
    @Environment(AppModel.self) private var model
    @State private var completingTaskIDs: Set<TaskMirror.ID> = []

    private let horizonHours = 12

    private struct TimelineEntry: Identifiable {
        let id: String
        let timestamp: Date
        let timeLabel: String
        let title: String
        let subtitle: String
        let color: Color
        let symbol: String
        let task: TaskMirror?
    }

    private enum TaskCategory {
        case overdue
        case dueToday
        case dueTomorrow
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Day timeline")
                    .hcbFont(.headline)
                Spacer()
                Text("Next \(horizonHours)h")
                    .hcbFont(.caption, weight: .medium)
                    .foregroundStyle(.secondary)
            }

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if timelineEntries.isEmpty {
                        Text("No events or due tasks in the next \(horizonHours) hours.")
                            .hcbFont(.footnote)
                            .foregroundStyle(.secondary)
                            .hcbScaledPadding(.vertical, 8)
                    } else {
                        ForEach(timelineEntries) { entry in
                            timelineRow(entry)
                        }
                    }
                }
                .hcbScaledPadding(.top, 2)
            }
            .hcbScaledFrame(maxHeight: 210)

            Divider()
            MenuBarQuickAddRow()
            Divider()
            MenuBarQuickActions()
        }
        .hcbScaledPadding(14)
        .hcbScaledFrame(width: 348)
    }

    @ViewBuilder
    private func timelineRow(_ entry: TimelineEntry) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(spacing: 3) {
                Text(entry.timeLabel)
                    .font(.caption2.monospacedDigit().weight(.semibold))
                    .foregroundStyle(.secondary)
                    .hcbScaledFrame(width: 42, alignment: .leading)
                Circle()
                    .fill(entry.color)
                    .hcbScaledFrame(width: 6, height: 6)
                    .hcbScaledFrame(width: 42, alignment: .leading)
            }

            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Image(systemName: entry.symbol)
                        .hcbFont(.caption2)
                        .foregroundStyle(entry.color)
                    Text(entry.title)
                        .hcbFont(.subheadline, weight: .semibold)
                        .lineLimit(1)
                }
                Text(entry.subtitle)
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if let task = entry.task {
                Button {
                    complete(task)
                } label: {
                    if completingTaskIDs.contains(task.id) {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "checkmark.circle")
                            .foregroundStyle(AppColor.ember)
                    }
                }
                .buttonStyle(.plain)
                .disabled(completingTaskIDs.contains(task.id))
            }
        }
        .hcbScaledPadding(.horizontal, 8)
        .hcbScaledPadding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(entry.color.opacity(0.10))
        )
    }

    private var timelineEntries: [TimelineEntry] {
        let calendar = Calendar.current
        let now = Date()
        let windowEnd = calendar.date(byAdding: .hour, value: horizonHours, to: now) ?? now
        let selectedCalendars = model.menuBarSelectedCalendarIDs
        let visibleTaskLists = model.menuBarVisibleTaskListIDs
        let taskListTitles = Dictionary(uniqueKeysWithValues: model.taskLists.map { ($0.id, $0.title) })
        let calendarTitles = Dictionary(uniqueKeysWithValues: model.calendars.map { ($0.id, $0.summary) })

        let eventEntries = model.events
            .filter { event in
                selectedCalendars.contains(event.calendarID)
                    && event.status != .cancelled
                    && event.endDate > now
                    && event.startDate < windowEnd
            }
            .sorted { $0.startDate < $1.startDate }
            .map { event in
                let shownStart = max(event.startDate, now)
                let subtitle: String
                if event.isAllDay {
                    subtitle = "All day · \(calendarTitles[event.calendarID] ?? "Calendar")"
                } else {
                    subtitle = "\(event.startDate.formatted(date: .omitted, time: .shortened))–\(event.endDate.formatted(date: .omitted, time: .shortened)) · \(calendarTitles[event.calendarID] ?? "Calendar")"
                }
                return TimelineEntry(
                    id: "event-\(event.id)",
                    timestamp: shownStart,
                    timeLabel: event.isAllDay ? "ALL" : shownStart.formatted(date: .omitted, time: .shortened),
                    title: event.summary,
                    subtitle: subtitle,
                    color: Color(hex: model.calendars.first(where: { $0.id == event.calendarID })?.colorHex ?? "#4A90E2"),
                    symbol: event.isAllDay ? "sun.max" : "calendar",
                    task: nil
                )
            }

        let startOfToday = calendar.startOfDay(for: now)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: startOfToday) ?? startOfToday
        let tomorrowPlusOne = calendar.date(byAdding: .day, value: 1, to: tomorrow) ?? tomorrow

        let taskPool = model.tasks
            .filter { task in
                guard task.isDeleted == false, task.isCompleted == false, task.dueDate != nil else { return false }
                return visibleTaskLists.contains(task.taskListID)
            }

        let overdueTasks = taskPool
            .filter { ($0.dueDate ?? .distantFuture) < startOfToday }
            .sorted { ($0.dueDate ?? .distantPast) > ($1.dueDate ?? .distantPast) }
            .prefix(2)

        let dueTodayTasks = taskPool
            .filter { task in
                guard let dueDate = task.dueDate else { return false }
                return calendar.isDate(dueDate, inSameDayAs: now)
            }
            .sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
            .prefix(4)

        let includeTomorrow = tomorrow < windowEnd
        let dueTomorrowTasks = taskPool
            .filter { task in
                guard includeTomorrow, let dueDate = task.dueDate else { return false }
                return dueDate >= tomorrow && dueDate < tomorrowPlusOne
            }
            .sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
            .prefix(2)

        let taskEntries = Array(overdueTasks) + Array(dueTodayTasks) + Array(dueTomorrowTasks)
        let dueTaskEntries = taskEntries.compactMap { task -> TimelineEntry? in
            guard let dueDate = task.dueDate else { return nil }
            guard let category = taskCategory(for: dueDate, now: now) else { return nil }
            let listTitle = taskListTitles[task.taskListID] ?? "Tasks"
            let anchor = anchorDate(for: category, now: now, dueDate: dueDate, windowEnd: windowEnd)
            let subtitle: String
            switch category {
            case .overdue:
                subtitle = "Overdue · \(listTitle)"
            case .dueToday:
                subtitle = "Due today · \(listTitle)"
            case .dueTomorrow:
                subtitle = "Due tomorrow · \(listTitle)"
            }
            return TimelineEntry(
                id: "task-\(task.id)",
                timestamp: anchor,
                timeLabel: category == .overdue ? "NOW" : anchor.formatted(date: .omitted, time: .shortened),
                title: task.title,
                subtitle: subtitle,
                color: AppColor.ember,
                symbol: "checklist",
                task: task
            )
        }

        return (eventEntries + dueTaskEntries)
            .sorted { lhs, rhs in
                if lhs.timestamp == rhs.timestamp {
                    return lhs.title < rhs.title
                }
                return lhs.timestamp < rhs.timestamp
            }
            .prefix(9)
            .map { $0 }
    }

    private func taskCategory(for dueDate: Date, now: Date) -> TaskCategory? {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: now)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: startOfToday) ?? startOfToday
        let tomorrowPlusOne = calendar.date(byAdding: .day, value: 1, to: tomorrow) ?? tomorrow

        if dueDate < startOfToday {
            return .overdue
        }
        if calendar.isDate(dueDate, inSameDayAs: now) {
            return .dueToday
        }
        if dueDate >= tomorrow && dueDate < tomorrowPlusOne {
            return .dueTomorrow
        }
        return nil
    }

    private func anchorDate(for category: TaskCategory, now: Date, dueDate: Date, windowEnd: Date) -> Date {
        let calendar = Calendar.current
        let minimum = now.addingTimeInterval(5 * 60)
        let maximum = windowEnd.addingTimeInterval(-5 * 60)

        let candidate: Date
        switch category {
        case .overdue:
            candidate = now.addingTimeInterval(10 * 60)
        case .dueToday:
            let todayAtFive = calendar.date(bySettingHour: 17, minute: 0, second: 0, of: now) ?? now
            candidate = max(todayAtFive, now.addingTimeInterval(15 * 60))
        case .dueTomorrow:
            candidate = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: dueDate) ?? dueDate
        }

        return min(max(candidate, minimum), maximum)
    }

    private func complete(_ task: TaskMirror) {
        guard completingTaskIDs.contains(task.id) == false else { return }
        completingTaskIDs.insert(task.id)
        Task {
            _ = await model.setTaskCompleted(true, task: task)
            _ = await MainActor.run {
                completingTaskIDs.remove(task.id)
            }
        }
    }
}

private struct MinimalBadgeMenuBarPanel: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline) {
                Text("Hot Cross Buns")
                    .hcbFont(.headline)
                Spacer()
                Text(model.syncState.title)
                    .hcbFont(.caption, weight: .medium)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 6) {
                MetricChip(label: "Due", count: model.todaySnapshot.dueTasks.count, color: AppColor.ember)
                MetricChip(label: "Overdue", count: model.todaySnapshot.overdueCount, color: AppColor.ember)
                MetricChip(label: "Events", count: model.todaySnapshot.scheduledEvents.count, color: AppColor.blue)
            }

            if let lastSync = model.lastSuccessfulSyncAt {
                Text("Last sync \(lastSync.formatted(date: .omitted, time: .shortened))")
                    .hcbFont(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                Text("Last sync never")
                    .hcbFont(.caption2)
                    .foregroundStyle(.secondary)
            }

            MenuBarQuickAddRow()

            HStack(spacing: 6) {
                Button {
                    bringAppToFront()
                } label: {
                    Label("Open", systemImage: "arrow.up.right.square")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                Button {
                    Task { await model.refreshNow() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(model.account == nil)

                Button {
                    NSApp.terminate(nil)
                } label: {
                    Label("Quit", systemImage: "power")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
        .hcbScaledPadding(12)
        .hcbScaledFrame(width: 276)
    }

    private func bringAppToFront() {
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.canBecomeMain }) {
            window.makeKeyAndOrderFront(nil)
        }
    }
}

private struct MetricChip: View {
    let label: String
    let count: Int
    let color: Color

    var body: some View {
        HStack(spacing: 4) {
            Text(label)
                .hcbFont(.caption2, weight: .semibold)
            Text("\(count)")
                .font(.caption2.monospacedDigit().weight(.semibold))
        }
        .hcbScaledPadding(.horizontal, 7)
        .hcbScaledPadding(.vertical, 4)
        .foregroundStyle(count == 0 ? .secondary : color)
        .background(
            Capsule(style: .continuous)
                .fill(
                    count == 0
                        ? AnyShapeStyle(Color.secondary.opacity(0.16))
                        : AnyShapeStyle(color.opacity(0.14))
                )
        )
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
                TextField("Add a task — tmr 9am #work", text: $input)
                    .textFieldStyle(.plain)
                    .hcbFont(.subheadline)
                    .onSubmit { Task { await submit() } }
                if isSubmitting {
                    ProgressView().controlSize(.small)
                }
            }
            .hcbScaledPadding(.horizontal, 8)
            .hcbScaledPadding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(.quaternary.opacity(0.5))
            )
            if let errorMessage {
                Text(errorMessage)
                    .hcbFont(.caption2)
                    .foregroundStyle(AppColor.ember)
            } else if model.account == nil {
                Text("Connect Google in Settings before adding tasks.")
                    .hcbFont(.caption2)
                    .foregroundStyle(.secondary)
            } else if model.taskLists.isEmpty {
                Text("Refresh to load your task lists.")
                    .hcbFont(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
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
        .hcbFont(.callout)
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

private struct WeeklyMenuBarPanel: View {
    @Environment(AppModel.self) private var model

    private var days: [Date] {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        return (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: today) }
    }

    private func eventsOn(_ day: Date) -> [CalendarEventMirror] {
        let cal = Calendar.current
        let selected = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        return model.events.filter { event in
            selected.contains(event.calendarID)
                && event.status != .cancelled
                && cal.isDate(event.startDate, inSameDayAs: day)
        }
    }

    private func tasksOn(_ day: Date) -> [TaskMirror] {
        let cal = Calendar.current
        let visible: Set<TaskListMirror.ID> = model.settings.hasConfiguredTaskListSelection
            ? model.settings.selectedTaskListIDs
            : Set(model.taskLists.map(\.id))
        return model.tasks.filter { task in
            guard let due = task.dueDate else { return false }
            return task.isDeleted == false
                && task.isCompleted == false
                && visible.contains(task.taskListID)
                && cal.isDate(due, inSameDayAs: day)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Next 7 days")
                    .hcbFont(.headline)
                Spacer()
                Text(model.syncState.title)
                    .hcbFont(.caption, weight: .medium)
                    .foregroundStyle(.secondary)
            }
            Divider()
            VStack(spacing: 6) {
                ForEach(days, id: \.self) { day in
                    dayRow(day)
                }
            }
            Divider()
            MenuBarQuickAddRow()
            Divider()
            MenuBarQuickActions()
        }
        .hcbScaledPadding(14)
        .hcbScaledFrame(width: 320)
    }

    private func dayRow(_ day: Date) -> some View {
        let events = eventsOn(day)
        let tasks = tasksOn(day)
        let cal = Calendar.current
        let isToday = cal.isDateInToday(day)
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                Text(day.formatted(.dateTime.weekday(.abbreviated)))
                    .hcbFont(.caption2, weight: .semibold)
                    .foregroundStyle(isToday ? AppColor.ember : .secondary)
                Text("\(cal.component(.day, from: day))")
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(isToday ? AppColor.ember : AppColor.ink)
            }
            .hcbScaledFrame(width: 38)
            Divider().hcbScaledFrame(height: 28)
            HStack(spacing: 6) {
                countChip(symbol: "calendar", count: events.count, color: AppColor.blue)
                countChip(symbol: "checkmark.circle", count: tasks.count, color: AppColor.ember)
            }
            Spacer(minLength: 0)
            if let first = events.first {
                Text(first.isAllDay ? "All day" : first.startDate.formatted(.dateTime.hour().minute()))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .hcbScaledPadding(.vertical, 4)
        .hcbScaledPadding(.horizontal, 6)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(isToday ? AppColor.ember.opacity(0.08) : Color.clear)
        )
    }

    private func countChip(symbol: String, count: Int, color: Color) -> some View {
        HStack(spacing: 3) {
            Image(systemName: symbol)
                .hcbFont(.caption2)
            Text("\(count)")
                .font(.caption2.monospacedDigit())
        }
        .foregroundStyle(count == 0 ? .secondary : color)
    }
}
