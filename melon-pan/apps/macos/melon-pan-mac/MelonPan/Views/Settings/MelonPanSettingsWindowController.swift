import AppKit
import SwiftUI

@MainActor
final class MelonPanSettingsWindowController: NSWindowController, NSToolbarDelegate {
    static let shared = MelonPanSettingsWindowController()

    private enum ToolbarID {
        static let toolbar = NSToolbar.Identifier("com.gongahkia.MelonPan.settingsToolbar")
    }

    private let selection = SettingsPaneSelection()
    private weak var session: AppSession?
    private weak var statusCenter: AppStatusCenter?

    private init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 760, height: 600),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Settings"
        window.minSize = NSSize(width: 680, height: 520)
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("MelonPanSettings")
        super.init(window: window)

        let toolbar = NSToolbar(identifier: ToolbarID.toolbar)
        toolbar.delegate = self
        toolbar.displayMode = .iconAndLabel
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar
        window.toolbarStyle = .preference
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func show(
        session: AppSession,
        statusCenter: AppStatusCenter,
        pane: MelonPanSettingsPane = .general
    ) {
        self.session = session
        self.statusCenter = statusCenter
        selection.pane = pane
        rebuildContent()
        selectToolbarItem(for: pane)
        window?.centerIfNeeded()
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func showPendingSection(session: AppSession, statusCenter: AppStatusCenter) {
        let pane = MelonPanSettingsPane(section: session.pendingSettingsSection)
        session.pendingSettingsSection = nil
        show(session: session, statusCenter: statusCenter, pane: pane)
    }

    private func rebuildContent() {
        guard let session, let statusCenter else { return }
        window?.contentViewController = NSHostingController(
            rootView: SettingsView(selection: selection)
                .environmentObject(session)
                .environmentObject(statusCenter)
                .melonPanThemed(settings: session.settings)
                .frame(width: 760, height: 600)
        )
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        MelonPanSettingsPane.allCases.map(toolbarIdentifier)
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    func toolbarSelectableItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    func toolbar(
        _ toolbar: NSToolbar,
        itemForItemIdentifier itemIdentifier: NSToolbarItem.Identifier,
        willBeInsertedIntoToolbar flag: Bool
    ) -> NSToolbarItem? {
        guard let pane = pane(for: itemIdentifier) else { return nil }
        let item = NSToolbarItem(itemIdentifier: itemIdentifier)
        item.label = pane.title
        item.paletteLabel = pane.title
        item.toolTip = pane.title
        item.image = NSImage(systemSymbolName: pane.systemImage, accessibilityDescription: pane.title)
        item.target = self
        item.action = #selector(selectPane(_:))
        return item
    }

    @objc private func selectPane(_ sender: NSToolbarItem) {
        guard let pane = pane(for: sender.itemIdentifier) else { return }
        selection.pane = pane
        selectToolbarItem(for: pane)
    }

    private func toolbarIdentifier(for pane: MelonPanSettingsPane) -> NSToolbarItem.Identifier {
        NSToolbarItem.Identifier("com.gongahkia.MelonPan.settings.\(pane.rawValue)")
    }

    private func pane(for identifier: NSToolbarItem.Identifier) -> MelonPanSettingsPane? {
        MelonPanSettingsPane.allCases.first { toolbarIdentifier(for: $0) == identifier }
    }

    private func selectToolbarItem(for pane: MelonPanSettingsPane) {
        window?.toolbar?.selectedItemIdentifier = toolbarIdentifier(for: pane)
    }
}

private extension NSWindow {
    func centerIfNeeded() {
        guard !isVisible else { return }
        center()
    }
}
