import SwiftUI

struct EditorPane: View {
    let document: OpenDocument
    @Environment(\.appTheme) private var theme
    @Environment(\.appUIFont) private var appUIFont
    @EnvironmentObject private var session: AppSession
    @ObservedObject private var statusCenter = AppStatusCenter.shared
    @State private var statusMessage: String = "Rich Docs cache"
    @State private var attributed: NSAttributedString? = nil
    @State private var loadedModel: RichDocumentModel? = nil
    @State private var hasPendingOps: Bool = false
    @State private var isSaving: Bool = false
    @State private var activeTabIndex: Int = 0
    @State private var conflictReport: RuntimeBridge.ConflictReport? = nil
    @State private var autosaveTask: Task<Void, Never>? = nil
    @State private var commentsBundle: RuntimeBridge.DriveCommentBundle? = nil
    @State private var isRefreshingComments: Bool = false
    @State private var outlineScrollTarget: RichTextScrollTarget? = nil
    @State private var showFindReplace: Bool = false
    @State private var findText: String = ""
    @State private var replaceText: String = ""
    @State private var findCaseSensitive: Bool = false
    @State private var findReplaceRequest: RichTextFindReplaceRequest? = nil
    @State private var vimModeLabel: MelonPanTextView.VimModeLabel = .off
    @State private var vimCommandLine: String? = nil
    @State private var zoomPercent: Int = 100
    @State private var editorMode: MelonPanEditorMode = .editing
    @State private var suggestionCount: Int = 0
    @State private var isApplyingSuggestions: Bool = false
    @StateObject private var chromeModel = EditorChromeModel()

    var body: some View {
        MelonPanDocumentWorkspace(
            model: chromeModel,
            snapshot: editorChromeSnapshot
        ) {
            editorWorkspace
        } inspector: {
            activeInspectorPane
        } statusBar: {
            MelonPanStatusBar(snapshot: editorChromeSnapshot)
        }
        .background(theme.background)
        .popover(isPresented: $showFindReplace, arrowEdge: .top) {
            FindReplacePane(
                findText: $findText,
                replaceText: $replaceText,
                caseSensitive: $findCaseSensitive,
                onFindNext: {
                    findReplaceRequest = RichTextFindReplaceRequest(
                        action: .findNext,
                        find: findText,
                        replacement: replaceText,
                        caseSensitive: findCaseSensitive
                    )
                },
                onReplace: {
                    findReplaceRequest = RichTextFindReplaceRequest(
                        action: .replaceSelection,
                        find: findText,
                        replacement: replaceText,
                        caseSensitive: findCaseSensitive
                    )
                },
                onReplaceAll: {
                    findReplaceRequest = RichTextFindReplaceRequest(
                        action: .replaceAll,
                        find: findText,
                        replacement: replaceText,
                        caseSensitive: findCaseSensitive
                    )
                }
            )
        }
        .onAppear {
            configureChromeModel()
        }
        .onChange(of: document.documentId) { _ in
            configureChromeModel()
        }
        .onChange(of: chromeModel.inspectorPane) { pane in
            if pane == .comments {
                loadCachedComments()
            }
        }
        .task(id: document.documentId) {
            await loadDocument()
            consumePendingConflictReviewIfNeeded()
        }
        .onChange(of: session.settings.mac.editorFontSize) { _ in
            rerenderActiveTab()
        }
        .onChange(of: session.conflictReviewRequest) { _ in
            consumePendingConflictReviewIfNeeded()
        }
        .onDisappear {
            autosaveTask?.cancel()
            autosaveTask = nil
        }
        .sheet(
            isPresented: Binding(
                get: { conflictReport != nil },
                set: { presented in
                    if !presented { conflictReport = nil }
                }
            )
        ) {
            if let report = conflictReport {
                ConflictMergeSheet(
                    report: report,
                    onApply: applyConflictChoices,
                    onKeepLocal: {
                        conflictReport = nil
                        statusMessage = "Retrying local edits..."
                        saveNow()
                    },
                    onDiscardLocal: {
                        conflictReport = nil
                        discardLocalEdits()
                    },
                    onCancel: {
                        conflictReport = nil
                    }
                )
            }
        }
    }

    private var editorChromeSnapshot: EditorChromeSnapshot {
        EditorChromeSnapshot(
            documentId: document.documentId,
            title: document.title,
            isLoading: document.isLoading,
            loadingDetail: document.loadingDetail,
            loadError: document.loadError,
            hasPendingOps: hasPendingOps,
            isSaving: isSaving,
            isOffline: statusCenter.isOffline,
            vimEnabled: session.settings.mac.vimModeDefault,
            vimMode: vimModeLabel,
            vimCommandLine: vimCommandLine,
            pinnedRevision: document.pinnedRevision,
            editorMode: editorMode,
            statusMessage: statusMessage,
            outlineCount: headingOutlineItems.count,
            commentCount: commentsBundle?.comments.count ?? 0,
            unresolvedCommentCount: commentsBundle?.comments.filter { !$0.resolved }.count ?? 0,
            segmentCount: activeSupplementarySegments.count,
            warningCount: conflictReport == nil && document.loadError == nil ? 0 : 1,
            suggestionCount: suggestionCount,
            zoomPercent: zoomPercent
        )
    }

    private func configureChromeModel() {
        chromeModel.save = { saveNow() }
        chromeModel.refresh = { pullNow() }
        chromeModel.find = { showFindReplace = true }
        chromeModel.focusEditor = {
            NSApp.keyWindow?.makeFirstResponder(NSApp.keyWindow?.firstResponder)
        }
        chromeModel.toggleVim = {
            vimEnabledBinding.wrappedValue.toggle()
        }
        chromeModel.selectMode = { mode in
            editorModeBinding.wrappedValue = mode
        }
        chromeModel.setZoom = { percent in
            zoomPercent = percent
        }
        chromeModel.showInspector = { pane in
            if pane == .comments {
                loadCachedComments()
            }
        }
    }

