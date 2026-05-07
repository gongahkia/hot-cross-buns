// SwiftUI app entry. Initialises the cache root through the Rust
// runtime, then hands control to ContentView. Window state restoration
// uses macOS's `NSWindow.frameAutosaveName` via SwiftUI's
// `commands { ... }` chain rather than a hand-rolled windows.json so
// we get free Mission Control / Stage Manager integration.
// Startup flow: cache init -> settings load -> main window with sidebar
// and editor.

import AppKit
import CoreSpotlight
import OSLog
import SwiftUI

private let appSessionDriveRefreshLogger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "MelonPan",
    category: "DriveRefresh"
)

@main
struct MelonPanApp: App {
    @Environment(\.openWindow) private var openWindow
    @StateObject private var session = AppSession()
    @StateObject private var statusCenter = AppStatusCenter.shared
    @StateObject private var palette = CommandPalettePanelController()
    // NSApplicationDelegate adapter so we can wire the
    // UNUserNotificationCenter delegate (otherwise notifications
    // posted while the app is foreground get suppressed by
    // default).
    @NSApplicationDelegateAdaptor(NotificationsDelegate.self)
    private var appDelegate

    init() {
        RuntimeBridge.errorReporter = AppStatusCenter.postFromBridge
        RuntimeBridge.installSyncErrorCallback { documentId, message in
            Task { @MainActor in
                AppStatusCenter.shared.postSyncError(
                    documentId: documentId,
                    message: message
                )
            }
        }
    }

