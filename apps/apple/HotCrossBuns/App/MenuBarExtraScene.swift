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
            case .minimalBadge: MinimalBadgeMenuBarPanel()
            case .compact: CompactMenuBarPanel()
            }
        }
        .id(model.settings.colorSchemeID)
        .withHCBAppearance(model.settings)
        .hcbSurface(.menuBar) // §6.11 per-surface font override
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
            MenuBarPinnedFilters()
            Divider()
            MenuBarQuickAddRow()
            Divider()
            MenuBarQuickActions()
        }
        .hcbScaledPadding(14)
        .hcbScaledFrame(width: 316)
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
    @State private var selectedDay = Calendar.current.startOfDay(for: Date())

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            DatePicker("", selection: $selectedDay, displayedComponents: [.date])
                .datePickerStyle(.graphical)
                .labelsHidden()
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
            }
        }
        .hcbScaledPadding(.horizontal, 8)
        .hcbScaledPadding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Color.secondary.opacity(row.isPlaceholder ? 0.10 : 0.14))
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

            VStack(spacing: 4) {
                LabeledContent("Due", value: "\(model.todaySnapshot.dueTasks.count)")
                LabeledContent("Overdue", value: "\(model.todaySnapshot.overdueCount)")
                LabeledContent("Events", value: "\(model.todaySnapshot.scheduledEvents.count)")
            }
            .hcbFont(.subheadline)

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

private struct MenuBarQuickAddRow: View {
    @Environment(AppModel.self) private var model
    @State private var input: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                TextField("Add a task — tmr 9am #work", text: $input)
                    .textFieldStyle(.roundedBorder)
                    .hcbFont(.subheadline)
                    .onSubmit { Task { await submit() } }
                if isSubmitting {
                    ProgressView().controlSize(.small)
                }
            }
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

private struct MenuBarPinnedFilters: View {
    @Environment(AppModel.self) private var model

    // Up to 3 matching tasks are shown inline per pinned filter — enough
    // to be useful at a glance without letting the popover grow unbounded.
    private let previewLimit = 3
    // Cap the whole popover too — 4 pinned filters max in the list.
    private let pinnedLimit = 4

    var body: some View {
        let filters = pinnedFilters
        if filters.isEmpty == false {
            VStack(alignment: .leading, spacing: 10) {
                Divider()
                Text("Pinned filters")
                    .hcbFont(.caption, weight: .semibold)
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(filters.prefix(pinnedLimit)) { f in
                        filterRow(for: f)
                    }
                }
            }
        }
    }

    private var pinnedFilters: [CustomFilterDefinition] {
        model.settings.customFilters.filter(\.pinnedToMenuBar)
    }

    private func matchingTasks(_ f: CustomFilterDefinition) -> [TaskMirror] {
        f.filter(
            model.tasks,
            now: Date(),
            calendar: .current,
            taskLists: model.taskLists
        )
    }

    @ViewBuilder
    private func filterRow(for f: CustomFilterDefinition) -> some View {
        let tasks = matchingTasks(f)
        Button {
            openFilter(f)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Image(systemName: f.systemImage)
                        .foregroundStyle(AppColor.ember)
                    Text(f.name)
                        .hcbFont(.subheadline, weight: .semibold)
                    Spacer()
                    Text("\(tasks.count)")
                        .hcbFont(.caption, weight: .semibold)
                        .foregroundStyle(.secondary)
                        .hcbScaledPadding(.horizontal, 6)
                        .hcbScaledPadding(.vertical, 1)
                        .background(Capsule().fill(.quaternary.opacity(0.5)))
                }
                if tasks.isEmpty {
                    Text("No matches")
                        .hcbFont(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(tasks.prefix(previewLimit)) { task in
                        HStack(spacing: 6) {
                            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                                .hcbFont(.caption)
                                .foregroundStyle(task.isCompleted ? AppColor.moss : AppColor.ember)
                            Text(TagExtractor.stripped(from: task.title))
                                .hcbFont(.caption)
                                .lineLimit(1)
                            Spacer()
                        }
                    }
                    if tasks.count > previewLimit {
                        Text("+\(tasks.count - previewLimit) more")
                            .hcbFont(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .hcbScaledPadding(.vertical, 4)
            .hcbScaledPadding(.horizontal, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(AppColor.cream.opacity(0.35))
            )
        }
        .buttonStyle(.plain)
    }

    private func openFilter(_ f: CustomFilterDefinition) {
        // Stage the filter key on the shared model, switch the main window
        // to the Store tab, and raise the app. StoreView consumes the key
        // on appear (see consumePendingStoreFilter).
        model.pendingStoreFilterKey = "custom:\(f.id.uuidString)"
        NotificationCenter.default.post(name: .hcbOpenStoreTab, object: nil)
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.canBecomeMain }) {
            window.makeKeyAndOrderFront(nil)
        }
    }
}

private struct MenuBarQuickActions: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button {
                bringAppToFront()
            } label: {
                Label("Open Hot Cross Buns", systemImage: "arrow.up.right.square")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.borderless)

            Button {
                Task { await model.refreshNow() }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.borderless)
            .disabled(model.account == nil)

            Button {
                NSApp.terminate(nil)
            } label: {
                Label("Quit", systemImage: "power")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.borderless)
        }
    }

    private func bringAppToFront() {
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.canBecomeMain }) {
            window.makeKeyAndOrderFront(nil)
        }
    }
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