    @ViewBuilder
    private var editorWorkspace: some View {
        if document.isLoading {
            DocumentLoadingView(document: document)
        } else if let loadError = document.loadError {
            loadErrorView(loadError)
        } else if let attributed, let model = loadedModel {
            HStack(spacing: 0) {
                docsTabsAndOutlineRail(model: model)
                ZStack(alignment: .top) {
                    theme.background
                    RichTextEditorView(
                        attributed: attributed,
                        isEditable: editorMode != .viewing,
                        onOperation: handleOperation,
                        operationIdPrefix: "swift-edit",
                        documentId: model.documentId,
                        tabId: model.tabs.indices.contains(activeTabIndex)
                            ? model.tabs[activeTabIndex].tabId
                            : "",
                        baseRevisionId: model.revisionId,
                        actor: session.activeAccount ?? "",
                        vimEnabled: session.settings.mac.vimModeDefault,
                        colorScheme: session.settings.colorScheme,
                        editorFontSize: session.settings.mac.editorFontSize,
                        editorTabWidth: session.settings.mac.editorTabWidth,
                        editorSoftWrap: session.settings.mac.editorSoftWrap,
                        editorShowDiffGutter: session.settings.mac.editorShowDiffGutter,
                        onVimModeLabelChange: { label in
                            vimModeLabel = label
                        },
                        onVimCommandLineChange: { commandLine in
                            vimCommandLine = commandLine
                        },
                        onVimExCommand: handleVimExCommand,
                        scrollTarget: outlineScrollTarget,
                        findReplaceRequest: findReplaceRequest,
                        commandRequest: nil,
                        onFindReplaceResult: handleFindReplaceResult
                    )
                    .frame(width: pageWidth)
                    .frame(maxHeight: .infinity)
                    .background(Color(nsColor: theme.palette.background))
                    .shadow(color: theme.palette.isDark ? .black.opacity(0.45) : .black.opacity(0.12), radius: 2, x: 0, y: 0)
                    .padding(.top, 18)
                    .padding(.bottom, 32)
                }
            }
        } else {
            RichDocsPreview(text: document.plainText)
        }
    }

    @ViewBuilder
    private var activeInspectorPane: some View {
        switch chromeModel.inspectorPane ?? .document {
        case .document:
            DocumentInspectorPane(
                snapshot: editorChromeSnapshot,
                activeTabTitle: activeTabTitle,
                tabCount: loadedModel?.tabs.count ?? 0
            )
        case .outline:
            DocumentOutlinePane(items: headingOutlineItems) { item in
                outlineScrollTarget = RichTextScrollTarget(paragraphId: item.id)
            }
        case .comments:
            CommentsInspector(
                bundle: commentsBundle,
                isRefreshing: isRefreshingComments,
                onRefresh: refreshCommentsNow
            )
        case .segments:
            SupplementarySegmentsPane(segments: activeSupplementarySegments)
        case .warnings:
            WarningsInspectorPane(
                loadError: document.loadError,
                conflictReport: conflictReport,
                hasPendingOps: hasPendingOps,
                suggestionCount: suggestionCount,
                isApplyingSuggestions: isApplyingSuggestions,
                isOffline: statusCenter.isOffline,
                pinnedRevision: document.pinnedRevision,
                onAcceptSuggestions: acceptSuggestions,
                onDiscardSuggestions: discardSuggestions
            )
        }
    }

    private var activeTabTitle: String {
        guard let model = loadedModel,
              model.tabs.indices.contains(activeTabIndex) else { return "Body" }
        let title = model.tabs[activeTabIndex].title.trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? "Tab \(activeTabIndex + 1)" : title
    }