    var body: some Scene {
        WindowGroup("Melon Pan", id: "main") {
            RootContentView()
                .environmentObject(session)
                .environmentObject(statusCenter)
                .melonPanThemed(settings: session.settings)
                .onAppear {
                    AppShortcutMonitor.shared.install(
                        session: session,
                        openPalette: {
                            openCommandPalette()
                        }
                    )
                    HelpShortcutMonitor.shared.install {
                        openWindow(id: "help")
                    }
                    statusCenter.openDiagnostics = {
                        openWindow(id: "diagnostics")
                    }
                    statusCenter.openConflicts = {
                        openWindow(id: "conflicts")
                    }
                    statusCenter.retryBootstrap = {
                        session.bootstrap()
                    }
                    session.bootstrap()
                }
                .onOpenURL { url in
                    DeepLinkRouter.handle(url, session: session)
                }
                .onContinueUserActivity(CSSearchableItemActionType) { activity in
                    SpotlightDelegate.handle(activity, session: session)
                }
                .onChange(of: session.paletteVisible) { visible in
                    if visible {
                        palette.present(session: session)
                    } else {
                        palette.close()
                    }
                }
        }
        .windowStyle(.titleBar)
        .commands {
            CommandGroup(replacing: .newItem) {
            }
            CommandGroup(after: .newItem) {
                Button("Command Palette") {
                    openCommandPalette()
                }
                .keyboardShortcut("p", modifiers: .command)

                Button("Close Tab") {
                    if let id = session.activeDocumentId {
                        session.closeTab(id)
                    }
                }
            }
            CommandMenu("Navigate") {
                Button("Home") {
                    session.activePane = .home
                }
                Button("Refresh Drive") {
                    session.refreshDriveTree()
                }
                .disabled(session.activeAccount == nil)
                Button("Graph") {
                    openWindow(id: "graph")
                }
                Button("Conflicts") {
                    openWindow(id: "conflicts")
                }
                Button("Diagnostics") {
                    openWindow(id: "diagnostics")
                }
                Button("Settings") {
                    MelonPanSettingsWindowController.shared.show(
                        session: session,
                        statusCenter: statusCenter
                    )
                }
            }
            CommandMenu("Document") {
                Button("Save") {
                    NSApp.sendAction(
                        #selector(MelonPanDocumentContentController.saveDocument(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("s", modifiers: .command)

                Button("Refresh from Google") {
                    NSApp.sendAction(
                        #selector(MelonPanDocumentContentController.refreshDocument(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("r", modifiers: .command)

                Divider()

                Button("Find and Replace") {
                    NSApp.sendAction(
                        #selector(MelonPanDocumentContentController.showFind(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("f", modifiers: .command)

                Divider()

                Button("Document Inspector") {
                    NSApp.sendAction(
                        #selector(MelonPanDocumentContentController.showDocumentInspector(_:)),
                        to: nil,
                        from: nil
                    )
                }
                Button("Outline Inspector") {
                    NSApp.sendAction(
                        #selector(MelonPanDocumentContentController.showOutlineInspector(_:)),
                        to: nil,
                        from: nil
                    )
                }
                Button("Comments Inspector") {
                    NSApp.sendAction(
                        #selector(MelonPanDocumentContentController.showCommentsInspector(_:)),
                        to: nil,
                        from: nil
                    )
                }
                Button("Segments Inspector") {
                    NSApp.sendAction(
                        #selector(MelonPanDocumentContentController.showSegmentsInspector(_:)),
                        to: nil,
                        from: nil
                    )
                }
                Button("Warnings Inspector") {
                    NSApp.sendAction(
                        #selector(MelonPanDocumentContentController.showWarningsInspector(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Divider()

                Button("Toggle Vim Mode") {
                    NSApp.sendAction(
                        #selector(MelonPanDocumentContentController.toggleVim(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Toggle Status Bar") {
                    NSApp.sendAction(
                        #selector(MelonPanDocumentContentController.toggleStatusBar(_:)),
                        to: nil,
                        from: nil
                    )
                }
            }
            CommandGroup(replacing: .appSettings) {
                Button("Settings...") {
                    MelonPanSettingsWindowController.shared.show(
                        session: session,
                        statusCenter: statusCenter
                    )
                }
                .keyboardShortcut(",", modifiers: .command)
            }
            CommandMenu("Format") {
                Button("Bold") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanToggleBold(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("b", modifiers: .command)

                Button("Italic") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanToggleItalic(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("i", modifiers: .command)

                Button("Underline") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanToggleUnderline(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("u", modifiers: .command)

                Button("Clear Formatting") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanClearFormatting(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("t", modifiers: [.command, .shift])

                Divider()

                Button("Show Fonts") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanShowFontPanel(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Times New Roman") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanSetFontFamilyTimes(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Increase Font Size") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanIncreaseFontSize(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("+", modifiers: .command)

                Button("Decrease Font Size") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanDecreaseFontSize(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("-", modifiers: .command)

                Button("Red Text") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanSetTextColorRed(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Choose Text Color...") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanChooseTextColor(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Yellow Highlight") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanSetTextBackgroundYellow(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Choose Highlight Color...") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanChooseTextBackgroundColor(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Clear Font and Colors") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanClearFontAndColors(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Divider()

                Button("Link") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanCreateLink(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("k", modifiers: .command)

                Button("Insert Image From URL") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanInsertInlineImage(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("g", modifiers: .command)

                Button("Delete Selected Image") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanDeleteInlineObject(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Divider()

                Button("Numbered List") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanToggleNumberedList(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("7", modifiers: [.command, .shift])

                Button("Bulleted List") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanToggleBulletedList(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("8", modifiers: [.command, .shift])

                Divider()

                Button("Align Left") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanAlignLeft(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("{", modifiers: [.command, .shift])

                Button("Align Center") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanAlignCenter(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("|", modifiers: [.command, .shift])

                Button("Align Right") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanAlignRight(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("}", modifiers: [.command, .shift])

                Button("Justify") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanAlignJustified(_:)),
                        to: nil,
                        from: nil
                    )
                }
                .keyboardShortcut("j", modifiers: [.command, .option])

                Divider()

                Button("Create Header") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanCreateHeader(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Delete Current Header") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanDeleteCurrentHeader(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Create Footer") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanCreateFooter(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Delete Current Footer") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanDeleteCurrentFooter(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Create Footnote") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanCreateFootnote(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Delete Current Footnote") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanDeleteCurrentFootnote(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Divider()

                Button("Insert 2 x 2 Table") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanInsertTable(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Insert Row Above") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanInsertTableRowAbove(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Insert Row Below") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanInsertTableRowBelow(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Delete Row") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanDeleteTableRow(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Insert Column Left") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanInsertTableColumnLeft(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Insert Column Right") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanInsertTableColumnRight(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Delete Column") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanDeleteTableColumn(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Set Cell Background") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanSetTableCellBackgroundYellow(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Choose Cell Background...") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanChooseTableCellBackgroundColor(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Clear Cell Background") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanClearTableCellBackground(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Thin Borders") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanSetTableCellBorderThin(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Menu("Thin Edge Border") {
                    Button("Top Border") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanSetTableCellTopBorderThin(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                    Button("Right Border") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanSetTableCellRightBorderThin(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                    Button("Bottom Border") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanSetTableCellBottomBorderThin(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                    Button("Left Border") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanSetTableCellLeftBorderThin(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                    Divider()
                    Button("Clear Top Border") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanClearTableCellTopBorder(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                    Button("Clear Right Border") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanClearTableCellRightBorder(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                    Button("Clear Bottom Border") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanClearTableCellBottomBorder(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                    Button("Clear Left Border") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanClearTableCellLeftBorder(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                }

                Button("Choose Border Color...") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanChooseTableCellBorderColor(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Menu("Border Style") {
                    Button("Solid") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanSetTableCellBorderSolid(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                    Button("Dotted") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanSetTableCellBorderDotted(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                    Button("Dashed") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanSetTableCellBorderDashed(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                }

                Button("Clear Borders") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanClearTableCellBorder(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Menu("Vertical Alignment") {
                    Button("Top") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanAlignTableCellTop(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                    Button("Middle") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanAlignTableCellMiddle(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                    Button("Bottom") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanAlignTableCellBottom(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                    Divider()
                    Button("Clear Vertical Alignment") {
                        NSApp.sendAction(
                            #selector(MelonPanTextView.melonPanClearTableCellVerticalAlignment(_:)),
                            to: nil,
                            from: nil
                        )
                    }
                }

                Button("Set Column Width...") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanSetTableColumnWidth(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Set Row Height...") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanSetTableRowHeight(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Increase Padding") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanIncreaseTableCellPadding(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Decrease Padding") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanDecreaseTableCellPadding(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Clear Padding") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanClearTableCellPadding(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Merge Selected Cells") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanMergeSelectedTableCells(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Unmerge Cell") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanUnmergeTableCell(_:)),
                        to: nil,
                        from: nil
                    )
                }

                Button("Delete Table") {
                    NSApp.sendAction(
                        #selector(MelonPanTextView.melonPanDeleteTable(_:)),
                        to: nil,
                        from: nil
                    )
                }
            }
            CommandGroup(after: .windowArrangement) {
                Button("Show History") {
                    session.showHistory(documentId: nil)
                    openWindow(id: "history")
                }
            }
            CommandGroup(replacing: .help) {
                Button("Open Diagnostics") {
                    openWindow(id: "diagnostics")
                }
                Button("Melon Pan Help") {
                    openWindow(id: "help")
                }
            }
        }

        Window("Graph", id: "graph") {
            GraphView()
                .environmentObject(session)
                .environmentObject(statusCenter)
                .melonPanThemed(settings: session.settings)
        }
        .defaultSize(width: 980, height: 680)
        .windowResizability(.contentMinSize)

        Window("Conflicts", id: "conflicts") {
            ConflictsPane()
                .environmentObject(session)
                .environmentObject(statusCenter)
                .melonPanThemed(settings: session.settings)
        }
        .defaultSize(width: 900, height: 620)
        .windowResizability(.contentMinSize)

        Window("Diagnostics", id: "diagnostics") {
            DiagnosticsPane()
                .environmentObject(session)
                .environmentObject(statusCenter)
                .melonPanThemed(settings: session.settings)
        }
        .defaultSize(width: 900, height: 680)
        .windowResizability(.contentMinSize)

        Window("Templates", id: "templates") {
            TemplatesPane()
                .environmentObject(session)
                .environmentObject(statusCenter)
                .melonPanThemed(settings: session.settings)
        }
        .defaultSize(width: 900, height: 620)
        .windowResizability(.contentMinSize)

        Window("Import", id: "import") {
            ImportPane()
                .environmentObject(session)
                .environmentObject(statusCenter)
                .melonPanThemed(settings: session.settings)
        }
        .defaultSize(width: 900, height: 620)
        .windowResizability(.contentMinSize)

        Window("Help", id: "help") {
            HelpWindow()
                .melonPanThemed(settings: session.settings)
        }
        .defaultSize(width: 860, height: 640)
        .windowResizability(.contentMinSize)

        Window("History", id: "history") {
            HistoryWindow(session: session)
                .environmentObject(session)
                .environmentObject(statusCenter)
                .melonPanThemed(settings: session.settings)
        }
        .defaultSize(width: 860, height: 560)
        .windowResizability(.contentMinSize)
    }

    private func openCommandPalette() {
        session.pendingPalettePrefill = ""
        if session.paletteVisible {
            palette.present(session: session)
        } else {
            session.paletteVisible = true
        }
    }
}

private struct MelonPanMenuBarMenu: View {
    @Environment(\.openWindow) private var openWindow
    @EnvironmentObject private var session: AppSession

    var body: some View {
        Button("Open Melon Pan") {
            showMainWindow()
        }

        Divider()

        Button("New Local Draft") {
            showMainWindow()
            session.newLocalDraft()
        }

        Button("Open Drive") {
            showMainWindow()
        }

        Button("Refresh Drive") {
            showMainWindow()
            session.refreshDriveTree()
        }
        .disabled(session.activeAccount == nil)

        Divider()

        if let account = session.activeAccount {
            Text(account)
        } else {
            Button("Sign In with Google") {
                showMainWindow()
                session.showSignInSheet = true
            }
        }

        Button("Diagnostics") {
            showMainWindow()
            session.openUtilityWindow(.diagnostics)
        }

        Button("Settings...") {
            showMainWindow()
            MelonPanSettingsWindowController.shared.show(
                session: session,
                statusCenter: AppStatusCenter.shared
            )
        }

        Divider()

        Button("Quit Melon Pan") {
            NSApp.terminate(nil)
        }
    }

    private func showMainWindow() {
        if !Self.activateExistingMainWindow() {
            openWindow(id: "main")
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    private static func activateExistingMainWindow() -> Bool {
        guard let window = NSApp.windows.first(where: { window in
            guard window.isVisible || window.isMiniaturized else { return false }
            return window.title == "Melon Pan"
        }) else {
            return false
        }
        if window.isMiniaturized {
            window.deminiaturize(nil)
        }
        window.makeKeyAndOrderFront(nil)
        return true
    }
}

private struct RootContentView: View {
    @EnvironmentObject private var session: AppSession

    var body: some View {
        if session.cacheRoot.isEmpty {
            ContentView()
        } else {
            OnboardingHost(
                cacheRoot: session.cacheRoot,
                onCacheRootChanged: { root in
                    session.cacheRoot = root
                },
                onFinished: {
                    session.onboardingCompleted = true
                }
            ) {
                ContentView()
            }
            .id(session.onboardingResetToken)
        }
    }
}

@MainActor
private final class AppShortcutMonitor {
    static let shared = AppShortcutMonitor()
    private var monitor: Any?
    private weak var session: AppSession?
    private var openPalette: (@MainActor () -> Void)?

    func install(session: AppSession, openPalette: @escaping @MainActor () -> Void) {
        self.session = session
        self.openPalette = openPalette
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            if self.handle(event) {
                return nil
            }
            return event
        }
    }

    private func handle(_ event: NSEvent) -> Bool {
        guard let session else { return false }
        let shortcuts = session.settings.mac.shortcuts
        let chord = Self.chord(from: event)
        guard chord == shortcuts.openPalette else { return false }
        openPalette?()
        return true
    }

    private static func chord(from event: NSEvent) -> String {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        var parts: [String] = []
        if flags.contains(.command) { parts.append("cmd") }
        if flags.contains(.shift) { parts.append("shift") }
        if flags.contains(.option) { parts.append("option") }
        if flags.contains(.control) { parts.append("control") }

        let key = keyName(event: event)
        guard !key.isEmpty else { return "" }
        parts.append(key)
        return parts.joined(separator: "+")
    }

    private static func keyName(event: NSEvent) -> String {
        switch event.keyCode {
        case 36:
            return "return"
        case 48:
            return "tab"
        case 49:
            return "space"
        case 51:
            return "delete"
        case 123:
            return "arrow-left"
        case 124:
            return "arrow-right"
        case 125:
            return "arrow-down"
        case 126:
            return "arrow-up"
        case 122:
            return "f1"
        case 120:
            return "f2"
        case 99:
            return "f3"
        case 118:
            return "f4"
        case 96:
            return "f5"
        case 97:
            return "f6"
        case 98:
            return "f7"
        case 100:
            return "f8"
        case 101:
            return "f9"
        case 109:
            return "f10"
        case 103:
            return "f11"
        case 111:
            return "f12"
        default:
            return (event.charactersIgnoringModifiers ?? "")
                .lowercased()
                .replacingOccurrences(of: " ", with: "space")
        }
    }
}

@MainActor
private final class HelpShortcutMonitor {
    static let shared = HelpShortcutMonitor()
    private var monitor: Any?

    func install(openHelp: @escaping @MainActor () -> Void) {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let isHelpShortcut = flags.contains([.command, .shift]) && event.charactersIgnoringModifiers == "/"
            if isHelpShortcut {
                Task { @MainActor in openHelp() }
                return nil
            }
            return event
        }
    }
}

/// Top-level app state. Threaded through the view tree via
/// `@EnvironmentObject` so any view can read the cache root, the
/// signed-in account, the active sidebar pane, and the open documents
/// without prop-drilling.
@MainActor
final class AppSession: ObservableObject {
    enum SyncKind {
        case push, pull, drain
    }

    struct ConflictReviewRequest: Identifiable, Equatable {
        let id = UUID()
        let documentId: String
    }

    enum Pane: String, CaseIterable, Identifiable, Sendable {
        case home, drive, graph, templates, conflicts, importer = "import", diagnostics, settings
        case history, help
        static let allCases: [Pane] = [.home, .drive, .graph, .conflicts, .diagnostics, .settings, .history, .help]
        var id: String { rawValue }
        init?(deepLinkName: String) { self.init(rawValue: deepLinkName) }
        var deepLinkName: String { rawValue }

        var label: String {
            switch self {
            case .home: return "Home"
            case .drive: return "Drive"
            case .graph: return "Graph"
            case .conflicts: return "Conflicts"
            case .diagnostics: return "Diagnostics"
            case .settings: return "Settings"
            case .templates: return "Templates"
            case .importer: return "Import"
            case .history: return "History"
            case .help: return "Help"
            }
        }
        var systemImage: String {
            switch self {
            case .home: return "house"
            case .drive: return "externaldrive"
            case .graph: return "point.3.connected.trianglepath.dotted"
            case .conflicts: return "exclamationmark.triangle"
            case .diagnostics: return "stethoscope"
            case .settings: return "gearshape"
            case .templates: return "doc.on.doc"
            case .importer: return "square.and.arrow.down"
            case .history: return "clock.arrow.circlepath"
            case .help: return "questionmark.circle"
            }
        }
    }

    @Published var cacheRoot: String = ""
    @Published var credentialsPath: String = ""
    @Published var activeAccount: String? = nil {
        didSet {
            if oldValue != nil && activeAccount == nil {
                Task { await SpotlightIndexer.shared.removeAll() }
            }
        }
    }
    @Published var activePane: Pane = .home
    @Published var openDocuments: [OpenDocument] = []
    /// The document.id (UUID) of the currently focused tab. nil means
    /// no document is focused — ContentView falls back to WelcomeView.
    @Published var activeDocumentId: UUID? = nil
    @Published var bootstrapError: String? = nil
    @Published var showSignInSheet = false
    @Published var showShortcutsHelp = false
    @Published var showMenuBarItem = false
    @Published var settings: AppSettings = .default
    @Published var pendingPalettePrefill: String? = nil
    @Published var paletteVisible = false
    @Published var pendingSettingsSection: String? = nil
    @Published var showOnboardingSheet = false
    @Published var onboardingCompleted = false
    @Published var onboardingResetToken = UUID()
    @Published var driveFocusFolderId: String? = nil
    @Published var driveRefreshing = false
    @Published var driveRefreshPhase: String? = nil
    @Published var driveTreeReloadToken = UUID()
    @Published var pendingUtilityWindow: Pane? = nil
    @Published var conflictReviewRequest: ConflictReviewRequest? = nil
    @Published var syncingQueuedDocuments = false
    @Published var statusBanner: String? = nil
    @Published var historyDocumentIdFilter: String? = nil
    @Published var historyRequestToken = UUID()
    @Published var spotlightIndexingEnabled: Bool =
        UserDefaults.standard.object(forKey: SpotlightIndexer.indexingEnabledKey) as? Bool ?? true {
        didSet {
            guard oldValue != spotlightIndexingEnabled else { return }
            UserDefaults.standard.set(
                spotlightIndexingEnabled,
                forKey: SpotlightIndexer.indexingEnabledKey
            )
            let cache = cacheRoot
            if spotlightIndexingEnabled {
                Task.detached {
                    await SpotlightIndexer.shared.reindexAll(cacheRoot: cache)
                }
            } else {
                Task { await SpotlightIndexer.shared.removeAll() }
            }
        }
    }
    private var spotlightUpdateTasks: [String: Task<Void, Never>] = [:]
    private var didBootstrap = false
    private var driveRefreshRunID: UUID? = nil
    private var driveRefreshTimeoutTask: Task<Void, Never>? = nil

    /// Returns the currently focused document, if any. Resolves
    /// activeDocumentId against openDocuments so a stale id (after a
    /// close) returns nil rather than crashing.
    var activeDocument: OpenDocument? {
        guard let activeDocumentId else { return nil }
        return openDocuments.first(where: { $0.id == activeDocumentId })
    }

    var configRoot: String {
        guard !credentialsPath.isEmpty else { return "" }
        return (credentialsPath as NSString).deletingLastPathComponent
    }

    /// Adds `document` to openDocuments (skipping when an entry with
    /// the same google document_id already exists) and selects it.
    /// The "Open" verb the rest of the shell uses.
    func openInTab(_ document: OpenDocument) {
        if let existing = openDocuments.first(where: {
            $0.documentId == document.documentId
        }) {
            // Refresh the existing tab's metadata (title, latest md)
            // and select it. Avoids opening duplicate tabs for the
            // same Drive doc id.
            if let index = openDocuments.firstIndex(where: { $0.id == existing.id }) {
                openDocuments[index].title = document.title
                openDocuments[index].plainText = document.plainText
                openDocuments[index].isLoading = document.isLoading
                openDocuments[index].loadingDetail = document.loadingDetail
                openDocuments[index].loadError = document.loadError
            }
            activeDocumentId = existing.id
            persistWindowsState()
            recordOpenHistory(document.documentId)
            return
        }
        openDocuments.append(document)
        activeDocumentId = document.id
        persistWindowsState()
        recordOpenHistory(document.documentId)
    }

    /// Removes the tab with the given UUID. Selects a sibling tab
    /// when the closed tab was active; falls back to nil when no
    /// docs remain (Welcome surface re-renders).
    func closeTab(_ id: UUID) {
        guard let index = openDocuments.firstIndex(where: { $0.id == id }) else {
            return
        }
        openDocuments.remove(at: index)
        if activeDocumentId == id {
            // Select the previous sibling, or the next if we just
            // closed the first one.
            if openDocuments.isEmpty {
                activeDocumentId = nil
            } else {
                let nextIndex = max(0, index - 1)
                activeDocumentId = openDocuments[nextIndex].id
            }
        }
        persistWindowsState()
    }

    /// Updates activeDocumentId and persists. Used by tab strip clicks.
    func selectTab(_ id: UUID) {
        activeDocumentId = id
        persistWindowsState()
    }

    /// Resolves platform paths and initialises the cache. Idempotent;
    /// safe to call multiple times.
    func bootstrap() {
        guard !didBootstrap else { return }
        didBootstrap = true
        let defaultCache = RuntimeBridge.defaultCacheRoot()
        let onboardingState = OnboardingStateStore.load(cacheRoot: defaultCache)
        let cache = onboardingState.cacheRootOverride ?? defaultCache
        let creds = RuntimeBridge.defaultCredentialsPath()
        cacheRoot = cache
        credentialsPath = creds
        onboardingCompleted = onboardingState.isComplete
        activeAccount = onboardingState.signedInAccount ?? activeAccount
        do {
            try RuntimeBridge.initializeCache(at: cache)
            settings = (try? RuntimeBridge.loadSettings(cacheRoot: cache)) ?? .default
            showMenuBarItem = settings.mac.showMenuBarItem
            bootstrapError = nil
            AppStatusCenter.shared.clear(dedupeKey: "bootstrap")
        } catch {
            let message = "Failed to initialise cache at \(cache): \(error)"
            bootstrapError = message
            AppStatusCenter.shared.post(StatusBanner(
                dedupeKey: "bootstrap",
                kind: .error,
                title: "Cache init failed",
                detail: message,
                primaryAction: BannerAction(label: "Retry") {
                    AppStatusCenter.shared.retryBootstrap?()
                },
                autoDismissAfter: nil,
                canDismiss: true
            ))
            return
        }
        // Restore tabs from windows.json. Skipped silently when no
        // entries exist or every cached doc has been wiped.
        restoreTabsFromDisk()
        Task.detached {
            await SpotlightIndexer.shared.reindexAll(cacheRoot: cache)
        }
        NetworkReachabilityWatcher.shared.start(center: AppStatusCenter.shared) { [weak self] in
            self?.postQueuedSyncBannerIfNeeded()
        }
        DriftWatcher.shared.start(cacheRoot: cache, center: AppStatusCenter.shared)
    }

    func resetOnboarding() {
        let defaultCache = RuntimeBridge.defaultCacheRoot()
        let savedState = OnboardingStateStore.load(cacheRoot: defaultCache)
        OnboardingStateStore.reset(cacheRoot: defaultCache)
        if let override = savedState.cacheRootOverride {
            OnboardingStateStore.reset(cacheRoot: override)
        }
        if !cacheRoot.isEmpty, cacheRoot != defaultCache {
            OnboardingStateStore.reset(cacheRoot: cacheRoot)
        }
        onboardingCompleted = false
        onboardingResetToken = UUID()
        activePane = .home
        showOnboardingSheet = false
    }

    /// Reads windows.json, rehydrates each entry from the local cache,
    /// and selects the previously active doc when its id matches.
    /// Documents missing from cache (e.g. user wiped ~/Library/Caches/
    /// MelonPan/docs/<id>/) are silently dropped — A2's contract:
    /// losing the open-tab list across a wipe is annoying, not fatal.
    private func restoreTabsFromDisk() {
        let state = WindowsStateStore.load()
        guard !state.openDocuments.isEmpty else { return }
        var rehydrated: [OpenDocument] = []
        for documentId in state.openDocuments {
            guard let info = RuntimeBridge.rehydrateDocument(
                cacheRoot: cacheRoot,
                documentId: documentId
            ) else {
                continue
            }
            rehydrated.append(OpenDocument(
                documentId: info.documentId,
                title: info.title,
                plainText: info.plainText
            ))
        }
        guard !rehydrated.isEmpty else { return }
        openDocuments = rehydrated
        if let activeDriveId = state.activeDocumentId,
           let match = openDocuments.first(where: {
               $0.documentId == activeDriveId
           })
        {
            activeDocumentId = match.id
        } else {
            activeDocumentId = openDocuments.first?.id
        }
        activePane = .home
    }

    /// Persists current openDocuments + active id to windows.json.
    /// Called from openInTab / closeTab and from the editor save flow
    /// when activeDocumentId changes.
    func persistWindowsState() {
        let activeDriveId = activeDocument?.documentId
        WindowsStateStore.save(WindowsState(
            openDocuments: openDocuments.map { $0.documentId },
            activeDocumentId: activeDriveId
        ))
    }

    func newLocalDraft(title: String? = nil, body: String? = nil) {
        let trimmedTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let draftTitle = (trimmedTitle?.isEmpty == false) ? trimmedTitle! : "Untitled"
        let draftBody: String
        if let body, !body.isEmpty {
            draftBody = body
        } else {
            draftBody = "# \(draftTitle)\n\nStart writing.\n"
        }
        let id = "draft-\(UInt64(Date().timeIntervalSince1970 * 1000))"
        openInTab(OpenDocument(
            documentId: id,
            title: draftTitle,
            plainText: draftBody
        ))
        activePane = .home
    }

    func openDocumentById(_ documentId: String) {
        if let existing = openDocuments.first(where: { $0.documentId == documentId }) {
            activeDocumentId = existing.id
            activePane = .home
            recordOpenHistory(documentId)
            if existing.loadError != nil {
                beginDocumentFetch(id: documentId, revision: nil)
            }
            return
        }
        if let info = RuntimeBridge.rehydrateDocument(
            cacheRoot: cacheRoot,
            documentId: documentId
        ) {
            openInTab(OpenDocument(
                documentId: info.documentId,
                title: info.title,
                plainText: info.plainText
            ))
            activePane = .home
            return
        }
        beginDocumentFetch(id: documentId, revision: nil)
    }

    func openHistoryEntry(_ entry: String) {
        let documentId = documentIdFromHistoryEntry(entry)
        activePane = .home
        if let cached = RuntimeBridge.rehydrateDocument(
            cacheRoot: cacheRoot,
            documentId: documentId
        ) {
            openInTab(OpenDocument(
                documentId: cached.documentId,
                title: cached.title,
                plainText: cached.plainText
            ))
        } else {
            beginDocumentFetch(id: documentId, revision: nil)
        }
    }

    func showHistory(documentId: String?) {
        historyDocumentIdFilter = documentId
        historyRequestToken = UUID()
    }

    func openUtilityWindow(_ pane: Pane) {
        if pane != .home && pane != .drive {
            activePane = pane
        }
        pendingUtilityWindow = pane
    }

    func requestConflictReview(documentId: String) {
        openDocumentById(documentId)
        activePane = .home
        conflictReviewRequest = ConflictReviewRequest(documentId: documentId)
    }

    func consumeConflictReview(_ request: ConflictReviewRequest) {
        guard conflictReviewRequest == request else { return }
        conflictReviewRequest = nil
    }

    func refreshOpenDocumentFromCache(documentId: String) {
        guard let index = openDocuments.firstIndex(where: { $0.documentId == documentId }),
              let cached = RuntimeBridge.rehydrateDocument(
                  cacheRoot: cacheRoot,
                  documentId: documentId
              )
        else {
            return
        }
        openDocuments[index].title = cached.title
        openDocuments[index].plainText = cached.plainText
    }

    private func recordOpenHistory(_ entry: String) {
        guard !configRoot.isEmpty else { return }
        try? RuntimeBridge.recordOpenHistory(configRoot: configRoot, entry: entry)
    }

    private func documentIdFromHistoryEntry(_ entry: String) -> String {
        guard let url = URL(string: entry),
              url.host?.contains("docs.google.com") == true
        else {
            return entry
        }
        let parts = url.pathComponents.filter { $0 != "/" }
        if let documentIndex = parts.firstIndex(of: "d"),
           parts.indices.contains(documentIndex + 1) {
            return parts[documentIndex + 1]
        }
        return entry
    }

    func beginDocumentFetch(id: String, title: String? = nil, revision: String?) {
        let displayTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let loadingTitle = (displayTitle?.isEmpty == false) ? displayTitle! : "Loading..."
        let placeholder = OpenDocument(
            documentId: id,
            title: loadingTitle,
            plainText: "",
            isLoading: true,
            loadingDetail: "Preparing to open from Google Drive..."
        )
        openInTab(placeholder)
        activePane = .home
        AppStatusCenter.shared.postSyncing(
            title: "Opening Google Doc",
            detail: loadingTitle,
            autoDismissAfter: nil
        )

        guard let account = activeAccount else {
            failPlaceholder(id: id, message: "Sign in first.")
            postStatusBanner("Could not open \(id).", kind: .warning)
            return
        }

        let credentials = credentialsPath
        let root = cacheRoot
        Task.detached(priority: .userInitiated) {
            do {
                await MainActor.run {
                    AppStatusCenter.shared.postSyncing(
                        title: "Opening Google Doc",
                        detail: "Getting a Google access token...",
                        autoDismissAfter: nil
                    )
                    self.updateLoadingDocument(
                        id: id,
                        detail: "Getting a Google access token..."
                    )
                }
                let token = try RuntimeBridge.ensureFreshAccessToken(
                    credentialsPath: credentials,
                    account: account,
                    leewaySeconds: 60
                )
                await MainActor.run {
                    AppStatusCenter.shared.postSyncing(
                        title: "Opening Google Doc",
                        detail: "Downloading rich Docs JSON...",
                        autoDismissAfter: nil
                    )
                    self.updateLoadingDocument(
                        id: id,
                        detail: "Downloading rich Docs JSON..."
                    )
                }
                let pull = try RuntimeBridge.pullDocument(
                    accessToken: token,
                    documentId: id,
                    cacheRoot: root
                )
                _ = try? RuntimeBridge.refreshComments(
                    accessToken: token,
                    documentId: id,
                    cacheRoot: root
                )
                await MainActor.run {
                    AppStatusCenter.shared.postSyncing(
                        title: "Opening Google Doc",
                        detail: "Updating local rich-doc cache...",
                        autoDismissAfter: nil
                    )
                    self.updateLoadingDocument(
                        id: id,
                        detail: "Updating local rich-doc cache..."
                    )
                }
                await SpotlightIndexer.shared.update(
                    documentId: pull.documentId,
                    cacheRoot: root
                )
                await MainActor.run {
                    self.replacePlaceholder(id: id, with: OpenDocument(
                        documentId: pull.documentId,
                        title: pull.title,
                        plainText: pull.plainText
                    ))
                    if let revision {
                        self.pinRevision(revision, for: id)
                    }
                    AppStatusCenter.shared.clear(dedupeKey: "sync")
                    AppStatusCenter.shared.clear(dedupeKey: "pull:\(id)")
                }
            } catch {
                await MainActor.run {
                    self.failPlaceholder(id: id, message: "Fetch failed: \(error)")
                    self.postStatusBanner("Could not open \(id).", kind: .error)
                    AppStatusCenter.shared.clear(dedupeKey: "sync")
                }
            }
        }
    }

    func updateLoadingDocument(id: String, detail: String) {
        guard let index = openDocuments.firstIndex(where: { $0.documentId == id }) else {
            return
        }
        openDocuments[index].isLoading = true
        openDocuments[index].loadingDetail = detail
    }

    func replacePlaceholder(id: String, with document: OpenDocument) {
        guard let index = openDocuments.firstIndex(where: { $0.documentId == id }) else {
            openInTab(document)
            return
        }
        openDocuments[index].title = document.title
        openDocuments[index].plainText = document.plainText
        openDocuments[index].isLoading = false
        openDocuments[index].loadingDetail = nil
        openDocuments[index].loadError = nil
        activeDocumentId = openDocuments[index].id
        persistWindowsState()
    }

    func failPlaceholder(id: String, message: String) {
        guard let index = openDocuments.firstIndex(where: { $0.documentId == id }) else {
            return
        }
        openDocuments[index].title = "Could not load"
        openDocuments[index].isLoading = false
        openDocuments[index].loadingDetail = nil
        openDocuments[index].loadError = message
        activeDocumentId = openDocuments[index].id
    }

    func pinRevision(_ revision: String, for documentId: String) {
        guard let index = openDocuments.firstIndex(where: { $0.documentId == documentId }) else {
            return
        }
        openDocuments[index].pinnedRevision = revision
    }

    func runRegisteredCommand(id: String) {
        switch id {
        case "push":
            runSync(.push)
        case "pull":
            runSync(.pull)
        case "drain":
            runSync(.drain)
        case "signin":
            showSignInSheet = true
        case "signout":
            setActiveAccount(nil)
        case "refresh-drive":
            refreshDriveTree()
        case "open-cache-folder":
            NSWorkspace.shared.activateFileViewerSelecting([
                URL(fileURLWithPath: cacheRoot)
            ])
        default:
            postStatusBanner("Unknown command.", kind: .warning)
        }
    }

    func postStatusBanner(_ message: String, kind: StatusBannerKind) {
        let truncated = String(message.prefix(240))
        statusBanner = truncated
        AppStatusCenter.shared.post(StatusBanner(
            dedupeKey: "deeplink:\(truncated)",
            kind: kind,
            title: truncated,
            autoDismissAfter: kind == .error ? nil : 5,
            canDismiss: true
        ))
    }

    func runSync(_ kind: SyncKind) {
        guard let account = activeAccount else {
            bootstrapError = "Sign in first."
            return
        }
        guard let doc = activeDocument else {
            bootstrapError = "No active document to sync."
            return
        }
        let creds = credentialsPath
        let root = cacheRoot
        let docId = doc.documentId
        Task.detached(priority: .userInitiated) {
            do {
                await MainActor.run {
                    AppStatusCenter.shared.postSyncing()
                }
                let token = try RuntimeBridge.ensureFreshAccessToken(
                    credentialsPath: creds,
                    account: account,
                    leewaySeconds: 60
                )
                switch kind {
                case .push:
                    _ = try RuntimeBridge.pushDocument(
                        accessToken: token,
                        documentId: docId,
                        cacheRoot: root
                    )
                case .pull:
                    _ = try RuntimeBridge.pullDocument(
                        accessToken: token,
                        documentId: docId,
                        cacheRoot: root
                    )
                    await SpotlightIndexer.shared.update(
                        documentId: docId,
                        cacheRoot: root
                    )
                case .drain:
                    _ = try RuntimeBridge.drainPending(
                        accessToken: token,
                        documentId: docId,
                        cacheRoot: root
                    )
                }
                await MainActor.run {
                    AppStatusCenter.shared.clear(dedupeKey: "sync")
                }
            } catch {
                await MainActor.run {
                    let message = UserFacingError.message(from: error)
                    self.bootstrapError = "Sync failed: \(message)"
                    AppStatusCenter.shared.clear(dedupeKey: "sync")
                }
            }
        }
    }

    func postQueuedSyncBannerIfNeeded() {
        guard activeAccount != nil, !cacheRoot.isEmpty else { return }
        let root = cacheRoot
        Task.detached(priority: .utility) {
            let ids = Self.findQueuedDocumentIds(cacheRoot: root)
            guard !ids.isEmpty else { return }
            await MainActor.run {
                AppStatusCenter.shared.postQueuedChangesAvailable(
                    count: ids.count,
                    syncAction: { [weak self] in
                        self?.syncQueuedDocuments(ids)
                    },
                    conflictsAction: { [weak self] in
                        self?.openUtilityWindow(.conflicts)
                    }
                )
            }
        }
    }

    func syncQueuedDocuments(_ documentIds: [String]? = nil) {
        guard let account = activeAccount else {
            AppStatusCenter.shared.post(StatusBanner(
                dedupeKey: "queued-sync-signin",
                kind: .warning,
                title: "Sign in first",
                detail: "Reconnect Google before syncing queued changes.",
                primaryAction: BannerAction(label: "Sign in") {
                    self.showSignInSheet = true
                },
                autoDismissAfter: nil,
                canDismiss: true
            ))
            return
        }
        guard !syncingQueuedDocuments else { return }
        syncingQueuedDocuments = true
        let credentials = credentialsPath
        let root = cacheRoot
        let ids = documentIds
        Task.detached(priority: .userInitiated) {
            var pushed = 0
            var drained = 0
            var failures: [(String, String)] = []
            do {
                let token = try RuntimeBridge.ensureFreshAccessToken(
                    credentialsPath: credentials,
                    account: account,
                    leewaySeconds: 60
                )
                let queuedIds = ids ?? Self.findQueuedDocumentIds(cacheRoot: root)
                await MainActor.run {
                    AppStatusCenter.shared.postSyncing(
                        title: "Syncing queued changes",
                        detail: "\(queuedIds.count) document(s)",
                        autoDismissAfter: nil
                    )
                }
                for documentId in queuedIds {
                    do {
                        if RuntimeBridge.hasPendingOps(
                            cacheRoot: root,
                            documentId: documentId
                        ) {
                            _ = try RuntimeBridge.pushDocument(
                                accessToken: token,
                                documentId: documentId,
                                cacheRoot: root
                            )
                            pushed += 1
                            await SpotlightIndexer.shared.update(
                                documentId: documentId,
                                cacheRoot: root
                            )
                        }
                        let pending = try? RuntimeBridge.docPendingSummary(
                            cacheRoot: root,
                            documentId: documentId
                        )
                        if let pending, !pending.pendingMutations.isEmpty {
                            let report = try RuntimeBridge.drainPending(
                                accessToken: token,
                                documentId: documentId,
                                cacheRoot: root
                            )
                            drained += Int(report.clearedPending)
                        }
                    } catch {
                        let message = UserFacingError.message(from: error)
                        failures.append((documentId, message))
                        if message.localizedCaseInsensitiveContains("revision") {
                            await MainActor.run {
                                AppStatusCenter.shared.postConflict(documentId: documentId)
                            }
                        }
                    }
                }
                await MainActor.run {
                    self.syncingQueuedDocuments = false
                    if failures.isEmpty {
                        AppStatusCenter.shared.post(StatusBanner(
                            dedupeKey: "queued-sync",
                            kind: .success,
                            title: "Queued changes synced",
                            detail: "\(pushed) pushed, \(drained) drained.",
                            autoDismissAfter: 5,
                            canDismiss: true
                        ))
                    } else {
                        let detail = failures
                            .prefix(3)
                            .map { "\($0.0): \($0.1)" }
                            .joined(separator: " · ")
                        AppStatusCenter.shared.post(StatusBanner(
                            dedupeKey: "queued-sync",
                            kind: .warning,
                            title: "Some queued changes need review",
                            detail: detail,
                            primaryAction: BannerAction(label: "Open Conflicts") {
                                self.openUtilityWindow(.conflicts)
                            },
                            secondaryAction: AppStatusCenter.shared.diagnosticsAction(),
                            autoDismissAfter: nil,
                            canDismiss: true
                        ))
                    }
                    for documentId in queuedIds {
                        self.refreshOpenDocumentFromCache(documentId: documentId)
                    }
                }
            } catch {
                await MainActor.run {
                    self.syncingQueuedDocuments = false
                    AppStatusCenter.shared.post(StatusBanner(
                        dedupeKey: "queued-sync",
                        kind: .error,
                        title: "Queued sync failed",
                        detail: "\(error)",
                        primaryAction: BannerAction(label: "Retry") {
                            self.syncQueuedDocuments(ids)
                        },
                        secondaryAction: AppStatusCenter.shared.diagnosticsAction(),
                        autoDismissAfter: nil,
                        canDismiss: true
                    ))
                }
            }
        }
    }

    private nonisolated static func findQueuedDocumentIds(cacheRoot: String) -> [String] {
        let ids = (try? RuntimeBridge.listCachedDocumentIds(cacheRoot: cacheRoot)) ?? []
        return ids.filter { documentId in
            if RuntimeBridge.hasPendingOps(cacheRoot: cacheRoot, documentId: documentId) {
                return true
            }
            let pending = try? RuntimeBridge.docPendingSummary(
                cacheRoot: cacheRoot,
                documentId: documentId
            )
            return pending.map { !$0.pendingMutations.isEmpty } ?? false
        }
    }

    func refreshDriveTree() {
        guard let account = activeAccount else {
            bootstrapError = "Sign in first."
            return
        }
        guard GoogleScopeSupport.canListDrive(RuntimeBridge.tokenMetadata(account: account)) else {
            bootstrapError = GoogleScopeSupport.missingDriveListScopeMessage
            AppStatusCenter.shared.post(StatusBanner(
                dedupeKey: "drive-refresh",
                kind: .warning,
                title: "Drive refresh needs sign-in",
                detail: GoogleScopeSupport.missingDriveListScopeMessage,
                primaryAction: BannerAction(label: "Sign in") {
                    self.showSignInSheet = true
                },
                autoDismissAfter: nil,
                canDismiss: true
            ))
            return
        }
        guard !driveRefreshing else {
            AppStatusCenter.shared.postSyncing(
                title: "Refreshing Drive",
                detail: driveRefreshPhase ?? "A Drive refresh is already running.",
                autoDismissAfter: nil
            )
            return
        }
        let refreshID = UUID()
        driveRefreshRunID = refreshID
        driveRefreshing = true
        driveRefreshPhase = "Preparing Drive refresh..."
        driveRefreshTimeoutTask?.cancel()
        driveRefreshTimeoutTask = Task {
            try? await Task.sleep(nanoseconds: DriveRefreshTimeout.nanoseconds)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard driveRefreshRunID == refreshID else { return }
                appSessionDriveRefreshLogger.error("Session Drive refresh timed out after \(DriveRefreshTimeout.seconds, privacy: .public)s")
                driveRefreshRunID = nil
                driveRefreshing = false
                driveRefreshPhase = nil
                AppStatusCenter.shared.clear(dedupeKey: "sync")
                AppStatusCenter.shared.post(StatusBanner(
                    dedupeKey: "drive-refresh",
                    kind: .warning,
                    title: "Drive refresh timed out",
                    detail: "Google Drive did not respond within \(DriveRefreshTimeout.seconds) seconds. The background request was abandoned by the UI; retry after checking your connection or Google API setup.",
                    primaryAction: BannerAction(label: "Retry") {
                        self.refreshDriveTree()
                    },
                    autoDismissAfter: nil,
                    canDismiss: true
                ))
            }
        }
        let creds = credentialsPath
        let root = cacheRoot
        Task.detached(priority: .userInitiated) {
            let startedAt = Date()
            appSessionDriveRefreshLogger.info("Session Drive refresh started; cacheRoot=\(root, privacy: .private)")
            do {
                await MainActor.run {
                    guard self.driveRefreshRunID == refreshID else { return }
                    self.driveRefreshPhase = "Getting a Google access token..."
                    AppStatusCenter.shared.postSyncing(
                        title: "Refreshing Drive",
                        detail: self.driveRefreshPhase,
                        autoDismissAfter: nil
                    )
                }
                let token = try RuntimeBridge.ensureFreshAccessToken(
                    credentialsPath: creds,
                    account: account,
                    leewaySeconds: 30
                )
                appSessionDriveRefreshLogger.info("Session Drive refresh token phase complete")
                await MainActor.run {
                    guard self.driveRefreshRunID == refreshID else { return }
                    self.driveRefreshPhase = "Loading Google Drive files..."
                    AppStatusCenter.shared.postSyncing(
                        title: "Refreshing Drive",
                        detail: self.driveRefreshPhase,
                        autoDismissAfter: nil
                    )
                }
                let count = try RuntimeBridge.refreshDriveTree(
                    accessToken: token,
                    parentId: nil,
                    cacheRoot: root
                )
                let elapsed = Date().timeIntervalSince(startedAt)
                appSessionDriveRefreshLogger.info("Session Drive refresh finished; itemCount=\(count, privacy: .public) elapsed=\(elapsed, privacy: .public)s")
                await MainActor.run {
                    guard self.driveRefreshRunID == refreshID else {
                        appSessionDriveRefreshLogger.info("Ignoring stale Session Drive refresh completion")
                        return
                    }
                    self.driveRefreshTimeoutTask?.cancel()
                    self.driveRefreshRunID = nil
                    self.driveRefreshing = false
                    self.driveRefreshPhase = nil
                    self.driveTreeReloadToken = UUID()
                    AppStatusCenter.shared.clear(dedupeKey: "sync")
                    if count == 0 {
                        AppStatusCenter.shared.post(StatusBanner(
                            dedupeKey: "drive-refresh",
                            kind: .warning,
                            title: "Drive returned no files",
                            detail: "Google returned zero Drive items for this account. Check that you signed in to the expected Google account and that Drive access is enabled for this OAuth client.",
                            autoDismissAfter: nil,
                            canDismiss: true
                        ))
                    } else {
                        AppStatusCenter.shared.clear(dedupeKey: "drive-refresh")
                    }
                }
            } catch {
                appSessionDriveRefreshLogger.error("Session Drive refresh failed: \(String(describing: error), privacy: .public)")
                await MainActor.run {
                    guard self.driveRefreshRunID == refreshID else {
                        appSessionDriveRefreshLogger.info("Ignoring stale Session Drive refresh failure")
                        return
                    }
                    self.driveRefreshTimeoutTask?.cancel()
                    self.driveRefreshRunID = nil
                    self.driveRefreshing = false
                    self.driveRefreshPhase = nil
                    let message = UserFacingError.message(from: error)
                    self.bootstrapError = "Drive refresh failed: \(message)"
                    AppStatusCenter.shared.clear(dedupeKey: "sync")
                    AppStatusCenter.shared.post(StatusBanner(
                        dedupeKey: "drive-refresh",
                        kind: .warning,
                        title: "Drive refresh failed",
                        detail: message,
                        autoDismissAfter: nil,
                        canDismiss: true
                    ))
                }
            }
        }
    }

    func setActiveAccount(_ account: String?) {
        activeAccount = account
        guard !cacheRoot.isEmpty else { return }
        var state = OnboardingStateStore.load(cacheRoot: cacheRoot)
        state.signedInAccount = account
        OnboardingStateStore.save(state, cacheRoot: cacheRoot)
    }

    func didSaveDocument(_ id: String) {
        let root = cacheRoot
        spotlightUpdateTasks[id]?.cancel()
        spotlightUpdateTasks[id] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard Task.isCancelled == false else { return }
            await SpotlightIndexer.shared.update(documentId: id, cacheRoot: root)
            await MainActor.run {
                self?.spotlightUpdateTasks[id] = nil
            }
        }
    }
}

struct OpenDocument: Identifiable, Hashable {
    let id = UUID()
    var documentId: String
    var title: String
    var plainText: String
    var isLoading = false
    var loadingDetail: String? = nil
    var loadError: String? = nil
    var pinnedRevision: String? = nil
}
