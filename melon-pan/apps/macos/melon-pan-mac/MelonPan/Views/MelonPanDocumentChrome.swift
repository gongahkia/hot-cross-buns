import AppKit
import SwiftUI

struct MelonPanDocumentWorkspace<Content: View, Inspector: View, StatusBar: View>: NSViewControllerRepresentable {
    @ObservedObject var model: EditorChromeModel
    let snapshot: EditorChromeSnapshot
    let content: Content
    let inspector: Inspector
    let statusBar: StatusBar

    init(
        model: EditorChromeModel,
        snapshot: EditorChromeSnapshot,
        @ViewBuilder content: () -> Content,
        @ViewBuilder inspector: () -> Inspector,
        @ViewBuilder statusBar: () -> StatusBar
    ) {
        self.model = model
        self.snapshot = snapshot
        self.content = content()
        self.inspector = inspector()
        self.statusBar = statusBar()
    }

    func makeNSViewController(context: Context) -> MelonPanDocumentContentController {
        MelonPanDocumentContentController(model: model)
    }

    func updateNSViewController(_ controller: MelonPanDocumentContentController, context: Context) {
        model.snapshot = snapshot
        controller.model = model
        controller.update(
            content: AnyView(content),
            inspector: AnyView(inspector),
            statusBar: AnyView(statusBar),
            showsInspector: model.inspectorPane != nil,
            showsStatusBar: model.showsStatusBar,
            snapshot: snapshot
        )
    }
}

@MainActor
final class MelonPanDocumentContentController: NSViewController, NSToolbarDelegate, NSUserInterfaceValidations {
    private enum ToolbarID {
        static let toolbar = NSToolbar.Identifier("com.gongahkia.MelonPan.documentToolbar")
        static let save = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.save")
        static let refresh = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.refresh")
        static let focus = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.focus")
        static let format = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.format")
        static let insert = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.insert")
        static let find = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.find")
        static let document = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.document")
        static let outline = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.outline")
        static let comments = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.comments")
        static let segments = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.segments")
        static let warnings = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.warnings")
        static let vim = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.vim")
        static let zoom = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.zoom")
        static let mode = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.mode")
        static let status = NSToolbarItem.Identifier("com.gongahkia.MelonPan.toolbar.status")
    }

    var model: EditorChromeModel

    private let splitViewController = NSSplitViewController()
    private let mainHost = NSHostingController(rootView: AnyView(EmptyView()))
    private let inspectorHost = NSHostingController(rootView: AnyView(EmptyView()))
    private let statusHost = NSHostingController(rootView: AnyView(EmptyView()))
    private var statusHeightConstraint: NSLayoutConstraint?
    private var installedToolbar: NSToolbar?
    private var snapshot = EditorChromeSnapshot()
    private var toolbarButtons: [NSToolbarItem.Identifier: NSButton] = [:]
    private weak var modePopUp: NSPopUpButton?
    private weak var zoomPopUp: NSPopUpButton?