    private func loadErrorView(_ loadError: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "xmark.octagon")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.red)
            Text("Could not load document")
                .font(.melonPanUI(appUIFont, relativeSize: 2, weight: .semibold))
            Text(loadError)
                .font(.melonPanUI(appUIFont, relativeSize: -1))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func docsTabsAndOutlineRail(model: RichDocumentModel) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "list.bullet.indent")
                    .foregroundStyle(.secondary)
                Text("Document tabs")
                    .font(.melonPanUI(appUIFont, relativeSize: 1, weight: .semibold))
                Spacer()
                Button {} label: { Image(systemName: "plus") }
                    .buttonStyle(.borderless)
            }
            ForEach(Array(model.tabs.enumerated()), id: \.offset) { index, tab in
                Button {
                    activeTabIndex = index
                    attributed = RichDocumentRenderer.render(
                        model,
                        tabIndex: index,
                        baseFontSize: session.settings.mac.editorFontSize
                    )
                } label: {
                    HStack {
                        Image(systemName: "doc.text")
                        Text(tab.title.isEmpty ? "Tab \(index + 1)" : tab.title)
                            .lineLimit(1)
                        Spacer()
                        Image(systemName: "ellipsis")
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(index == activeTabIndex ? theme.selection.opacity(0.8) : Color.clear)
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            Divider()
            Text("Outline")
                .font(.melonPanUI(appUIFont, relativeSize: -1, weight: .semibold))
                .foregroundStyle(.secondary)
            if headingOutlineItems.isEmpty {
                Text("No headings")
                    .font(.melonPanUI(appUIFont, relativeSize: -1))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(headingOutlineItems.prefix(12))) { item in
                    Button {
                        outlineScrollTarget = RichTextScrollTarget(paragraphId: item.id)
                    } label: {
                        Text(item.title)
                            .font(.melonPanUI(appUIFont, relativeSize: -1))
                            .lineLimit(1)
                            .padding(.leading, CGFloat(max(0, item.level - 1)) * 10)
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer()
        }
        .padding(14)
        .frame(width: 260)
        .background(theme.sidebar)
        .overlay(Divider().background(theme.separator), alignment: .trailing)
    }

    private var vimEnabledBinding: Binding<Bool> {
        Binding(
            get: { session.settings.mac.vimModeDefault },
            set: { enabled in
                guard session.settings.mac.vimModeDefault != enabled else { return }
                session.settings.mac.vimModeDefault = enabled
                persistSessionSettings()
            }
        )
    }

    private var editorModeBinding: Binding<MelonPanEditorMode> {
        Binding(
            get: { editorMode },
            set: { mode in
                editorMode = mode
                switch mode {
                case .editing:
                    statusMessage = "Editing directly"
                case .suggesting:
                    statusMessage = "Suggesting queues local rich edits for review"
                case .viewing:
                    statusMessage = "Viewing"
                }
            }
        )
    }

    private var pageWidth: CGFloat {
        796 * CGFloat(zoomPercent) / 100
    }

    private func rerenderActiveTab() {
        guard let model = loadedModel else { return }
        attributed = RichDocumentRenderer.render(
            model,
            tabIndex: activeTabIndex,
            baseFontSize: session.settings.mac.editorFontSize
        )
    }

    private func persistSessionSettings() {
        let settings = session.settings
        let cacheRoot = session.cacheRoot
        Task.detached(priority: .utility) {
            try? RuntimeBridge.saveSettings(cacheRoot: cacheRoot, settings: settings)
        }
    }

    private var headingOutlineItems: [DocumentOutlineItem] {
        guard let model = loadedModel,
              model.tabs.indices.contains(activeTabIndex) else { return [] }
        let tab = model.tabs[activeTabIndex]
        let blocks = tab.blocks ?? tab.paragraphs.map {
            RichDocumentModel.Block(kind: "paragraph", paragraph: $0, table: nil)
        }
        var items: [DocumentOutlineItem] = []
        collectOutlineItems(from: blocks, into: &items)
        return items
    }

    private var activeSupplementarySegments: [SupplementarySegmentItem] {
        guard let model = loadedModel,
              model.tabs.indices.contains(activeTabIndex) else { return [] }
        let tab = model.tabs[activeTabIndex]
        return SupplementarySegmentItem.items(from: tab.headers ?? [], label: "Header")
            + SupplementarySegmentItem.items(from: tab.footers ?? [], label: "Footer")
            + SupplementarySegmentItem.items(from: tab.footnotes ?? [], label: "Footnote")
    }

    private func collectOutlineItems(
        from blocks: [RichDocumentModel.Block],
        into items: inout [DocumentOutlineItem]
    ) {
        for block in blocks {
            if block.kind == "paragraph", let paragraph = block.paragraph {
                if let level = headingLevel(paragraph.namedStyle) {
                    let title = paragraphPlainText(paragraph)
                    if !title.isEmpty {
                        items.append(DocumentOutlineItem(
                            id: paragraph.id.packed,
                            title: title,
                            level: level
                        ))
                    }
                }
            } else if block.kind == "table", let table = block.table {
                for row in table.rows {
                    for cell in row.cells {
                        collectOutlineItems(from: cell.blocks, into: &items)
                    }
                }
            }
        }
    }

    private func headingLevel(_ namedStyle: String) -> Int? {
        let prefix = "HEADING_"
        guard namedStyle.hasPrefix(prefix),
              let raw = Int(namedStyle.dropFirst(prefix.count)) else { return nil }
        return min(max(raw, 1), 6)
    }

    private func paragraphPlainText(_ paragraph: RichDocumentModel.Paragraph) -> String {
        paragraph.runs
            .map(\.text)
            .joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func loadDocument() async {
        let cacheRoot = session.cacheRoot
        let documentId = document.documentId
        let baseFontSize = session.settings.mac.editorFontSize
        let payload: (RichDocumentModel?, NSAttributedString?, Bool) =
            await Task.detached(priority: .userInitiated) {
                let json: String?
                do {
                    json = try RuntimeBridge.loadRichDocumentForSwift(
                        cacheRoot: cacheRoot,
                        documentId: documentId
                    )
                } catch {
                    return (nil, nil, false)
                }
                guard let json,
                      let data = json.data(using: .utf8),
                      let parsed = try? JSONDecoder().decode(
                          RichDocumentModel.self,
                          from: data
                      ),
                      parsed.schemaVersion == RichDocumentModel.expectedSchemaVersion else {
                    return (nil, nil, false)
                }
                let rendered = RichDocumentRenderer.render(parsed, baseFontSize: baseFontSize)
                let pending = RuntimeBridge.hasPendingOps(
                    cacheRoot: cacheRoot,
                    documentId: documentId
                )
                return (parsed, rendered, pending)
            }.value
        loadedModel = payload.0
        attributed = payload.1
        hasPendingOps = payload.2
        refreshSuggestionCount()
        loadCachedComments()
    }

    private func loadCachedComments() {
        let cacheRoot = session.cacheRoot
        let documentId = document.documentId
        Task.detached(priority: .utility) {
            let bundle = try? RuntimeBridge.loadComments(
                cacheRoot: cacheRoot,
                documentId: documentId
            )
            await MainActor.run {
                commentsBundle = bundle
            }
        }
    }

    private func handleOperation(envelope: String) {
        if editorMode == .suggesting {
            do {
                try appendSuggestionEnvelope(envelope)
                refreshSuggestionCount()
                statusMessage = suggestionCount == 1
                    ? "Suggested 1 edit"
                    : "Suggested \(suggestionCount) edits"
            } catch {
                statusMessage = "Suggestion queue failed: \(error.localizedDescription)"
            }
            return
        }

        let cacheRoot = session.cacheRoot
        let documentId = document.documentId
        Task.detached(priority: .userInitiated) {
            do {
                try RuntimeBridge.appendOperationEnvelope(
                    cacheRoot: cacheRoot,
                    documentId: documentId,
                    envelopeJson: envelope
                )
                let pending = RuntimeBridge.hasPendingOps(
                    cacheRoot: cacheRoot,
                    documentId: documentId
                )
                await MainActor.run {
                    hasPendingOps = pending
                    statusMessage = "Edited (queued)"
                    scheduleAutosaveIfEnabled()
                }
            } catch {
                await MainActor.run {
                    statusMessage = "Edit queue failed: \(error.localizedDescription)"
                }
            }
        }
    }

    private func saveNow() {
        guard let account = session.activeAccount else {
            statusMessage = "Sign in first to save."
            return
        }
        autosaveTask?.cancel()
        autosaveTask = nil
        isSaving = true
        statusMessage = "Saving..."
        let credentials = session.credentialsPath
        let cacheRoot = session.cacheRoot
        let docId = document.documentId
        Task.detached(priority: .userInitiated) {
            do {
                let token = try RuntimeBridge.ensureFreshAccessToken(
                    credentialsPath: credentials,
                    account: account,
                    leewaySeconds: 30
                )
                let report = try RuntimeBridge.pushDocument(
                    accessToken: token,
                    documentId: docId,
                    cacheRoot: cacheRoot
                )
                let pending = RuntimeBridge.hasPendingOps(
                    cacheRoot: cacheRoot,
                    documentId: docId
                )
                await MainActor.run {
                    hasPendingOps = pending
                    isSaving = false
                    let warningCount = report.fidelityWarnings.count
                    if warningCount > 0 {
                        // Validation flagged something — typically a
                        // dropped named range or an op whose post-condition
                        // didn't match. Surface a banner with the first
                        // warning so the user knows something needs their
                        // attention even though the doc was pushed.
                        let detail = report.fidelityWarnings
                            .prefix(3)
                            .map { $0.message }
                            .joined(separator: " · ")
                        AppStatusCenter.shared.post(StatusBanner(
                            dedupeKey: "push-warnings:\(docId)",
                            kind: .warning,
                            title: "Saved with \(warningCount) warning(s)",
                            detail: detail,
                            primaryAction: nil,
                            autoDismissAfter: 8,
                            canDismiss: true
                        ))
                        statusMessage = "Saved with \(warningCount) warning(s)"
                    } else {
                        statusMessage = "Saved"
                        AppStatusCenter.shared.clear(dedupeKey: "push-warnings:\(docId)")
                    }
                    // Reload the rich view so the editor reflects the
                    // post-push revision (server may have normalized
                    // whitespace, applied auto-replacements, etc.).
                    Task { await loadDocument() }
                }
            } catch {
                await MainActor.run {
                    isSaving = false
                    let message = UserFacingError.message(from: error)
                    if message.contains("REVISION_REJECTED") {
                        statusMessage = "Server moved on"
                        refreshAndClassifyConflict()
                    } else {
                        statusMessage = "Save failed"
                        AppStatusCenter.shared.post(StatusBanner(
                            dedupeKey: "push:\(docId)",
                            kind: .error,
                            title: "Save failed",
                            detail: message,
                            primaryAction: BannerAction(label: "Retry") {
                                saveNow()
                            },
                            autoDismissAfter: nil,
                            canDismiss: true
                        ))
                    }
                }
            }
        }
    }

    private var suggestionLogURL: URL {
        URL(fileURLWithPath: session.cacheRoot)
            .appendingPathComponent("docs", isDirectory: true)
            .appendingPathComponent(document.documentId, isDirectory: true)
            .appendingPathComponent("suggestion-log.jsonl")
    }

    private func appendSuggestionEnvelope(_ envelope: String) throws {
        let url = suggestionLogURL
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.seekToEnd()
        if let data = (envelope + "\n").data(using: .utf8) {
            try handle.write(contentsOf: data)
            try handle.synchronize()
        }
    }

    private func refreshSuggestionCount() {
        suggestionCount = readSuggestionEnvelopes().count
    }

    private func readSuggestionEnvelopes() -> [String] {
        guard let raw = try? String(contentsOf: suggestionLogURL, encoding: .utf8) else {
            return []
        }
        return raw
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private func acceptSuggestions() {
        let envelopes = readSuggestionEnvelopes()
        guard !envelopes.isEmpty else { return }
        isApplyingSuggestions = true
        let cacheRoot = session.cacheRoot
        let documentId = document.documentId
        let logURL = suggestionLogURL
        Task.detached(priority: .userInitiated) {
            do {
                for envelope in envelopes {
                    try RuntimeBridge.appendOperationEnvelope(
                        cacheRoot: cacheRoot,
                        documentId: documentId,
                        envelopeJson: envelope
                    )
                }
                try? FileManager.default.removeItem(at: logURL)
                let pending = RuntimeBridge.hasPendingOps(cacheRoot: cacheRoot, documentId: documentId)
                await MainActor.run {
                    hasPendingOps = pending
                    suggestionCount = 0
                    isApplyingSuggestions = false
                    statusMessage = envelopes.count == 1
                        ? "Accepted 1 suggested edit"
                        : "Accepted \(envelopes.count) suggested edits"
                    scheduleAutosaveIfEnabled()
                }
            } catch {
                await MainActor.run {
                    isApplyingSuggestions = false
                    statusMessage = "Accept suggestions failed: \(error.localizedDescription)"
                }
            }
        }
    }

    private func discardSuggestions() {
        guard suggestionCount > 0 else { return }
        isApplyingSuggestions = true
        let logURL = suggestionLogURL
        Task.detached(priority: .utility) {
            try? FileManager.default.removeItem(at: logURL)
            await MainActor.run {
                suggestionCount = 0
                isApplyingSuggestions = false
                statusMessage = "Discarded suggested edits"
                Task { await loadDocument() }
            }
        }
    }

    private func handleVimExCommand(_ command: VimController.ExCommand) {
        switch command {
        case .write:
            saveNow()
        case .quit:
            session.closeTab(document.id)
        case .writeQuit:
            saveNow()
            session.closeTab(document.id)
        case .edit:
            pullNow()
        }
    }

    private func scheduleAutosaveIfEnabled() {
        autosaveTask?.cancel()
        guard hasPendingOps,
              conflictReport == nil,
              !isSaving,
              !document.isLoading,
              session.activeAccount != nil,
              !statusCenter.isOffline
        else {
            autosaveTask = nil
            return
        }
        let settings = (try? RuntimeBridge.loadSettings(cacheRoot: session.cacheRoot)) ?? .default
        guard settings.mac.editorAutosaveEnabled else {
            autosaveTask = nil
            return
        }
        let debounceMs = max(250, settings.mac.editorAutosaveMs)
        autosaveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(debounceMs) * 1_000_000)
            guard !Task.isCancelled,
                  hasPendingOps,
                  conflictReport == nil,
                  !isSaving,
                  !document.isLoading,
                  session.activeAccount != nil,
                  !statusCenter.isOffline
            else { return }
            statusMessage = "Autosaving..."
            saveNow()
        }
    }

    private func showRevisionRejectedBanner(detail: String) {
        let docId = document.documentId
        AppStatusCenter.shared.post(StatusBanner(
            dedupeKey: "revision-rejected:\(docId)",
            kind: .warning,
            title: "Doc was edited elsewhere",
            detail: detail,
            primaryAction: BannerAction(label: "Refresh & review") {
                AppStatusCenter.shared.clear(dedupeKey: "revision-rejected:\(docId)")
                refreshAndClassifyConflict()
            },
            secondaryAction: BannerAction(label: "Discard local edits") {
                AppStatusCenter.shared.clear(dedupeKey: "revision-rejected:\(docId)")
                discardLocalEdits()
            },
            autoDismissAfter: nil,
            canDismiss: true
        ))
    }

    private func handleFindReplaceResult(_ result: RichTextFindReplaceResult) {
        if result.replaced > 0 {
            if editorMode == .suggesting {
                refreshSuggestionCount()
                statusMessage = result.replaced == 1
                    ? "Suggested 1 replacement"
                    : "Suggested \(result.replaced) replacements"
                return
            }
            hasPendingOps = RuntimeBridge.hasPendingOps(
                cacheRoot: session.cacheRoot,
                documentId: document.documentId
            )
            statusMessage = result.replaced == 1
                ? "Replaced 1 match"
                : "Replaced \(result.replaced) matches"
            scheduleAutosaveIfEnabled()
        } else if result.matched > 0 {
            statusMessage = "Found match"
        } else {
            statusMessage = "No matches"
        }
    }

    private func consumePendingConflictReviewIfNeeded() {
        guard let request = session.conflictReviewRequest,
              request.documentId == document.documentId
        else { return }
        session.consumeConflictReview(request)
        statusMessage = "Preparing merge review..."
        refreshAndClassifyConflict()
    }

    private func refreshAndClassifyConflict() {
        guard let account = session.activeAccount else { return }
        let credentials = session.credentialsPath
        let cacheRoot = session.cacheRoot
        let docId = document.documentId
        Task.detached(priority: .userInitiated) {
            do {
                let token = try RuntimeBridge.ensureFreshAccessToken(
                    credentialsPath: credentials,
                    account: account,
                    leewaySeconds: 30
                )
                _ = try RuntimeBridge.pullDocument(
                    accessToken: token,
                    documentId: docId,
                    cacheRoot: cacheRoot
                )
                let report = try RuntimeBridge.classifyConflict(
                    cacheRoot: cacheRoot,
                    documentId: docId
                )
                await MainActor.run {
                    statusMessage = report.hasUserWork
                        ? "Review merge choices"
                        : "Refreshed; retrying save..."
                    if report.hasUserWork {
                        conflictReport = report
                    } else {
                        saveNow()
                    }
                }
            } catch {
                await MainActor.run {
                    let message = UserFacingError.message(from: error)
                    statusMessage = "Merge review failed"
                    showRevisionRejectedBanner(
                        detail: "Could not prepare a merge report: \(message)"
                    )
                }
            }
        }
    }

    private func applyConflictChoices(_ decisions: [String: String], manualTexts: [String: String]) {
        let cacheRoot = session.cacheRoot
        let docId = document.documentId
        conflictReport = nil
        statusMessage = "Applying merge choices..."
        Task.detached(priority: .userInitiated) {
            do {
                let report = try RuntimeBridge.resolveConflict(
                    cacheRoot: cacheRoot,
                    documentId: docId,
                    decisions: decisions,
                    manualTexts: manualTexts
                )
                let pending = RuntimeBridge.hasPendingOps(
                    cacheRoot: cacheRoot,
                    documentId: docId
                )
                await MainActor.run {
                    hasPendingOps = pending
                    statusMessage = "Resolved \(report.canceledOperations) operation(s)"
                    if report.remainingPending {
                        saveNow()
                    } else {
                        Task { await loadDocument() }
                    }
                }
            } catch {
                await MainActor.run {
                    let message = UserFacingError.message(from: error)
                    statusMessage = "Resolve failed"
                    showRevisionRejectedBanner(detail: message)
                }
            }
        }
    }

    private func discardLocalEdits() {
        let cacheRoot = session.cacheRoot
        let docId = document.documentId
        Task.detached(priority: .userInitiated) {
            do {
                try RuntimeBridge.discardPendingOps(
                    cacheRoot: cacheRoot,
                    documentId: docId
                )
                let pending = RuntimeBridge.hasPendingOps(
                    cacheRoot: cacheRoot,
                    documentId: docId
                )
                await MainActor.run {
                    hasPendingOps = pending
                    statusMessage = "Local edits discarded"
                }
                await loadDocument()
            } catch {
                await MainActor.run {
                    let message = UserFacingError.message(from: error)
                    statusMessage = "Discard failed: \(message)"
                }
            }
        }
    }

    private func pullNow() {
        guard let account = session.activeAccount else {
            statusMessage = "Sign in first to refresh."
            AppStatusCenter.shared.post(StatusBanner(
                dedupeKey: "sign-in-expired",
                kind: .warning,
                title: "Sign-in expired",
                detail: "Reconnect Google to keep syncing.",
                primaryAction: BannerAction(label: "Sign in") {
                    AppStatusCenter.shared.requestSignIn?()
                },
                autoDismissAfter: nil,
                canDismiss: true
            ))
            return
        }
        statusMessage = "Refreshing..."
        AppStatusCenter.shared.postSyncing()
        let credentials = session.credentialsPath
        let cacheRoot = session.cacheRoot
        let docId = document.documentId
        Task.detached(priority: .userInitiated) {
            do {
                let token = try RuntimeBridge.ensureFreshAccessToken(
                    credentialsPath: credentials,
                    account: account,
                    leewaySeconds: 30
                )
                let report = try RuntimeBridge.pullDocument(
                    accessToken: token,
                    documentId: docId,
                    cacheRoot: cacheRoot
                )
                _ = try? RuntimeBridge.refreshComments(
                    accessToken: token,
                    documentId: docId,
                    cacheRoot: cacheRoot
                )
                await SpotlightIndexer.shared.update(
                    documentId: report.documentId,
                    cacheRoot: cacheRoot
                )
                await MainActor.run {
                    if let index = session.openDocuments.firstIndex(where: {
                        $0.documentId == report.documentId
                    }) {
                        session.openDocuments[index].title = report.title
                        session.openDocuments[index].plainText = report.plainText
                    }
                    statusMessage = "Refreshed \(report.revisionId)"
                    AppStatusCenter.shared.clear(dedupeKey: "sync")
                    AppStatusCenter.shared.clear(dedupeKey: "pull:\(docId)")
                }
                // Reload the rich attributed view from cache after pull.
                await loadDocument()
            } catch {
                await MainActor.run {
                    let message = UserFacingError.message(from: error)
                    statusMessage = "Refresh failed"
                    AppStatusCenter.shared.clear(dedupeKey: "sync")
                    AppStatusCenter.shared.post(StatusBanner(
                        dedupeKey: "pull:\(docId)",
                        kind: .error,
                        title: "Refresh failed",
                        detail: message,
                        primaryAction: BannerAction(label: "Retry") {
                            pullNow()
                        },
                        autoDismissAfter: nil,
                        canDismiss: true
                    ))
                }
            }
        }
    }

    private func refreshCommentsNow() {
        guard let account = session.activeAccount else {
            statusMessage = "Sign in first to refresh comments."
            return
        }
        guard GoogleScopeSupport.canListComments(RuntimeBridge.tokenMetadata(account: account)) else {
            AppStatusCenter.shared.post(StatusBanner(
                dedupeKey: "comments-scope:\(document.documentId)",
                kind: .warning,
                title: "Comments need sign-in",
                detail: GoogleScopeSupport.missingCommentsScopeMessage,
                primaryAction: BannerAction(label: "Sign in") {
                    session.showSignInSheet = true
                },
                autoDismissAfter: nil,
                canDismiss: true
            ))
            return
        }
        isRefreshingComments = true
        statusMessage = "Refreshing comments..."
        let credentials = session.credentialsPath
        let cacheRoot = session.cacheRoot
        let docId = document.documentId
        Task.detached(priority: .userInitiated) {
            do {
                let token = try RuntimeBridge.ensureFreshAccessToken(
                    credentialsPath: credentials,
                    account: account,
                    leewaySeconds: 30
                )
                let report = try RuntimeBridge.refreshComments(
                    accessToken: token,
                    documentId: docId,
                    cacheRoot: cacheRoot
                )
                let bundle = try RuntimeBridge.loadComments(
                    cacheRoot: cacheRoot,
                    documentId: docId
                )
                await MainActor.run {
                    commentsBundle = bundle
                    isRefreshingComments = false
                    statusMessage = report.commentCount == 1
                        ? "Loaded 1 comment"
                        : "Loaded \(report.commentCount) comments"
                    AppStatusCenter.shared.clear(dedupeKey: "comments:\(docId)")
                }
            } catch {
                await MainActor.run {
                    let message = UserFacingError.message(from: error)
                    isRefreshingComments = false
                    statusMessage = "Comments failed"
                    AppStatusCenter.shared.post(StatusBanner(
                        dedupeKey: "comments:\(docId)",
                        kind: .warning,
                        title: "Comments unavailable",
                        detail: message,
                        primaryAction: BannerAction(label: "Retry") {
                            refreshCommentsNow()
                        },
                        autoDismissAfter: nil,
                        canDismiss: true
                    ))
                }
            }
        }
    }
}

private struct DocumentOutlineItem: Identifiable, Equatable {
    let id: String
    let title: String
    let level: Int
}

private struct InspectorPaneHeader: View {
    let title: String
    let systemImage: String

    init(_ title: String, systemImage: String) {
        self.title = title
        self.systemImage = systemImage
    }

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.headline)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .overlay(Divider(), alignment: .bottom)
    }
}

