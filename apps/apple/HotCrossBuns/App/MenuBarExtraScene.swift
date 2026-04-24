import AppKit
import SwiftUI

extension View {
    func hcbMenuBarStatusController(_ controller: HCBMenuBarStatusController, model: AppModel) -> some View {
        background(HCBMenuBarStatusControllerHost(controller: controller, model: model))
    }
}

private struct HCBMenuBarStatusControllerHost: View {
    let controller: HCBMenuBarStatusController
    let model: AppModel

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
            .onAppear { controller.configure(model: model) }
            .onChange(of: model.settings.showMenuBarExtra) { _, _ in
                controller.configure(model: model)
            }
            .onChange(of: model.settings.menuBarStyle) { _, _ in
                controller.configure(model: model)
            }
            .onChange(of: model.settings.showMenuBarBadge) { _, _ in
                controller.refreshStatusItemImage()
            }
            .onChange(of: model.settings.colorSchemeID) { _, _ in
                controller.configure(model: model)
            }
            .onChange(of: model.todaySnapshot.overdueCount) { _, _ in
                controller.refreshStatusItemImage()
            }
            .onChange(of: model.dataRevision) { _, _ in
                controller.refreshContent()
            }
    }
}

@MainActor
final class HCBMenuBarStatusController: NSObject, NSWindowDelegate, NSMenuDelegate {
    private weak var model: AppModel?
    private var statusItem: NSStatusItem?
    private var panel: HCBMenuBarPanelWindow?
    private var hostingController: NSHostingController<AnyView>?
    private var isPinned = false

    func configure(model: AppModel) {
        self.model = model
        if model.settings.showMenuBarExtra {
            installStatusItemIfNeeded()
            refreshContent()
        } else {
            uninstallStatusItem()
        }
    }

    func refreshContent() {
        guard let model, statusItem != nil else { return }
        let root = AnyView(
            MenuBarExtraContent()
                .environment(model)
        )

        if let hostingController {
            hostingController.rootView = root
        } else {
            let hostingController = NSHostingController(rootView: root)
            hostingController.view.wantsLayer = true
            hostingController.view.layer?.backgroundColor = NSColor.clear.cgColor
            self.hostingController = hostingController
        }

        if panel?.isVisible == true {
            resizePanelToFitContent()
            positionPanel()
        }
    }

    private func installStatusItemIfNeeded() {
        guard statusItem == nil else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.autosaveName = "HotCrossBunsStatusItem"
        item.button?.target = self
        item.button?.action = #selector(statusItemClicked(_:))
        item.button?.sendAction(on: [.leftMouseDown, .rightMouseDown])
        item.button?.imagePosition = .imageOnly
        item.button?.imageScaling = .scaleProportionallyDown
        statusItem = item
        refreshStatusItemImage()
    }

    private func uninstallStatusItem() {
        hidePanel()
        if let statusItem {
            NSStatusBar.system.removeStatusItem(statusItem)
        }
        statusItem = nil
        hostingController = nil
    }

    func refreshStatusItemImage() {
        guard let model, let button = statusItem?.button else { return }
        let count = model.settings.showMenuBarBadge ? model.todaySnapshot.overdueCount : 0
        button.image = statusImage(badgeCount: count)
        if count > 0 {
            button.setAccessibilityLabel("Hot Cross Buns, \(count) overdue task\(count == 1 ? "" : "s")")
        } else {
            button.setAccessibilityLabel("Hot Cross Buns")
        }
    }

    private func statusImage(badgeCount: Int) -> NSImage? {
        guard let image = NSImage(named: "MenuBarIcon")
            ?? NSImage(systemSymbolName: "calendar", accessibilityDescription: "Hot Cross Buns")
        else { return nil }

        guard badgeCount > 0 else {
            let copy = image.copy() as? NSImage ?? image
            copy.isTemplate = true
            copy.size = NSSize(width: 18, height: 18)
            return copy
        }

        return image.hcbMenuBarBadgedImage(count: badgeCount)
    }