    init(model: EditorChromeModel) {
        self.model = model
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func loadView() {
        let root = NSView()

        addChild(splitViewController)
        addChild(statusHost)

        let splitView = splitViewController.view
        splitView.translatesAutoresizingMaskIntoConstraints = false
        let statusView = statusHost.view
        statusView.translatesAutoresizingMaskIntoConstraints = false

        root.addSubview(splitView)
        root.addSubview(statusView)

        statusHeightConstraint = statusView.heightAnchor.constraint(equalToConstant: 28)
        NSLayoutConstraint.activate([
            splitView.topAnchor.constraint(equalTo: root.topAnchor),
            splitView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            splitView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            splitView.bottomAnchor.constraint(equalTo: statusView.topAnchor),
            statusView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            statusView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            statusView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            statusHeightConstraint!
        ])

        splitViewController.splitView.isVertical = true
        splitViewController.splitView.dividerStyle = .thin
        splitViewController.splitView.autosaveName = NSSplitView.AutosaveName("MelonPanDocumentSplit")

        mainHost.sizingOptions = []
        inspectorHost.sizingOptions = []
        statusHost.sizingOptions = []

        let editorItem = NSSplitViewItem(viewController: mainHost)
        editorItem.minimumThickness = 420
        splitViewController.addSplitViewItem(editorItem)

        let inspectorItem = NSSplitViewItem(sidebarWithViewController: inspectorHost)
        inspectorItem.minimumThickness = 260
        inspectorItem.maximumThickness = 460
        inspectorItem.preferredThicknessFraction = 0.26
        inspectorItem.canCollapse = true
        inspectorItem.isCollapsed = true
        splitViewController.addSplitViewItem(inspectorItem)

        view = root
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        installToolbarIfNeeded()
    }

    func update(
        content: AnyView,
        inspector: AnyView,
        statusBar: AnyView,
        showsInspector: Bool,
        showsStatusBar: Bool,
        snapshot: EditorChromeSnapshot
    ) {
        self.snapshot = snapshot
        mainHost.rootView = content
        inspectorHost.rootView = inspector
        statusHost.rootView = statusBar

        if splitViewController.splitViewItems.indices.contains(1) {
            splitViewController.splitViewItems[1].isCollapsed = !showsInspector
        }
        statusHeightConstraint?.constant = showsStatusBar ? 28 : 0
        statusHost.view.isHidden = !showsStatusBar

        installToolbarIfNeeded()
        view.window?.title = snapshot.displayTitle
        view.window?.toolbar?.validateVisibleItems()
        updateToolbarState()
    }

    private func installToolbarIfNeeded() {
        guard let window = view.window else { return }
        if installedToolbar == nil {
            let toolbar = NSToolbar(identifier: ToolbarID.toolbar)
            toolbar.delegate = self
            toolbar.displayMode = .iconOnly
            toolbar.allowsUserCustomization = true
            toolbar.autosavesConfiguration = true
            installedToolbar = toolbar
        }
        if window.toolbar !== installedToolbar {
            window.toolbar = installedToolbar
            window.toolbarStyle = .unified
        }
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [
            ToolbarID.save,
            ToolbarID.refresh,
            ToolbarID.zoom,
            .flexibleSpace,
            ToolbarID.format,
            ToolbarID.insert,
            ToolbarID.find,
            .space,
            ToolbarID.document,
            ToolbarID.outline,
            ToolbarID.comments,
            ToolbarID.segments,
            ToolbarID.warnings,
            .space,
            ToolbarID.vim,
            ToolbarID.mode,
            ToolbarID.status
        ]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar) + [
            .space,
            .flexibleSpace
        ]
    }