private struct InspectorStatRow: View {
    let title: String
    let value: String

    init(_ title: String, value: String) {
        self.title = title
        self.value = value
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(value)
                .font(.caption.monospacedDigit())
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
                .lineLimit(2)
        }
    }
}

private struct InspectorEmptyState: View {
    let systemImage: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.horizontal, 18)
    }
}

private struct DocumentInspectorPane: View {
    let snapshot: EditorChromeSnapshot
    let activeTabTitle: String
    let tabCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            InspectorPaneHeader("Document", systemImage: MelonPanInspectorPane.document.systemImage)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(snapshot.displayTitle)
                            .font(.title3.weight(.semibold))
                            .lineLimit(2)
                        Text(snapshot.documentId)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .lineLimit(2)
                    }

                    Divider()

                    VStack(spacing: 8) {
                        InspectorStatRow("Active tab", value: activeTabTitle)
                        InspectorStatRow("Tabs", value: "\(tabCount)")
                        InspectorStatRow("Mode", value: snapshot.editorMode.title)
                        InspectorStatRow("Zoom", value: "\(snapshot.zoomPercent)%")
                        InspectorStatRow("Sync", value: snapshot.syncTitle)
                        InspectorStatRow("Suggestions", value: "\(snapshot.suggestionCount)")
                        if let revision = snapshot.pinnedRevision {
                            InspectorStatRow("Revision", value: revision)
                        }
                    }

                    Divider()

                    VStack(spacing: 8) {
                        InspectorStatRow("Outline", value: "\(snapshot.outlineCount)")
                        InspectorStatRow("Comments", value: "\(snapshot.unresolvedCommentCount) unresolved")
                        InspectorStatRow("Segments", value: "\(snapshot.segmentCount)")
                        InspectorStatRow("Warnings", value: "\(snapshot.warningCount)")
                    }
                }
                .padding(14)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct WarningsInspectorPane: View {
    let loadError: String?
    let conflictReport: RuntimeBridge.ConflictReport?
    let hasPendingOps: Bool
    let suggestionCount: Int
    let isApplyingSuggestions: Bool
    let isOffline: Bool
    let pinnedRevision: String?
    let onAcceptSuggestions: () -> Void
    let onDiscardSuggestions: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            InspectorPaneHeader("Warnings", systemImage: MelonPanInspectorPane.warnings.systemImage)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let loadError {
                        warningRow(
                            title: "Load Error",
                            detail: loadError,
                            systemImage: "xmark.octagon"
                        )
                    }
                    if conflictReport != nil {
                        warningRow(
                            title: "Conflict Review",
                            detail: "The remote revision moved while local edits were queued.",
                            systemImage: "exclamationmark.triangle"
                        )
                    }
                    if hasPendingOps {
                        warningRow(
                            title: "Queued Edits",
                            detail: "Local rich edit operations are waiting to be saved.",
                            systemImage: "tray.and.arrow.up"
                        )
                    }
                    if suggestionCount > 0 {
                        warningRow(
                            title: "Suggested Edits",
                            detail: "\(suggestionCount) local suggestion\(suggestionCount == 1 ? "" : "s") waiting for review.",
                            systemImage: "text.bubble"
                        )
                        HStack(spacing: 8) {
                            Button("Accept All", action: onAcceptSuggestions)
                                .disabled(isApplyingSuggestions)
                            Button("Discard All", action: onDiscardSuggestions)
                                .disabled(isApplyingSuggestions)
                            if isApplyingSuggestions {
                                ProgressView()
                                    .controlSize(.small)
                            }
                        }
                        .controlSize(.small)
                        .padding(.leading, 28)
                    }
                    if isOffline {
                        warningRow(
                            title: "Offline",
                            detail: "Network connectivity is unavailable; sync actions may fail.",
                            systemImage: "wifi.slash"
                        )
                    }
                    if let pinnedRevision {
                        warningRow(
                            title: "Read-only Revision",
                            detail: pinnedRevision,
                            systemImage: "lock"
                        )
                    }
                    if loadError == nil,
                       conflictReport == nil,
                       !hasPendingOps,
                       suggestionCount == 0,
                       !isOffline,
                       pinnedRevision == nil {
                        InspectorEmptyState(
                            systemImage: "checkmark.circle",
                            title: "No Warnings",
                            message: "No active warnings or conflicts."
                        )
                    }
                }
                .padding(14)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func warningRow(title: String, detail: String, systemImage: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(.orange)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CommentsInspector: View {
    @Environment(\.appTheme) private var theme
    let bundle: RuntimeBridge.DriveCommentBundle?
    let isRefreshing: Bool
    let onRefresh: () -> Void

    private var comments: [RuntimeBridge.DriveComment] {
        bundle?.comments ?? []
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Label("Comments", systemImage: MelonPanInspectorPane.comments.systemImage)
                    .font(.headline)
                Spacer()
                if isRefreshing {
                    ProgressView()
                        .controlSize(.small)
                }
                Button(action: onRefresh) {
                    Label("Refresh Comments", systemImage: "arrow.clockwise")
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .help("Refresh comments from Drive")
                .disabled(isRefreshing)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)

            Divider()

            if comments.isEmpty {
                InspectorEmptyState(
                    systemImage: MelonPanInspectorPane.comments.systemImage,
                    title: "No Cached Comments",
                    message: "Refresh to load Drive comments for this document."
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(comments) { comment in
                            CommentRow(comment: comment)
                            Divider()
                        }
                    }
                }
            }

            if let fetchedAt = bundle?.fetchedAt {
                Divider()
                Text("Fetched \(fetchedAt)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
            }
        }
        .background(theme.surface)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct CommentRow: View {
    let comment: RuntimeBridge.DriveComment

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(authorName)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                if comment.resolved {
                    Text("Resolved")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }

            if let quote = comment.quotedFileContent?.value,
               !quote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text(quote)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .padding(.leading, 8)
                    .overlay(alignment: .leading) {
                        Rectangle()
                            .fill(Color.secondary.opacity(0.35))
                            .frame(width: 2)
                    }
            }

            Text(displayText(comment.content, html: comment.htmlContent))
                .font(.body)
                .textSelection(.enabled)

            if !comment.replies.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(comment.replies.filter { !$0.deleted }) { reply in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(reply.author?.displayName ?? "Reply")
                                .font(.caption.weight(.semibold))
                            Text(displayText(reply.content, html: reply.htmlContent))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.leading, 10)
            }

            if let modified = comment.modifiedTime ?? comment.createdTime {
                Text(modified)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .opacity(comment.resolved ? 0.68 : 1)
    }

    private var authorName: String {
        let name = comment.author?.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return (name?.isEmpty == false) ? name! : "Comment"
    }

    private func displayText(_ plain: String, html: String) -> String {
        let text = plain.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            return text
        }
        return html
            .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct DocumentOutlinePane: View {
    let items: [DocumentOutlineItem]
    let onSelect: (DocumentOutlineItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            InspectorPaneHeader("Outline", systemImage: MelonPanInspectorPane.outline.systemImage)
            if items.isEmpty {
                InspectorEmptyState(
                    systemImage: MelonPanInspectorPane.outline.systemImage,
                    title: "No Headings",
                    message: "Headings appear here as the document structure grows."
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(items) { item in
                            Button {
                                onSelect(item)
                            } label: {
                                HStack(spacing: 8) {
                                    Text("H\(item.level)")
                                        .font(.caption.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                        .frame(width: 24, alignment: .leading)
                                    Text(item.title)
                                        .lineLimit(1)
                                    Spacer()
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .padding(.leading, CGFloat(max(0, item.level - 1) * 12))
                            .padding(.vertical, 3)
                        }
                    }
                    .padding(14)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct FindReplacePane: View {
    @Binding var findText: String
    @Binding var replaceText: String
    @Binding var caseSensitive: Bool
    let onFindNext: () -> Void
    let onReplace: () -> Void
    let onReplaceAll: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Find and Replace", systemImage: "magnifyingglass")
                .font(.headline)

            TextField("Find", text: $findText)
                .textFieldStyle(.roundedBorder)
                .onSubmit(onFindNext)

            TextField("Replace", text: $replaceText)
                .textFieldStyle(.roundedBorder)

            Toggle("Case sensitive", isOn: $caseSensitive)
                .font(.caption)

            HStack {
                Button("Find Next", action: onFindNext)
                    .disabled(findText.isEmpty)
                Spacer()
                Button("Replace", action: onReplace)
                    .disabled(findText.isEmpty)
                Button("Replace All", action: onReplaceAll)
                    .disabled(findText.isEmpty)
            }
            .controlSize(.small)
        }
        .padding(14)
        .frame(width: 320, alignment: .topLeading)
    }
}

private struct DocumentLoadingView: View {
    @Environment(\.appTheme) private var theme
    let document: OpenDocument

    var body: some View {
        VStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(.regularMaterial)
                    .frame(width: 72, height: 72)
                Image(systemName: "doc.richtext")
                    .font(.system(size: 32, weight: .semibold))
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 6) {
                Text("Opening Google Doc")
                    .font(.headline)
                Text(document.title)
                    .font(.title3.weight(.semibold))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 460)
                Text(document.loadingDetail ?? "Loading rich document data...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ProgressView()
                .controlSize(.large)
                .padding(.top, 4)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.background)
    }
}

private struct SupplementarySegmentItem: Identifiable {
    let id: String
    let label: String
    let preview: String

    static func items(from segments: [RichDocumentModel.Segment], label: String) -> [SupplementarySegmentItem] {
        segments.map { segment in
            SupplementarySegmentItem(
                id: segment.segmentId,
                label: label,
                preview: preview(from: segment.blocks)
            )
        }
    }

    private static func preview(from blocks: [RichDocumentModel.Block]) -> String {
        let text = blocks
            .flatMap(blockText)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? "Empty segment" : text
    }

    private static func blockText(_ block: RichDocumentModel.Block) -> [String] {
        if let paragraph = block.paragraph {
            return [paragraph.runs.map(\.text).joined()]
        }
        if let table = block.table {
            return table.rows.flatMap { row in
                row.cells.flatMap { cell in
                    cell.blocks.flatMap(blockText)
                }
            }
        }
        return []
    }
}

private struct SupplementarySegmentsPane: View {
    let segments: [SupplementarySegmentItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            InspectorPaneHeader("Segments", systemImage: MelonPanInspectorPane.segments.systemImage)

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Button {
                        NSApp.sendAction(#selector(MelonPanTextView.melonPanCreateHeader(_:)), to: nil, from: nil)
                    } label: {
                        Label("Header", systemImage: "rectangle.topthird.inset.filled")
                    }
                    Button {
                        NSApp.sendAction(#selector(MelonPanTextView.melonPanCreateFooter(_:)), to: nil, from: nil)
                    } label: {
                        Label("Footer", systemImage: "rectangle.bottomthird.inset.filled")
                    }
                    Button {
                        NSApp.sendAction(#selector(MelonPanTextView.melonPanCreateFootnote(_:)), to: nil, from: nil)
                    } label: {
                        Label("Footnote", systemImage: "text.badge.plus")
                    }
                }
                .labelStyle(.iconOnly)
                .controlSize(.small)

                Divider()

                if segments.isEmpty {
                    InspectorEmptyState(
                        systemImage: MelonPanInspectorPane.segments.systemImage,
                        title: "No Segments",
                        message: "Headers, footers, and footnotes appear here."
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(segments) { segment in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(segment.label)
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.secondary)
                                    Text(segment.preview)
                                        .font(.body)
                                        .lineLimit(3)
                                    Text(segment.id)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(.tertiary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 3)
                            }
                        }
                    }
                }

                Divider()

                HStack(spacing: 8) {
                    Button("Delete Header") {
                        NSApp.sendAction(#selector(MelonPanTextView.melonPanDeleteCurrentHeader(_:)), to: nil, from: nil)
                    }
                    Button("Delete Footer") {
                        NSApp.sendAction(#selector(MelonPanTextView.melonPanDeleteCurrentFooter(_:)), to: nil, from: nil)
                    }
                    Button("Delete Footnote") {
                        NSApp.sendAction(#selector(MelonPanTextView.melonPanDeleteCurrentFootnote(_:)), to: nil, from: nil)
                    }
                }
                .controlSize(.small)
            }
            .padding(14)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct RichDocsPreview: View {
    @Environment(\.appTheme) private var theme
    let text: String

    var body: some View {
        ScrollView {
            Text(text.isEmpty ? "This Google Doc has no body text." : text)
                .font(.system(size: 15))
                .lineSpacing(5)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.background)
    }
}