    @objc private func statusItemClicked(_ sender: Any?) {
        if NSApp.currentEvent?.type == .rightMouseDown {
            showContextMenu()
            return
        }

        if panel?.isVisible == true {
            hidePanel()
        } else {
            showPanel()
        }
    }

    private func showPanel() {
        guard statusItem?.button != nil else { return }
        refreshContent()
        guard let hostingView = hostingController?.view else { return }

        let panel = panel ?? HCBMenuBarPanelWindow()
        panel.delegate = self
        panel.setHostedView(hostingView)
        self.panel = panel

        resizePanelToFitContent()
        positionPanel()
        NSApp.unhideWithoutActivation()
        panel.makeKeyAndOrderFront(nil)
    }

    private func hidePanel() {
        panel?.orderOut(nil)
    }

    private func resizePanelToFitContent() {
        guard let panel, let hostingView = hostingController?.view else { return }
        hostingView.layoutSubtreeIfNeeded()
        var fitting = hostingView.fittingSize
        if fitting.width <= 1 { fitting.width = 320 }
        if fitting.height <= 1 { fitting.height = 360 }

        let screen = statusItemScreen()
        let maxHeight = max(240, screen.visibleFrame.height - 48)
        let contentSize = NSSize(
            width: min(max(fitting.width, 300), 420),
            height: min(max(fitting.height, 80), maxHeight)
        )
        panel.setContentBodySize(contentSize)
    }

    private func positionPanel() {
        guard let panel, let button = statusItem?.button, let buttonWindow = button.window else { return }
        var statusFrame = buttonWindow.convertToScreen(button.frame)
        let screen = statusItemScreen()

        statusFrame.origin.y = min(statusFrame.origin.y, screen.frame.maxY)
        panel.position(relativeTo: statusFrame, in: screen)
    }

    private func statusItemScreen() -> NSScreen {
        guard let button = statusItem?.button, let window = button.window else {
            return NSScreen.main ?? NSScreen.screens.first!
        }

        let frame = window.convertToScreen(button.frame)
        var testPoint = frame.origin
        testPoint.y -= 100
        return NSScreen.screens.first(where: { $0.frame.contains(testPoint) })
            ?? window.screen
            ?? NSScreen.main
            ?? NSScreen.screens.first
            ?? NSScreen.screens[0]
    }

    private func showContextMenu() {
        guard let button = statusItem?.button else { return }
        let menu = NSMenu()
        menu.delegate = self

        let openItem = menu.addItem(withTitle: "Open Hot Cross Buns", action: #selector(openMainWindow), keyEquivalent: "")
        openItem.target = self

        let settingsItem = menu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: "")
        settingsItem.target = self

        let refreshItem = menu.addItem(withTitle: "Refresh", action: #selector(refresh), keyEquivalent: "")
        refreshItem.target = self
        refreshItem.isEnabled = model?.account != nil

        menu.addItem(.separator())

        let pinItem = menu.addItem(withTitle: "Keep Panel Open", action: #selector(togglePin), keyEquivalent: "")
        pinItem.target = self
        pinItem.state = isPinned ? .on : .off

        menu.addItem(.separator())

        let quitItem = menu.addItem(withTitle: "Quit Hot Cross Buns", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        quitItem.target = NSApp

        if let event = NSApp.currentEvent {
            NSMenu.popUpContextMenu(menu, with: event, for: button)
        } else {
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.minY), in: button)
        }
    }

    @objc private func openMainWindow() {
        hidePanel()
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.canBecomeMain }) {
            window.makeKeyAndOrderFront(nil)
        }
    }

    @objc private func openSettings() {
        hidePanel()
        NSApp.activate(ignoringOtherApps: true)
        if NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil) == false {
            NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
        }
    }

    @objc private func refresh() {
        guard let model else { return }
        Task { await model.refreshNow() }
    }

    @objc private func togglePin() {
        isPinned.toggle()
    }

    func windowDidResignKey(_ notification: Notification) {
        guard isPinned == false else { return }
        hidePanel()
    }

    func windowDidResize(_ notification: Notification) {
        positionPanel()
    }

    func menuDidClose(_ menu: NSMenu) {
        statusItem?.menu = nil
    }
}