    func toolbar(
        _ toolbar: NSToolbar,
        itemForItemIdentifier itemIdentifier: NSToolbarItem.Identifier,
        willBeInsertedIntoToolbar flag: Bool
    ) -> NSToolbarItem? {
        switch itemIdentifier {
        case ToolbarID.save:
            return toolbarButton(
                itemIdentifier,
                label: "Save",
                symbol: "square.and.arrow.up",
                action: #selector(saveDocument(_:))
            )
        case ToolbarID.refresh:
            return toolbarButton(
                itemIdentifier,
                label: "Refresh",
                symbol: "arrow.clockwise",
                action: #selector(refreshDocument(_:))
            )
        case ToolbarID.focus:
            return toolbarButton(
                itemIdentifier,
                label: "Focus Editor",
                symbol: "text.cursor",
                action: #selector(focusEditor(_:))
            )
        case ToolbarID.format:
            return menuToolbarItem(
                itemIdentifier,
                label: "Format",
                symbol: "textformat",
                menu: formatMenu()
            )
        case ToolbarID.insert:
            return menuToolbarItem(
                itemIdentifier,
                label: "Insert",
                symbol: "plus.square.on.square",
                menu: insertMenu()
            )
        case ToolbarID.find:
            return toolbarButton(
                itemIdentifier,
                label: "Find",
                symbol: "magnifyingglass",
                action: #selector(showFind(_:))
            )
        case ToolbarID.document:
            return toolbarButton(
                itemIdentifier,
                label: "Document",
                symbol: MelonPanInspectorPane.document.systemImage,
                action: #selector(showDocumentInspector(_:)),
                isToggle: true
            )
        case ToolbarID.outline:
            return toolbarButton(
                itemIdentifier,
                label: "Outline",
                symbol: MelonPanInspectorPane.outline.systemImage,
                action: #selector(showOutlineInspector(_:)),
                isToggle: true
            )
        case ToolbarID.comments:
            return toolbarButton(
                itemIdentifier,
                label: "Comments",
                symbol: MelonPanInspectorPane.comments.systemImage,
                action: #selector(showCommentsInspector(_:)),
                isToggle: true
            )
        case ToolbarID.segments:
            return toolbarButton(
                itemIdentifier,
                label: "Segments",
                symbol: MelonPanInspectorPane.segments.systemImage,
                action: #selector(showSegmentsInspector(_:)),
                isToggle: true
            )
        case ToolbarID.warnings:
            return toolbarButton(
                itemIdentifier,
                label: "Warnings",
                symbol: MelonPanInspectorPane.warnings.systemImage,
                action: #selector(showWarningsInspector(_:)),
                isToggle: true
            )
        case ToolbarID.vim:
            return toolbarButton(
                itemIdentifier,
                label: "Vim",
                symbol: "keyboard",
                action: #selector(toggleVim(_:)),
                isToggle: true
            )
        case ToolbarID.zoom:
            return zoomToolbarItem(itemIdentifier)
        case ToolbarID.mode:
            return modeToolbarItem(itemIdentifier)
        case ToolbarID.status:
            return toolbarButton(
                itemIdentifier,
                label: "Status Bar",
                symbol: "rectangle.bottomthird.inset.filled",
                action: #selector(toggleStatusBar(_:)),
                isToggle: true
            )
        default:
            return nil
        }
    }

    private func toolbarButton(
        _ identifier: NSToolbarItem.Identifier,
        label: String,
        symbol: String,
        action: Selector,
        isToggle: Bool = false
    ) -> NSToolbarItem {
        let button = NSButton(frame: NSRect(x: 0, y: 0, width: 34, height: 28))
        button.bezelStyle = .texturedRounded
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        button.imagePosition = .imageOnly
        button.target = self
        button.action = action
        button.setButtonType(isToggle ? .toggle : .momentaryPushIn)
        button.toolTip = label

        let item = NSToolbarItem(itemIdentifier: identifier)
        item.label = label
        item.paletteLabel = label
        item.toolTip = label
        item.view = button
        toolbarButtons[identifier] = button
        return item
    }