private extension NSImage {
    func hcbMenuBarBadgedImage(count: Int) -> NSImage {
        let displayCount = count > 99 ? "99+" : "\(count)"
        let canvasSize = NSSize(width: 22, height: 20)
        let iconRect = NSRect(x: 0, y: 1, width: 18, height: 18)
        let image = NSImage(size: canvasSize, flipped: false) { _ in
            NSColor.labelColor.setFill()
            if let cgImage = self.cgImage(forProposedRect: nil, context: nil, hints: nil),
               let context = NSGraphicsContext.current?.cgContext {
                context.saveGState()
                context.clip(to: iconRect, mask: cgImage)
                context.fill(iconRect)
                context.restoreGState()
            } else {
                self.draw(in: iconRect)
            }

            let font = NSFont.monospacedDigitSystemFont(ofSize: displayCount.count > 2 ? 7 : 8, weight: .bold)
            let attributes: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: NSColor.controlBackgroundColor
            ]
            let textSize = displayCount.size(withAttributes: attributes)
            let badgeHeight: CGFloat = 11
            let badgeWidth = max(badgeHeight, ceil(textSize.width) + 6)
            let badgeRect = NSRect(
                x: canvasSize.width - badgeWidth,
                y: 0,
                width: badgeWidth,
                height: badgeHeight
            )
            NSColor.labelColor.setFill()
            NSBezierPath(roundedRect: badgeRect, xRadius: badgeHeight / 2, yRadius: badgeHeight / 2).fill()

            let textRect = NSRect(
                x: badgeRect.midX - textSize.width / 2,
                y: badgeRect.midY - textSize.height / 2,
                width: textSize.width,
                height: textSize.height
            )
            displayCount.draw(in: textRect, withAttributes: attributes)
            return true
        }
        image.isTemplate = false
        image.size = canvasSize
        return image
    }
}

private final class HCBMenuBarPanelWindow: NSPanel {
    private let frameView = HCBMenuBarPanelFrameView()

    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 420),
            styleMask: [.nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true
        level = .mainMenu
        collectionBehavior = [.moveToActiveSpace, .transient]
        animationBehavior = .utilityWindow
        isMovableByWindowBackground = false
        super.contentView = frameView
    }

    override var canBecomeMain: Bool { false }
    override var canBecomeKey: Bool { true }

    func setHostedView(_ hostedView: NSView) {
        frameView.setHostedView(hostedView)
    }

    func setContentBodySize(_ contentSize: NSSize) {
        let frameSize = frameView.outerSize(for: contentSize)
        setFrame(NSRect(origin: frame.origin, size: frameSize), display: true)
    }

    func position(relativeTo statusFrame: NSRect, in screen: NSScreen) {
        let screenMaxX = screen.frame.maxX
        let margin: CGFloat = 10
        var x = round(statusFrame.midX - frame.width / 2)
        let y = statusFrame.minY - 2
        if x + frame.width + margin > screenMaxX {
            x = screenMaxX - frame.width - margin
        }
        x = max(screen.frame.minX + margin, x)

        setFrameTopLeftPoint(NSPoint(x: x, y: y))
        frameView.arrowMidX = statusFrame.midX - frame.minX
        frameView.needsDisplay = true
        invalidateShadow()
    }

    override func cancelOperation(_ sender: Any?) {
        orderOut(nil)
    }
}

private final class HCBMenuBarPanelFrameView: NSView {
    var arrowMidX: CGFloat = 0

    private let arrowHeight: CGFloat = 8
    private let cornerRadius: CGFloat = 10
    private let borderWidth: CGFloat = 1
    private let sideInset: CGFloat = 1
    private let bottomInset: CGFloat = 1
    private var topInset: CGFloat { arrowHeight + borderWidth + 3 }
    private weak var hostedView: NSView?

    func outerSize(for contentSize: NSSize) -> NSSize {
        NSSize(
            width: contentSize.width + sideInset * 2,
            height: contentSize.height + topInset + bottomInset
        )
    }

    func setHostedView(_ view: NSView) {
        guard hostedView !== view else { return }
        hostedView?.removeFromSuperview()
        hostedView = view
        view.translatesAutoresizingMaskIntoConstraints = false
        addSubview(view)
        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: leadingAnchor, constant: sideInset),
            view.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -sideInset),
            view.topAnchor.constraint(equalTo: topAnchor, constant: topInset),
            view.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -bottomInset)
        ])
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.clear.setFill()
        dirtyRect.fill()

        let bodyRect = NSRect(
            x: borderWidth,
            y: borderWidth,
            width: bounds.width - borderWidth * 2,
            height: bounds.height - arrowHeight - borderWidth * 2
        )

        let path = NSBezierPath(roundedRect: bodyRect, xRadius: cornerRadius, yRadius: cornerRadius)
        let clampedArrowMidX = min(max(arrowMidX, bodyRect.minX + cornerRadius + arrowHeight), bodyRect.maxX - cornerRadius - arrowHeight)
        let arrowBaseY = bodyRect.maxY - 1
        let arrow = NSBezierPath()
        arrow.move(to: NSPoint(x: clampedArrowMidX - arrowHeight, y: arrowBaseY))
        arrow.curve(
            to: NSPoint(x: clampedArrowMidX, y: arrowBaseY + arrowHeight),
            controlPoint1: NSPoint(x: clampedArrowMidX - 4, y: arrowBaseY),
            controlPoint2: NSPoint(x: clampedArrowMidX - 4, y: arrowBaseY + arrowHeight)
        )
        arrow.curve(
            to: NSPoint(x: clampedArrowMidX + arrowHeight, y: arrowBaseY),
            controlPoint1: NSPoint(x: clampedArrowMidX + 4, y: arrowBaseY + arrowHeight),
            controlPoint2: NSPoint(x: clampedArrowMidX + 4, y: arrowBaseY)
        )
        path.append(arrow)

        NSColor.windowBackgroundColor.withAlphaComponent(0.98).setFill()
        path.fill()
        NSColor.separatorColor.withAlphaComponent(0.65).setStroke()
        path.lineWidth = borderWidth
        path.stroke()
    }
}

struct MenuBarExtraContent: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            switch model.settings.menuBarStyle {
            case .detailed: DetailedMenuBarPanel()
            case .weekly: WeeklyMenuBarPanel()
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

private struct DetailedMenuBarPanel: View {
    @Environment(AppModel.self) private var model
    @State private var selectedDay = Calendar.current.startOfDay(for: Date())
    @State private var snoozeCustomTask: TaskMirror?
    @State private var pendingDeleteEvent: CalendarEventMirror?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MenuBarMonthCalendar(selectedDay: $selectedDay)
            Divider()
            selectedDayHeader
            agenda
            MenuBarQuickAddRow()
            Divider()
            MenuBarQuickActions()
        }
        .hcbScaledPadding(12)
        .hcbScaledFrame(width: 320)
        .sheet(item: $snoozeCustomTask) { task in
            SnoozePickerSheet(task: task) { newDate in
                Task { await snooze(task, to: newDate) }
            }
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
    }