    private func menuToolbarItem(
        _ identifier: NSToolbarItem.Identifier,
        label: String,
        symbol: String,
        menu: NSMenu
    ) -> NSToolbarItem {
        let button = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 34, height: 28), pullsDown: true)
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        button.bezelStyle = .texturedRounded
        button.menu = menu
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.label = label
        item.paletteLabel = label
        item.toolTip = label
        item.view = button
        return item
    }

    private func modeToolbarItem(_ identifier: NSToolbarItem.Identifier) -> NSToolbarItem {
        let popUp = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 128, height: 28), pullsDown: false)
        for mode in MelonPanEditorMode.allCases {
            popUp.addItem(withTitle: mode.title)
            popUp.lastItem?.representedObject = mode.rawValue
        }
        popUp.target = self
        popUp.action = #selector(changeEditorMode(_:))
        if let index = MelonPanEditorMode.allCases.firstIndex(of: snapshot.editorMode) {
            popUp.selectItem(at: index)
        }
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.label = "Mode"
        item.paletteLabel = "Mode"
        item.toolTip = "Editor Mode"
        item.view = popUp
        modePopUp = popUp
        updateModeSelection()
        return item
    }

    private func zoomToolbarItem(_ identifier: NSToolbarItem.Identifier) -> NSToolbarItem {
        let popUp = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 82, height: 28), pullsDown: false)
        for percent in [75, 90, 100, 125, 150, 200] {
            popUp.addItem(withTitle: "\(percent)%")
            popUp.lastItem?.representedObject = percent
        }
        popUp.target = self
        popUp.action = #selector(changeZoom(_:))
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.label = "Zoom"
        item.paletteLabel = "Zoom"
        item.toolTip = "Zoom"
        item.view = popUp
        zoomPopUp = popUp
        updateZoomSelection()
        return item
    }

    private func formatMenu() -> NSMenu {
        let menu = NSMenu(title: "Format")
        menu.addItem(hiddenTitleItem("Format"))
        addTextAction("Bold", #selector(MelonPanTextView.melonPanToggleBold(_:)), to: menu, key: "b")
        addTextAction("Italic", #selector(MelonPanTextView.melonPanToggleItalic(_:)), to: menu, key: "i")
        addTextAction("Underline", #selector(MelonPanTextView.melonPanToggleUnderline(_:)), to: menu, key: "u")
        addTextAction("Clear Formatting", #selector(MelonPanTextView.melonPanClearFormatting(_:)), to: menu)
        menu.addItem(.separator())
        addTextAction("Normal Text", #selector(melonPanSetParagraphNormal(_:)), to: menu)
        addTextAction("Title", #selector(melonPanSetParagraphTitle(_:)), to: menu)
        for level in 1...6 {
            addTextAction("Heading \(level)", Selector(("melonPanSetHeading\(level):")), to: menu)
        }
        menu.addItem(.separator())
        addTextAction("Align Left", #selector(MelonPanTextView.melonPanAlignLeft(_:)), to: menu)
        addTextAction("Align Center", #selector(MelonPanTextView.melonPanAlignCenter(_:)), to: menu)
        addTextAction("Align Right", #selector(MelonPanTextView.melonPanAlignRight(_:)), to: menu)
        addTextAction("Justify", #selector(MelonPanTextView.melonPanAlignJustified(_:)), to: menu)
        menu.addItem(.separator())
        addTextAction("Numbered List", #selector(MelonPanTextView.melonPanToggleNumberedList(_:)), to: menu)
        addTextAction("Bulleted List", #selector(MelonPanTextView.melonPanToggleBulletedList(_:)), to: menu)
        addTextAction("Show Fonts", #selector(MelonPanTextView.melonPanShowFontPanel(_:)), to: menu)
        addTextAction("Choose Text Color...", #selector(MelonPanTextView.melonPanChooseTextColor(_:)), to: menu)
        addTextAction("Choose Highlight Color...", #selector(MelonPanTextView.melonPanChooseTextBackgroundColor(_:)), to: menu)
        return menu
    }

    private func insertMenu() -> NSMenu {
        let menu = NSMenu(title: "Insert")
        menu.addItem(hiddenTitleItem("Insert"))
        addTextAction("Link", #selector(MelonPanTextView.melonPanCreateLink(_:)), to: menu, key: "k")
        addTextAction("Image from URL", #selector(MelonPanTextView.melonPanInsertInlineImage(_:)), to: menu)
        addTextAction("2 x 2 Table", #selector(MelonPanTextView.melonPanInsertTable(_:)), to: menu)
        menu.addItem(.separator())
        addTextAction("Header", #selector(MelonPanTextView.melonPanCreateHeader(_:)), to: menu)
        addTextAction("Footer", #selector(MelonPanTextView.melonPanCreateFooter(_:)), to: menu)
        addTextAction("Footnote", #selector(MelonPanTextView.melonPanCreateFootnote(_:)), to: menu)
        return menu
    }

    private func hiddenTitleItem(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isHidden = true
        return item
    }

    private func addTextAction(_ title: String, _ action: Selector, to menu: NSMenu, key: String = "") {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = nil
        menu.addItem(item)
    }

    private func updateToolbarState() {
        setToolbarButton(ToolbarID.save, enabled: snapshot.canSave)
        setToolbarButton(ToolbarID.refresh, enabled: snapshot.canRefresh)
        setToolbarButton(ToolbarID.find, enabled: snapshot.loadError == nil && !snapshot.isLoading)
        setToolbarButton(
            ToolbarID.document,
            enabled: !snapshot.isLoading,
            selected: model.inspectorPane == .document
        )
        setToolbarButton(
            ToolbarID.outline,
            enabled: snapshot.canShowOutline,
            selected: model.inspectorPane == .outline
        )
        setToolbarButton(
            ToolbarID.comments,
            enabled: !snapshot.isLoading,
            selected: model.inspectorPane == .comments
        )
        setToolbarButton(
            ToolbarID.segments,
            enabled: !snapshot.isLoading,
            selected: model.inspectorPane == .segments
        )
        setToolbarButton(
            ToolbarID.warnings,
            enabled: !snapshot.isLoading,
            selected: model.inspectorPane == .warnings
        )
        setToolbarButton(
            ToolbarID.vim,
            enabled: !snapshot.isLoading,
            selected: snapshot.vimEnabled
        )
        setToolbarButton(
            ToolbarID.status,
            enabled: !snapshot.isLoading,
            selected: model.showsStatusBar
        )
        modePopUp?.isEnabled = snapshot.loadError == nil && !snapshot.isLoading
        zoomPopUp?.isEnabled = snapshot.loadError == nil && !snapshot.isLoading
        updateModeSelection()
        updateZoomSelection()
    }

    private func setToolbarButton(
        _ identifier: NSToolbarItem.Identifier,
        enabled: Bool,
        selected: Bool = false
    ) {
        guard let button = toolbarButtons[identifier] else { return }
        button.isEnabled = enabled
        button.state = selected ? .on : .off
    }

    private func updateModeSelection() {
        guard let modePopUp,
              let index = MelonPanEditorMode.allCases.firstIndex(of: snapshot.editorMode)
        else { return }
        if modePopUp.indexOfSelectedItem != index {
            modePopUp.selectItem(at: index)
        }
    }

    private func updateZoomSelection() {
        guard let zoomPopUp else { return }
        let selectedIndex = (0..<zoomPopUp.numberOfItems).first {
            zoomPopUp.item(at: $0)?.representedObject as? Int == snapshot.zoomPercent
        }
        if let selectedIndex {
            if zoomPopUp.indexOfSelectedItem != selectedIndex {
                zoomPopUp.selectItem(at: selectedIndex)
            }
        } else {
            zoomPopUp.selectItem(withTitle: "\(snapshot.zoomPercent)%")
        }
    }

    func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
        switch item.action {
        case #selector(saveDocument(_:)):
            return snapshot.canSave
        case #selector(refreshDocument(_:)):
            return snapshot.canRefresh
        case #selector(showFind(_:)),
             #selector(focusEditor(_:)):
            return snapshot.loadError == nil && !snapshot.isLoading
        case #selector(showDocumentInspector(_:)):
            return !snapshot.isLoading
        case #selector(showOutlineInspector(_:)):
            return snapshot.canShowOutline
        case #selector(showCommentsInspector(_:)),
             #selector(showSegmentsInspector(_:)),
             #selector(showWarningsInspector(_:)),
             #selector(toggleStatusBar(_:)),
             #selector(toggleVim(_:)):
            return !snapshot.isLoading
        default:
            return true
        }
    }

    @objc func saveDocument(_ sender: Any?) {
        model.save?()
    }

    @objc func refreshDocument(_ sender: Any?) {
        model.refresh?()
    }

    @objc func focusEditor(_ sender: Any?) {
        if let window = view.window,
           let textView = window.contentView?.firstSubview(of: MelonPanTextView.self)
        {
            window.makeFirstResponder(textView)
            return
        }
        model.focusEditor?()
    }

    @objc func showFind(_ sender: Any?) {
        model.find?()
    }

    @objc func showDocumentInspector(_ sender: Any?) {
        model.toggleInspector(.document)
    }

    @objc func showOutlineInspector(_ sender: Any?) {
        model.toggleInspector(.outline)
    }

    @objc func showCommentsInspector(_ sender: Any?) {
        model.toggleInspector(.comments)
    }

    @objc func showSegmentsInspector(_ sender: Any?) {
        model.toggleInspector(.segments)
    }

    @objc func showWarningsInspector(_ sender: Any?) {
        model.toggleInspector(.warnings)
    }

    @objc func toggleVim(_ sender: Any?) {
        model.toggleVim?()
    }

    @objc func toggleStatusBar(_ sender: Any?) {
        model.toggleStatusBar()
    }

    @objc func changeEditorMode(_ sender: NSPopUpButton) {
        guard let raw = sender.selectedItem?.representedObject as? String,
              let mode = MelonPanEditorMode(rawValue: raw)
        else { return }
        model.selectMode?(mode)
    }

    @objc func changeZoom(_ sender: NSPopUpButton) {
        guard let percent = sender.selectedItem?.representedObject as? Int else { return }
        model.setZoom?(percent)
    }

    @objc func melonPanSetParagraphNormal(_ sender: Any?) {
        NSApp.sendAction(#selector(MelonPanTextView.melonPanSetParagraphNormal(_:)), to: nil, from: sender)
    }

    @objc func melonPanSetParagraphTitle(_ sender: Any?) {
        NSApp.sendAction(#selector(MelonPanTextView.melonPanSetParagraphTitle(_:)), to: nil, from: sender)
    }

    @objc func melonPanSetHeading1(_ sender: Any?) {
        NSApp.sendAction(#selector(MelonPanTextView.melonPanSetHeading1(_:)), to: nil, from: sender)
    }

    @objc func melonPanSetHeading2(_ sender: Any?) {
        NSApp.sendAction(#selector(MelonPanTextView.melonPanSetHeading2(_:)), to: nil, from: sender)
    }

    @objc func melonPanSetHeading3(_ sender: Any?) {
        NSApp.sendAction(#selector(MelonPanTextView.melonPanSetHeading3(_:)), to: nil, from: sender)
    }

    @objc func melonPanSetHeading4(_ sender: Any?) {
        NSApp.sendAction(#selector(MelonPanTextView.melonPanSetHeading4(_:)), to: nil, from: sender)
    }

    @objc func melonPanSetHeading5(_ sender: Any?) {
        NSApp.sendAction(#selector(MelonPanTextView.melonPanSetHeading5(_:)), to: nil, from: sender)
    }

    @objc func melonPanSetHeading6(_ sender: Any?) {
        NSApp.sendAction(#selector(MelonPanTextView.melonPanSetHeading6(_:)), to: nil, from: sender)
    }
}

private extension NSView {
    func firstSubview<T: NSView>(of type: T.Type) -> T? {
        if let match = self as? T {
            return match
        }
        for subview in subviews {
            if let match = subview.firstSubview(of: type) {
                return match
            }
        }
        return nil
    }
}

struct MelonPanStatusBar: View {
    @Environment(\.appTheme) private var theme
    let snapshot: EditorChromeSnapshot

    var body: some View {
        HStack(spacing: 10) {
            Text(snapshot.displayTitle)
                .lineLimit(1)
                .truncationMode(.middle)
                .font(.caption.weight(.semibold))

            Divider()
                .frame(height: 14)

            ForEach(snapshot.statusSegments, id: \.self) { segment in
                Text(segment)
                    .lineLimit(1)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(statusColor(for: segment))
            }

            Spacer(minLength: 12)

            Text(snapshot.statusText)
                .lineLimit(1)
                .truncationMode(.middle)
                .font(.caption)
                .foregroundStyle(.secondary)

            if snapshot.outlineCount > 0 {
                Label("\(snapshot.outlineCount)", systemImage: MelonPanInspectorPane.outline.systemImage)
                    .labelStyle(.titleAndIcon)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if snapshot.unresolvedCommentCount > 0 {
                Label("\(snapshot.unresolvedCommentCount)", systemImage: MelonPanInspectorPane.comments.systemImage)
                    .labelStyle(.titleAndIcon)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.elevatedSurface)
        .overlay(Divider().background(theme.separator), alignment: .top)
    }

    private func statusColor(for segment: String) -> Color {
        if segment == "Offline" || segment == "Queued" || segment == "Suggestions" || segment.contains("suggestion") || segment.contains("warning") {
            return .orange
        }
        if segment == "Saving" {
            return .secondary
        }
        if segment.hasPrefix("Vim") {
            return .blue
        }
        return .secondary
    }
}