    private var selectedDayHeader: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(selectedDay.formatted(.dateTime.weekday(.wide).month().day()))
                .hcbFont(.subheadline, weight: .semibold)
            Spacer()
            let eventCount = eventsForSelectedDay.count
            let taskCount = tasksForSelectedDay.count
            Text("\(eventCount) event\(eventCount == 1 ? "" : "s") · \(taskCount) task\(taskCount == 1 ? "" : "s")")
                .hcbFont(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    // Renders a focused list for just the selected day instead of a 14-day
    // horizon. The previous horizon-based agenda was silently empty in
    // practice because the ScrollView collapsed between DatePicker and
    // QuickAddRow — this tight per-day list fills predictably.
    private var agenda: some View {
        let events = eventsForSelectedDay
        let tasks = tasksForSelectedDay
        return Group {
            if events.isEmpty && tasks.isEmpty {
                Text("Nothing scheduled for this day.")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .hcbScaledPadding(.vertical, 6)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        ForEach(events, id: \.id) { event in
                            eventDayItemRow(event)
                        }
                        ForEach(tasks, id: \.id) { task in
                            taskDayItemRow(task)
                        }
                    }
                    .hcbScaledPadding(.top, 2)
                }
                .hcbScaledFrame(maxHeight: 200)
            }
        }
    }

    private func dayItemRow(title: String, subtitle: String, symbol: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: symbol)
                .hcbFont(.caption)
                .foregroundStyle(.secondary)
                .hcbScaledFrame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .hcbFont(.subheadline)
                    .lineLimit(1)
                Text(subtitle)
                    .hcbFont(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }

    private func taskDayItemRow(_ task: TaskMirror) -> some View {
        dayItemRow(
            title: task.title,
            subtitle: model.taskLists.first(where: { $0.id == task.taskListID })?.title ?? "Tasks",
            symbol: "checkmark.circle"
        )
        .contextMenu {
            TaskContextMenu(
                task: task,
                onOpen: { open(task) },
                onCustomSnooze: { snoozeCustomTask = task },
                onDelete: {
                    Task { _ = await model.deleteTask(task) }
                }
            )
        }
    }

    private func open(_ task: TaskMirror) {
        NSApp.activate(ignoringOtherApps: true)
        NotificationCenter.default.post(name: .hcbRevealTaskInStore, object: task.id)
    }

    private func eventDayItemRow(_ event: CalendarEventMirror) -> some View {
        dayItemRow(
            title: event.summary,
            subtitle: event.isAllDay
                ? "All day"
                : event.startDate.formatted(.dateTime.hour().minute()),
            symbol: "calendar"
        )
        .contextMenu {
            EventContextMenu(
                event: event,
                onOpen: { open(event) },
                onDelete: { pendingDeleteEvent = event }
            )
        }
    }

    private func open(_ event: CalendarEventMirror) {
        NSApp.activate(ignoringOtherApps: true)
        NotificationCenter.default.post(name: .hcbRevealEventInCalendar, object: event.id)
    }

    private var eventsForSelectedDay: [CalendarEventMirror] {
        let cal = Calendar.current
        let selected = model.menuBarSelectedCalendarIDs
        return model.events
            .filter { event in
                selected.contains(event.calendarID)
                    && event.status != .cancelled
                    && cal.isDate(event.startDate, inSameDayAs: selectedDay)
            }
            .sorted { $0.startDate < $1.startDate }
    }

    private var tasksForSelectedDay: [TaskMirror] {
        let cal = Calendar.current
        let visible = model.menuBarVisibleTaskListIDs
        return model.tasks
            .filter { task in
                guard let due = task.dueDate else { return false }
                return task.isDeleted == false
                    && task.isCompleted == false
                    && visible.contains(task.taskListID)
                    && cal.isDate(due, inSameDayAs: selectedDay)
            }
            .sorted { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) }
    }

    private func snooze(_ task: TaskMirror, to newDate: Date?) async {
        _ = await model.updateTask(task, title: task.title, notes: task.notes, dueDate: newDate)
    }

}

private struct CompactMenuBarPanel: View {
    @Environment(AppModel.self) private var model
    @State private var completingTaskIDs: Set<TaskMirror.ID> = []
    @State private var snoozeCustomTask: TaskMirror?

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

        // SF Symbol rendered in place of the NOW/NEXT/LATER text labels.
        // Reads faster + matches native macOS menu bar apps that prefer
        // glyphs for tight vertical columns.
        var laneSymbol: String {
            switch self {
            case .now: "bolt.fill"
            case .next: "arrow.forward"
            case .later: "clock"
            }
        }

        @MainActor
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
                Text("Compact")
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

            MenuBarQuickAddRow()
            Divider()
            MenuBarQuickActions()
        }
        .hcbScaledPadding(14)
        .hcbScaledFrame(width: 320)
        .sheet(item: $snoozeCustomTask) { task in
            SnoozePickerSheet(task: task) { newDate in
                Task { await snooze(task, to: newDate) }
            }
        }
    }

    @ViewBuilder
    private func laneRow(for row: LaneRow) -> some View {
        HStack(spacing: 8) {
            Image(systemName: row.lane.laneSymbol)
                .hcbFont(.subheadline, weight: .semibold)
                .foregroundStyle(.secondary)
                .hcbScaledFrame(width: 24, alignment: .center)
                .accessibilityLabel(row.lane.title)
                .help(row.lane.title)

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
                            .foregroundStyle(.tint)
                    }
                }
                .buttonStyle(.borderless)
                .disabled(completingTaskIDs.contains(task.id))
            }
        }
        .hcbScaledPadding(.horizontal, 4)
        .hcbScaledPadding(.vertical, 4)
        .contextMenu {
            if let task = row.task {
                TaskContextMenu(
                    task: task,
                    onOpen: { open(task) },
                    onCustomSnooze: { snoozeCustomTask = task },
                    onDelete: {
                        Task { _ = await model.deleteTask(task) }
                    }
                )
            }
        }
    }

    private func open(_ task: TaskMirror) {
        NSApp.activate(ignoringOtherApps: true)
        NotificationCenter.default.post(name: .hcbRevealTaskInStore, object: task.id)
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
            completingTaskIDs.remove(task.id)
        }
    }

    private func snooze(_ task: TaskMirror, to newDate: Date?) async {
        _ = await model.updateTask(task, title: task.title, notes: task.notes, dueDate: newDate)
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
            .contentShape(Rectangle())
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
    @Environment(\.openWindow) private var openWindow

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
                openWindow(id: "history")
            } label: {
                Label("History…", systemImage: "clock.arrow.circlepath")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.borderless)

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

private struct MenuBarMonthCalendar: View {
    @Binding var selectedDay: Date
    @State private var displayedMonth: Date = Calendar.current.startOfDay(for: Date())

    private let calendar = Calendar.current
    private let columns = Array(repeating: GridItem(.flexible(minimum: 28), spacing: 4), count: 7)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            weekdayHeader
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(monthDays, id: \.self) { day in
                    dayButton(day)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { displayedMonth = calendar.startOfMonth(for: selectedDay) }
        .onChange(of: selectedDay) { _, newValue in
            if calendar.isDate(newValue, equalTo: displayedMonth, toGranularity: .month) == false {
                displayedMonth = calendar.startOfMonth(for: newValue)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(displayedMonth.formatted(.dateTime.month(.wide).year()))
                .hcbFont(.headline)
                .lineLimit(1)
            Spacer(minLength: 0)
            Button {
                shiftMonth(by: -1)
            } label: {
                Image(systemName: "chevron.left")
                    .frame(width: 20, height: 20)
            }
            .help("Previous month")
            Button {
                let today = calendar.startOfDay(for: Date())
                selectedDay = today
                displayedMonth = calendar.startOfMonth(for: today)
            } label: {
                Image(systemName: "circle.fill")
                    .font(.system(size: 7, weight: .semibold))
                    .frame(width: 20, height: 20)
            }
            .help("Today")
            Button {
                shiftMonth(by: 1)
            } label: {
                Image(systemName: "chevron.right")
                    .frame(width: 20, height: 20)
            }
            .help("Next month")
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
    }

    private var weekdayHeader: some View {
        LazyVGrid(columns: columns, spacing: 4) {
            ForEach(weekdaySymbols, id: \.self) { symbol in
                Text(symbol)
                    .hcbFont(.caption, weight: .semibold)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var weekdaySymbols: [String] {
        let symbols = calendar.shortWeekdaySymbols
        let offset = max(calendar.firstWeekday - 1, 0)
        return Array(symbols[offset...]) + Array(symbols[..<offset])
    }

    private var monthDays: [Date] {
        let monthStart = calendar.startOfMonth(for: displayedMonth)
        let firstWeekdayOffset = (calendar.component(.weekday, from: monthStart) - calendar.firstWeekday + 7) % 7
        let gridStart = calendar.date(byAdding: .day, value: -firstWeekdayOffset, to: monthStart) ?? monthStart
        return (0..<42).compactMap { calendar.date(byAdding: .day, value: $0, to: gridStart) }
    }

    private func dayButton(_ day: Date) -> some View {
        let isDisplayedMonth = calendar.isDate(day, equalTo: displayedMonth, toGranularity: .month)
        let isSelected = calendar.isDate(day, inSameDayAs: selectedDay)
        let isToday = calendar.isDateInToday(day)

        return Button {
            selectedDay = calendar.startOfDay(for: day)
            displayedMonth = calendar.startOfMonth(for: day)
        } label: {
            Text("\(calendar.component(.day, from: day))")
                .font(.body.monospacedDigit().weight(isToday || isSelected ? .semibold : .regular))
                .foregroundStyle(dayForeground(isDisplayedMonth: isDisplayedMonth, isSelected: isSelected))
                .frame(maxWidth: .infinity, minHeight: 26)
                .background {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(isSelected ? AppColor.blue.opacity(0.95) : isToday ? AppColor.blue.opacity(0.18) : Color.clear)
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(day.formatted(.dateTime.weekday(.wide).month(.wide).day().year()))
    }

    private func dayForeground(isDisplayedMonth: Bool, isSelected: Bool) -> Color {
        if isSelected { return .white }
        return isDisplayedMonth ? AppColor.ink : .secondary.opacity(0.45)
    }

    private func shiftMonth(by value: Int) {
        displayedMonth = calendar.date(byAdding: .month, value: value, to: displayedMonth) ?? displayedMonth
    }
}

private extension Calendar {
    func startOfMonth(for date: Date) -> Date {
        self.date(from: dateComponents([.year, .month], from: date)) ?? startOfDay(for: date)
    }
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
            VStack(spacing: 6) {
                ForEach(days, id: \.self) { day in
                    dayRow(day)
                }
            }
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
        // Monochrome: weekday + day number use .primary / .secondary only.
        // Today is signalled via a bolder day-number weight, not color — in
        // line with native macOS menu bar apps.
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                Text(day.formatted(.dateTime.weekday(.abbreviated)))
                    .hcbFont(.caption2, weight: .semibold)
                    .foregroundStyle(.secondary)
                Text("\(cal.component(.day, from: day))")
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(isToday ? .primary : .secondary)
            }
            .hcbScaledFrame(width: 38)
            Divider().hcbScaledFrame(height: 28)
            HStack(spacing: 6) {
                countChip(symbol: "calendar", count: events.count)
                countChip(symbol: "checkmark.circle", count: tasks.count)
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
        // Subtle today highlight with system's neutral emphasis tint.
        .background(isToday ? Color.secondary.opacity(0.10) : Color.clear)
    }

    private func countChip(symbol: String, count: Int) -> some View {
        HStack(spacing: 3) {
            Image(systemName: symbol)
                .hcbFont(.caption2)
            Text("\(count)")
                .font(.caption2.monospacedDigit())
        }
        .foregroundStyle(count == 0 ? .tertiary : .secondary)
    }
}
