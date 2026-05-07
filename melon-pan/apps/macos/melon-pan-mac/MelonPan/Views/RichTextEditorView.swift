import AppKit
import SwiftUI

struct RichTextScrollTarget: Equatable {
    let id = UUID()
    let paragraphId: String
}

struct RichTextFindReplaceRequest: Equatable {
    enum Action: Equatable {
        case findNext
        case replaceSelection
        case replaceAll
    }

    let id = UUID()
    let action: Action
    let find: String
    let replacement: String
    let caseSensitive: Bool
}

struct RichTextFindReplaceResult: Equatable {
    let matched: Int
    let replaced: Int
}

struct RichTextEditorCommandRequest: Equatable {
    let id = UUID()
    let command: RichTextEditorCommand

    static func == (lhs: RichTextEditorCommandRequest, rhs: RichTextEditorCommandRequest) -> Bool {
        lhs.id == rhs.id
    }
}

enum RichTextEditorCommand: Equatable {
    case emit(MelonPanTextView.StyleCommand)
    case promptLink
    case promptInlineImage
    case promptTextColor
    case promptHighlightColor
    case showFontPanel
    case promptTableCellBackground
    case promptTableCellBorder
    case promptTableColumnWidth
    case promptTableRowHeight
}

/// SwiftUI wrapper around `NSScrollView` + `NSTextView` that displays a
/// `RichDocument` and (when `isEditable` is true) captures user edits as
/// `RichOperation` envelopes appended to the per-doc operation log.
///
/// The renderer (`RichDocumentRenderer`) stamps every paragraph with
/// `.melonPanParagraphId` and `.melonPanParagraphStart` custom
/// attributes. On edit, the storage delegate reads those attributes at
/// the affected NSRange to recover the stable `RichNodeId` and the
/// paragraph-local UTF-16 offset, then calls `onOperation` with a
/// fully-serialized envelope. The parent view forwards the envelope to
/// `RuntimeBridge.appendOperationEnvelope`.
struct RichTextEditorView: NSViewRepresentable {
    let attributed: NSAttributedString
    var isEditable: Bool = false
    /// Fired with a serialized envelope JSON (matches the wire format
    /// expected by `melon_pan_append_operation_envelope`). Callers are
    /// responsible for forwarding to the FFI on a background queue.
    var onOperation: ((String) -> Void)?
    /// Stable token used to compose unique `operationId`s per envelope.
    /// The view appends a monotonically increasing counter; callers
    /// supply the document-id prefix.
    var operationIdPrefix: String = ""
    var documentId: String = ""
    var tabId: String = ""
    var baseRevisionId: String = ""
    var actor: String = ""
    /// Toggle for Vim emulation. The host SwiftUI view binds this to a
    /// settings flag. When true the editor starts in Vim normal mode.
    var vimEnabled: Bool = false
    var colorScheme: String = AppSettings.default.colorScheme
    var editorFontSize: Int = AppSettings.MacExtras.default.editorFontSize
    var editorTabWidth: Int = AppSettings.MacExtras.default.editorTabWidth
    var editorSoftWrap: Bool = AppSettings.MacExtras.default.editorSoftWrap
    var editorShowDiffGutter: Bool = AppSettings.MacExtras.default.editorShowDiffGutter
    /// Fired with the current Vim mode label every time it changes.
    /// The host renders this in the status bar.
    var onVimModeLabelChange: ((MelonPanTextView.VimModeLabel) -> Void)?
    var onVimCommandLineChange: ((String?) -> Void)? = nil
    var onVimExCommand: ((VimController.ExCommand) -> Void)? = nil
    var scrollTarget: RichTextScrollTarget? = nil
    var findReplaceRequest: RichTextFindReplaceRequest? = nil
    var commandRequest: RichTextEditorCommandRequest? = nil
    var onFindReplaceResult: ((RichTextFindReplaceResult) -> Void)? = nil

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = false
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = true

        let contentSize = scrollView.contentSize
        let textStorage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        let textContainer = NSTextContainer(containerSize: NSSize(
            width: contentSize.width,
            height: CGFloat.greatestFiniteMagnitude
        ))
        textContainer.widthTracksTextView = true
        layoutManager.addTextContainer(textContainer)
        textStorage.addLayoutManager(layoutManager)

        let textView = MelonPanTextView(frame: .zero, textContainer: textContainer)
        textView.emitStyleCommand = { [weak coordinator = context.coordinator] command in
            coordinator?.handleStyleCommand(command)
        }
        textView.onVimModeChanged = { [weak coordinator = context.coordinator] label in
            coordinator?.parent.onVimModeLabelChange?(label)
        }
        textView.onVimCommandLineChanged = { [weak coordinator = context.coordinator] commandLine in
            coordinator?.parent.onVimCommandLineChange?(commandLine)
        }
        textView.onVimExCommand = { [weak coordinator = context.coordinator] command in
            coordinator?.parent.onVimExCommand?(command)
        }
        textView.setVimEnabled(vimEnabled)
        textView.minSize = NSSize(width: 0, height: contentSize.height)
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.allowsUndo = true
        textView.isEditable = isEditable
        textView.isSelectable = true
        textView.usesFontPanel = false
        textView.usesFindBar = true
        textView.isRichText = true
        textView.importsGraphics = false
        textView.smartInsertDeleteEnabled = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.textContainerInset = NSSize(width: 24, height: 24)
        applyAppearance(to: textView, in: scrollView)
        // The coordinator is both the textView delegate (for
        // NSTextViewDelegate hooks like attribute toggling on selection)
        // and the textStorage delegate (for raw edit capture).
        textView.delegate = context.coordinator
        textStorage.delegate = context.coordinator
        textView.textStorage?.setAttributedString(attributed)

        context.coordinator.textView = textView
        context.coordinator.parent = self

        scrollView.documentView = textView
        return scrollView
    }

    func updateNSView(_ nsView: NSScrollView, context: Context) {
        guard let textView = nsView.documentView as? MelonPanTextView else { return }
        textView.isEditable = isEditable
        context.coordinator.parent = self
        textView.onVimCommandLineChanged = { [weak coordinator = context.coordinator] commandLine in
            coordinator?.parent.onVimCommandLineChange?(commandLine)
        }
        textView.onVimExCommand = { [weak coordinator = context.coordinator] command in
            coordinator?.parent.onVimExCommand?(command)
        }
        applyAppearance(to: textView, in: nsView)
        if textView.isVimEnabled != vimEnabled {
            textView.setVimEnabled(vimEnabled)
        }
        // Only replace when the attributed payload actually changed —
        // setting the storage on every SwiftUI rerender resets the
        // selection and scroll position.
        if textView.textStorage?.isEqual(to: attributed) != true {
            // Suppress capture during programmatic resets so a doc
            // refresh doesn't generate spurious ops.
            context.coordinator.suppressCapture = true
            textView.textStorage?.setAttributedString(attributed)
            context.coordinator.suppressCapture = false
        }
        context.coordinator.consumeScrollTargetIfNeeded(scrollTarget)
        context.coordinator.consumeFindReplaceRequestIfNeeded(findReplaceRequest)
        context.coordinator.consumeCommandRequestIfNeeded(commandRequest)
    }

    private func applyAppearance(to textView: NSTextView, in scrollView: NSScrollView) {
        let palette = AppThemePalette(name: colorScheme)
        scrollView.backgroundColor = palette.background
        textView.drawsBackground = true
        textView.backgroundColor = palette.background
        textView.textColor = palette.foreground
        textView.insertionPointColor = palette.caret
        textView.selectedTextAttributes = [
            .backgroundColor: palette.selection,
            .foregroundColor: palette.foreground
        ]

        let softWrap = editorSoftWrap
        scrollView.hasHorizontalScroller = !softWrap
        textView.isHorizontallyResizable = !softWrap
        textView.autoresizingMask = softWrap ? [.width] : []
        textView.textContainer?.widthTracksTextView = softWrap
        if softWrap {
            textView.textContainer?.containerSize = NSSize(
                width: scrollView.contentSize.width,
                height: CGFloat.greatestFiniteMagnitude
            )
            textView.maxSize = NSSize(
                width: CGFloat.greatestFiniteMagnitude,
                height: CGFloat.greatestFiniteMagnitude
            )
        } else {
            textView.textContainer?.containerSize = NSSize(
                width: CGFloat.greatestFiniteMagnitude,
                height: CGFloat.greatestFiniteMagnitude
            )
            textView.maxSize = NSSize(
                width: CGFloat.greatestFiniteMagnitude,
                height: CGFloat.greatestFiniteMagnitude
            )
        }

        let tabWidth = max(1, editorTabWidth)
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.defaultTabInterval = CGFloat(tabWidth) * max(7, CGFloat(editorFontSize) * 0.55)
        textView.defaultParagraphStyle = paragraphStyle
        textView.font = NSFont.systemFont(ofSize: CGFloat(max(10, editorFontSize)))
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    final class Coordinator: NSObject, NSTextViewDelegate, NSTextStorageDelegate {
        var parent: RichTextEditorView
        weak var textView: NSTextView?
        var suppressCapture: Bool = false
        private var operationCounter: UInt64 = 0
        private var consumedScrollTargetId: UUID?
        private var consumedFindReplaceRequestId: UUID?
        private var consumedCommandRequestId: UUID?
        private var pendingTypingStyleDelta: RichOperationEnvelopeBuilder.StyleDelta?

        init(parent: RichTextEditorView) {
            self.parent = parent
        }

        // MARK: NSTextViewDelegate

        func textView(
            _ textView: NSTextView,
            shouldChangeTextIn affectedCharRange: NSRange,
            replacementString: String?
        ) -> Bool {
            guard parent.isEditable,
                  let storage = textView.textStorage,
                  storage.length > 0 else {
                return true
            }
            return !rangeTouchesProtectedRenderRange(affectedCharRange, in: storage)
        }

        // MARK: NSTextStorageDelegate

        func textStorage(
            _ textStorage: NSTextStorage,
            didProcessEditing editedMask: NSTextStorageEditActions,
            range editedRange: NSRange,
            changeInLength delta: Int
        ) {
            guard parent.isEditable, !suppressCapture else { return }
            guard editedMask.contains(.editedCharacters) else { return }
            guard let onOperation = parent.onOperation else { return }

            // editedRange is the post-edit range. delta > 0 means
            // characters were inserted; delta < 0 means deleted; delta
            // == 0 means a same-length replace.
            //
            // Resolving paragraph context: read the attributes at the
            // edit's start. After a deletion the storage is shorter, so
            // clamp to a valid index.
            let storageLength = textStorage.length
            let probeIndex = min(editedRange.location, max(0, storageLength - 1))
            guard probeIndex >= 0,
                  let packedId = textStorage.attribute(
                      .melonPanParagraphId,
                      at: probeIndex,
                      effectiveRange: nil
                  ) as? String,
                  let paragraphStart = textStorage.attribute(
                      .melonPanParagraphStart,
                      at: probeIndex,
                      effectiveRange: nil
                  ) as? Int,
                  let paragraphId = RichDocumentModel.NodeId.unpack(packedId) else {
                // Edit landed somewhere with no paragraph attribution —
                // typically the very-end of the storage when the user
                // appends past the last paragraph. Skip rather than
                // emitting a malformed op.
                return
            }

            // UTF-16 offset within the paragraph: storage offsets are
            // already UTF-16 code-unit indexes (NSAttributedString is
            // UTF-16 native), so subtraction is correct.
            let localOffset = max(0, editedRange.location - paragraphStart)
            let envelope: String
            let opId = makeOperationId()

            if delta > 0 {
                // Pure insert — extract the inserted substring from the
                // edited range.
                let insertedNSRange = editedRange
                let inserted = textStorage.attributedSubstring(from: insertedNSRange).string
                envelope = RichOperationEnvelopeBuilder.serialize(
                    operationId: opId,
                    documentId: parent.documentId,
                    tabId: parent.tabId,
                    baseRevisionId: parent.baseRevisionId,
                    actor: parent.actor,
                    op: .insertText(
                        paragraphId: paragraphId,
                        utf16Offset: localOffset,
                        text: inserted
                    )
                )
            } else if delta < 0 {
                // Pure delete — we no longer have the deleted bytes, but
                // the runtime only needs the [start, end) of the original
                // range. End = start + |delta|. The start is where the
                // edit landed; end is start + the count of characters
                // that USED to be there.
                let utf16Start = localOffset
                let utf16End = localOffset + abs(delta)
                envelope = RichOperationEnvelopeBuilder.serialize(
                    operationId: opId,
                    documentId: parent.documentId,
                    tabId: parent.tabId,
                    baseRevisionId: parent.baseRevisionId,
                    actor: parent.actor,
                    op: .deleteRange(
                        paragraphId: paragraphId,
                        utf16Start: utf16Start,
                        utf16End: utf16End
                    )
                )
            } else {
                // Same-length replace (e.g. autocomplete). editedRange is
                // the post-edit range, so the new text is what's there
                // now; the replaced span is the same length.
                let replaced = textStorage
                    .attributedSubstring(from: editedRange)
                    .string
                envelope = RichOperationEnvelopeBuilder.serialize(
                    operationId: opId,
                    documentId: parent.documentId,
                    tabId: parent.tabId,
                    baseRevisionId: parent.baseRevisionId,
                    actor: parent.actor,
                    op: .replaceRange(
                        paragraphId: paragraphId,
                        utf16Start: localOffset,
                        utf16End: localOffset + editedRange.length,
                        text: replaced
                    )
                )
            }

            onOperation(envelope)
            if delta > 0,
               editedRange.length > 0,
               let typingStyleDelta = pendingTypingStyleDelta {
                onOperation(RichOperationEnvelopeBuilder.serialize(
                    operationId: makeOperationId(),
                    documentId: parent.documentId,
                    tabId: parent.tabId,
                    baseRevisionId: parent.baseRevisionId,
                    actor: parent.actor,
                    op: .setTextStyle(
                        paragraphId: paragraphId,
                        utf16Start: localOffset,
                        utf16End: localOffset + editedRange.length,
                        delta: typingStyleDelta
                    )
                ))
            }
        }

        private func makeOperationId() -> String {
            operationCounter &+= 1
            let prefix = parent.operationIdPrefix.isEmpty ? "op" : parent.operationIdPrefix
            return "\(prefix)-\(operationCounter)-\(UInt64(Date().timeIntervalSince1970 * 1000))"
        }

        func consumeScrollTargetIfNeeded(_ target: RichTextScrollTarget?) {
            guard let target,
                  consumedScrollTargetId != target.id,
                  let textView,
                  let storage = textView.textStorage else { return }
            consumedScrollTargetId = target.id
            let fullRange = NSRange(location: 0, length: storage.length)
            var match: NSRange?
            storage.enumerateAttribute(.melonPanParagraphId, in: fullRange) { value, range, stop in
                guard value as? String == target.paragraphId else { return }
                match = range
                stop.pointee = true
            }
            guard let match else { return }
            textView.setSelectedRange(NSRange(location: match.location, length: 0))
            textView.scrollRangeToVisible(match)
            textView.window?.makeFirstResponder(textView)
        }

        func consumeFindReplaceRequestIfNeeded(_ request: RichTextFindReplaceRequest?) {
            guard let request,
                  consumedFindReplaceRequestId != request.id else { return }
            consumedFindReplaceRequestId = request.id
            switch request.action {
            case .findNext:
                let matched = findNext(request)
                parent.onFindReplaceResult?(RichTextFindReplaceResult(
                    matched: matched ? 1 : 0,
                    replaced: 0
                ))
            case .replaceSelection:
                let replaced = replaceSelectionOrNext(request)
                parent.onFindReplaceResult?(RichTextFindReplaceResult(
                    matched: replaced ? 1 : 0,
                    replaced: replaced ? 1 : 0
                ))
            case .replaceAll:
                let replaced = replaceAll(request)
                parent.onFindReplaceResult?(RichTextFindReplaceResult(
                    matched: replaced,
                    replaced: replaced
                ))
            }
        }

        func consumeCommandRequestIfNeeded(_ request: RichTextEditorCommandRequest?) {
            guard let request,
                  consumedCommandRequestId != request.id,
                  let textView = textView as? MelonPanTextView else { return }
            consumedCommandRequestId = request.id
            textView.performEditorCommand(request.command)
        }

        private func findNext(_ request: RichTextFindReplaceRequest) -> Bool {
            guard !request.find.isEmpty,
                  let textView,
                  let storage = textView.textStorage else { return false }
            let searchRange = nextSearchRange(in: storage, after: textView.selectedRange())
            guard let match = find(request.find, in: storage.string, range: searchRange, caseSensitive: request.caseSensitive)
                    ?? find(request.find, in: storage.string, range: NSRange(location: 0, length: storage.length), caseSensitive: request.caseSensitive)
            else { return false }
            textView.setSelectedRange(match)
            textView.scrollRangeToVisible(match)
            textView.window?.makeFirstResponder(textView)
            return true
        }

        private func replaceSelectionOrNext(_ request: RichTextFindReplaceRequest) -> Bool {
            guard !request.find.isEmpty,
                  let textView,
                  let storage = textView.textStorage else { return false }
            let selection = textView.selectedRange()
            let selectionMatches = selection.length > 0
                && selection.location + selection.length <= storage.length
                && compare(storage.attributedSubstring(from: selection).string, request.find, caseSensitive: request.caseSensitive)
            if selectionMatches {
                return replace(match: selection, with: request.replacement)
            }
            guard findNext(request) else { return false }
            return replace(match: textView.selectedRange(), with: request.replacement)
        }

        private func replaceAll(_ request: RichTextFindReplaceRequest) -> Int {
            guard !request.find.isEmpty,
                  let textView,
                  let storage = textView.textStorage else { return 0 }
            var matches: [NSRange] = []
            var cursor = 0
            while cursor < storage.length {
                let range = NSRange(location: cursor, length: storage.length - cursor)
                guard let match = find(request.find, in: storage.string, range: range, caseSensitive: request.caseSensitive) else {
                    break
                }
                if !rangeTouchesProtectedRenderRange(match, in: storage),
                   replacementContext(for: match, in: storage) != nil {
                    matches.append(match)
                }
                cursor = max(match.location + max(1, match.length), cursor + 1)
            }
            var replaced = 0
            for match in matches.sorted(by: { $0.location > $1.location }) {
                if replace(match: match, with: request.replacement) {
                    replaced += 1
                }
            }
            if let first = matches.first {
                textView.setSelectedRange(NSRange(location: first.location, length: request.replacement.utf16.count))
                textView.scrollRangeToVisible(textView.selectedRange())
            }
            return replaced
        }

        private func replace(match: NSRange, with replacement: String) -> Bool {
            guard parent.isEditable,
                  let onOperation = parent.onOperation,
                  let textView,
                  let storage = textView.textStorage,
                  match.location != NSNotFound,
                  match.location + match.length <= storage.length,
                  !rangeTouchesProtectedRenderRange(match, in: storage),
                  let context = replacementContext(for: match, in: storage)
            else { return false }
            let oldText = storage.attributedSubstring(from: match).string
            let op: RichOperationEnvelopeBuilder.Op = .replaceRange(
                paragraphId: context.paragraphId,
                utf16Start: context.utf16Start,
                utf16End: context.utf16End,
                text: replacement
            )
            emitUndoableOperation(
                op,
                inverse: .replaceRange(
                    paragraphId: context.paragraphId,
                    utf16Start: context.utf16Start,
                    utf16End: context.utf16Start + replacement.utf16.count,
                    text: oldText
                ),
                actionName: "Replace",
                onOperation: onOperation
            )
            suppressCapture = true
            storage.replaceCharacters(in: match, with: replacement)
            suppressCapture = false
            let selected = NSRange(location: match.location, length: replacement.utf16.count)
            textView.setSelectedRange(selected)
            textView.scrollRangeToVisible(selected)
            textView.window?.makeFirstResponder(textView)
            return true
        }

        private struct ReplacementContext {
            let paragraphId: RichDocumentModel.NodeId
            let utf16Start: Int
            let utf16End: Int
        }

        private func replacementContext(
            for range: NSRange,
            in storage: NSTextStorage
        ) -> ReplacementContext? {
            guard range.length > 0,
                  range.location + range.length <= storage.length,
                  let packedId = storage.attribute(.melonPanParagraphId, at: range.location, effectiveRange: nil) as? String,
                  let paragraphStart = storage.attribute(.melonPanParagraphStart, at: range.location, effectiveRange: nil) as? Int,
                  let paragraphId = RichDocumentModel.NodeId.unpack(packedId)
            else { return nil }
            let endIndex = max(0, range.location + range.length - 1)
            guard storage.attribute(.melonPanParagraphId, at: endIndex, effectiveRange: nil) as? String == packedId else {
                return nil
            }
            let utf16Start = max(0, range.location - paragraphStart)
            return ReplacementContext(
                paragraphId: paragraphId,
                utf16Start: utf16Start,
                utf16End: utf16Start + range.length
            )
        }

        private func nextSearchRange(in storage: NSTextStorage, after selection: NSRange) -> NSRange {
            let start = min(storage.length, max(0, selection.location + max(1, selection.length)))
            return NSRange(location: start, length: storage.length - start)
        }

        private func find(
            _ needle: String,
            in haystack: String,
            range: NSRange,
            caseSensitive: Bool
        ) -> NSRange? {
            guard !needle.isEmpty, range.length >= 0 else { return nil }
            let options: NSString.CompareOptions = caseSensitive ? [] : [.caseInsensitive]
            let match = (haystack as NSString).range(of: needle, options: options, range: range)
            return match.location == NSNotFound ? nil : match
        }

        private func compare(_ left: String, _ right: String, caseSensitive: Bool) -> Bool {
            caseSensitive ? left == right : left.caseInsensitiveCompare(right) == .orderedSame
        }

        private func emitOperation(
            _ op: RichOperationEnvelopeBuilder.Op,
            onOperation: @escaping (String) -> Void
        ) -> String {
            let operationId = makeOperationId()
            onOperation(RichOperationEnvelopeBuilder.serialize(
                operationId: operationId,
                documentId: parent.documentId,
                tabId: parent.tabId,
                baseRevisionId: parent.baseRevisionId,
                actor: parent.actor,
                op: op
            ))
            return operationId
        }

        private func emitUndoableOperation(
            _ op: RichOperationEnvelopeBuilder.Op,
            inverse: RichOperationEnvelopeBuilder.Op?,
            actionName: String,
            onOperation: @escaping (String) -> Void
        ) {
            _ = emitOperation(op, onOperation: onOperation)
            guard let inverse else { return }
            registerOperationUndo(undo: inverse, redo: op, actionName: actionName)
        }

        private func emitCancellableOperation(
            _ op: RichOperationEnvelopeBuilder.Op,
            actionName: String,
            onOperation: @escaping (String) -> Void
        ) {
            let operationId = emitOperation(op, onOperation: onOperation)
            registerCancellationUndo(
                targetOperationId: operationId,
                redo: op,
                actionName: actionName
            )
        }

        private func registerOperationUndo(
            undo: RichOperationEnvelopeBuilder.Op,
            redo: RichOperationEnvelopeBuilder.Op,
            actionName: String
        ) {
            guard let undoManager = textView?.undoManager else { return }
            undoManager.registerUndo(withTarget: self) { coordinator in
                coordinator.applyUndoableOperation(undo, inverse: redo, actionName: actionName)
            }
            undoManager.setActionName(actionName)
        }

        private func applyUndoableOperation(
            _ op: RichOperationEnvelopeBuilder.Op,
            inverse: RichOperationEnvelopeBuilder.Op,
            actionName: String
        ) {
            guard parent.isEditable,
                  let onOperation = parent.onOperation else { return }
            _ = emitOperation(op, onOperation: onOperation)
            registerOperationUndo(undo: inverse, redo: op, actionName: actionName)
        }

        private func registerCancellationUndo(
            targetOperationId: String,
            redo: RichOperationEnvelopeBuilder.Op,
            actionName: String
        ) {
            guard let undoManager = textView?.undoManager else { return }
            undoManager.registerUndo(withTarget: self) { coordinator in
                coordinator.cancelOperationAndRegisterRedo(
                    targetOperationId: targetOperationId,
                    redo: redo,
                    actionName: actionName
                )
            }
            undoManager.setActionName(actionName)
        }

        private func cancelOperationAndRegisterRedo(
            targetOperationId: String,
            redo: RichOperationEnvelopeBuilder.Op,
            actionName: String
        ) {
            guard parent.isEditable,
                  let onOperation = parent.onOperation,
                  let undoManager = textView?.undoManager else { return }
            _ = emitOperation(.cancelOperation(operationId: targetOperationId), onOperation: onOperation)
            undoManager.registerUndo(withTarget: self) { coordinator in
                coordinator.redoCancellableOperation(redo, actionName: actionName)
            }
            undoManager.setActionName(actionName)
        }

        private func redoCancellableOperation(
            _ op: RichOperationEnvelopeBuilder.Op,
            actionName: String
        ) {
            guard parent.isEditable,
                  let onOperation = parent.onOperation else { return }
            let operationId = emitOperation(op, onOperation: onOperation)
            registerCancellationUndo(
                targetOperationId: operationId,
                redo: op,
                actionName: actionName
            )
        }

        // MARK: Style commands (Cmd-B / I / U / K)

        /// Translate a style shortcut into a SetTextStyle / CreateLink
        /// envelope for the current selection. The selection MUST sit
        /// inside a single paragraph; cross-paragraph selections are
        /// dropped silently for V1 because the op model addresses one
        /// paragraph at a time.
        func handleStyleCommand(_ command: MelonPanTextView.StyleCommand) {
            guard parent.isEditable,
                  let textView,
                  let storage = textView.textStorage else { return }
            let selection = textView.selectedRange()
            guard selection.location != NSNotFound,
                  selection.location <= storage.length else { return }
            guard let onOperation = parent.onOperation else { return }

            // List-toggle commands work on the paragraph at the caret;
            // selection length is irrelevant. Branch early so the
            // text-style code below only runs for non-empty selections.
            if case .toggleNumberedList = command {
                emitListToggle(storage: storage, location: selection.location, ordered: true, onOperation: onOperation)
                return
            }
            if case .toggleBulletedList = command {
                emitListToggle(storage: storage, location: selection.location, ordered: false, onOperation: onOperation)
                return
            }
            if case .listIndent = command {
                emitListNestingDelta(storage: storage, location: selection.location, delta: 1, onOperation: onOperation)
                return
            }
            if case .listOutdent = command {
                emitListNestingDelta(storage: storage, location: selection.location, delta: -1, onOperation: onOperation)
                return
            }
            if let alignment = paragraphAlignment(for: command) {
                emitParagraphAlignment(storage: storage, location: selection.location, alignment: alignment, onOperation: onOperation)
                return
            }
            if case let .setParagraphNamedStyle(namedStyle) = command {
                emitParagraphNamedStyle(storage: storage, location: selection.location, namedStyle: namedStyle, onOperation: onOperation)
                return
            }
            if case let .insertTable(rows, columns) = command {
                emitInsertTable(storage: storage, location: selection.location, rows: rows, columns: columns, onOperation: onOperation)
                return
            }
            if let tableOp = tableOperation(for: command) {
                emitTableOperation(storage: storage, location: selection.location, tableOp: tableOp, onOperation: onOperation)
                return
            }
            if case let .insertInlineImage(uri) = command {
                emitInsertInlineImage(storage: storage, location: selection.location, uri: uri, onOperation: onOperation)
                return
            }
            if case .deleteInlineObject = command {
                emitDeleteInlineObject(storage: storage, location: selection.location, onOperation: onOperation)
                return
            }
            if isSegmentCommand(command) {
                emitSegmentOperation(storage: storage, location: selection.location, command: command, onOperation: onOperation)
                return
            }

            if selection.length == 0, applyTypingStyleCommand(command, textView: textView, storage: storage) {
                return
            }

            guard selection.length > 0,
                  selection.location + selection.length <= storage.length,
                  !rangeTouchesProtectedRenderRange(selection, in: storage) else { return }

            // Resolve paragraph at selection start.
            guard let packedId = storage.attribute(
                .melonPanParagraphId,
                at: selection.location,
                effectiveRange: nil
            ) as? String,
            let paragraphStart = storage.attribute(
                .melonPanParagraphStart,
                at: selection.location,
                effectiveRange: nil
            ) as? Int,
            let paragraphId = RichDocumentModel.NodeId.unpack(packedId) else {
                return
            }

            // Verify the selection ends inside the same paragraph. If
            // the user selected across two paragraphs the attribute at
            // selection-end will carry a different id; bail rather than
            // emit a malformed op.
            if let endPackedId = storage.attribute(
                .melonPanParagraphId,
                at: max(0, selection.location + selection.length - 1),
                effectiveRange: nil
            ) as? String, endPackedId != packedId {
                return
            }

            let utf16Start = max(0, selection.location - paragraphStart)
            let utf16End = utf16Start + selection.length
            let opId = makeOperationId()
            let beforeSnapshot = storage.attributedSubstring(from: selection)

            let opCase: RichOperationEnvelopeBuilder.Op
            switch command {
            case .bold:
                let currentlyBold = isAttributeOnAt(storage, .font, at: selection.location) {
                    ($0 as? NSFont)?.fontDescriptor.symbolicTraits.contains(.bold) == true
                }
                var delta = RichOperationEnvelopeBuilder.StyleDelta()
                delta.bold = !currentlyBold
                opCase = .setTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    delta: delta
                )
            case .italic:
                let currentlyItalic = isAttributeOnAt(storage, .font, at: selection.location) {
                    ($0 as? NSFont)?.fontDescriptor.symbolicTraits.contains(.italic) == true
                }
                var delta = RichOperationEnvelopeBuilder.StyleDelta()
                delta.italic = !currentlyItalic
                opCase = .setTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    delta: delta
                )
            case .underline:
                let currentlyUnderlined = isAttributeOnAt(storage, .underlineStyle, at: selection.location) { value in
                    if let raw = value as? Int { return raw != 0 }
                    if let raw = value as? NSNumber { return raw.intValue != 0 }
                    return false
                }
                var delta = RichOperationEnvelopeBuilder.StyleDelta()
                delta.underline = !currentlyUnderlined
                opCase = .setTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    delta: delta
                )
            case .clearFormatting:
                opCase = .clearTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End
                )
            case .setFontFamilyTimes:
                var delta = RichOperationEnvelopeBuilder.StyleDelta()
                delta.fontFamily = .some("Times New Roman")
                opCase = .setTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    delta: delta
                )
            case let .setFont(familyName, sizePt):
                var delta = RichOperationEnvelopeBuilder.StyleDelta()
                delta.fontFamily = .some(familyName)
                delta.fontSizePt = .some(sizePt)
                opCase = .setTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    delta: delta
                )
            case let .setFontSize(sizePt):
                var delta = RichOperationEnvelopeBuilder.StyleDelta()
                delta.fontSizePt = .some(sizePt)
                opCase = .setTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    delta: delta
                )
            case .increaseFontSize:
                let current = (storage.attribute(
                    .font,
                    at: selection.location,
                    effectiveRange: nil
                ) as? NSFont)?.pointSize ?? 14
                var delta = RichOperationEnvelopeBuilder.StyleDelta()
                delta.fontSizePt = .some(Double(current + 1))
                opCase = .setTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    delta: delta
                )
            case .decreaseFontSize:
                let current = (storage.attribute(
                    .font,
                    at: selection.location,
                    effectiveRange: nil
                ) as? NSFont)?.pointSize ?? 14
                var delta = RichOperationEnvelopeBuilder.StyleDelta()
                delta.fontSizePt = .some(Double(max(6, current - 1)))
                opCase = .setTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    delta: delta
                )
            case .setTextColorRed:
                var delta = RichOperationEnvelopeBuilder.StyleDelta()
                delta.foregroundColor = .some(RichOperationEnvelopeBuilder.RGBColor(
                    red: 0.82,
                    green: 0.12,
                    blue: 0.12
                ))
                opCase = .setTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    delta: delta
                )
            case let .setTextColor(color):
                var delta = RichOperationEnvelopeBuilder.StyleDelta()
                delta.foregroundColor = .some(RichOperationEnvelopeBuilder.RGBColor(
                    red: color.red,
                    green: color.green,
                    blue: color.blue
                ))
                opCase = .setTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    delta: delta
                )
            case .setTextBackgroundYellow:
                var delta = RichOperationEnvelopeBuilder.StyleDelta()
                delta.backgroundColor = .some(RichOperationEnvelopeBuilder.RGBColor(
                    red: 1.0,
                    green: 0.92,
                    blue: 0.35
                ))
                opCase = .setTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    delta: delta
                )
            case let .setTextBackgroundColor(color):
                var delta = RichOperationEnvelopeBuilder.StyleDelta()
                delta.backgroundColor = .some(RichOperationEnvelopeBuilder.RGBColor(
                    red: color.red,
                    green: color.green,
                    blue: color.blue
                ))
                opCase = .setTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    delta: delta
                )
            case .clearFontAndColors:
                var delta = RichOperationEnvelopeBuilder.StyleDelta()
                delta.fontFamily = .some(nil)
                delta.fontSizePt = .some(nil)
                delta.foregroundColor = .some(nil)
                delta.backgroundColor = .some(nil)
                opCase = .setTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    delta: delta
                )
            case let .link(url):
                opCase = .createLink(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End,
                    url: url
                )
            case .toggleNumberedList, .toggleBulletedList, .listIndent, .listOutdent,
                 .alignLeft, .alignCenter, .alignRight, .alignJustified,
                 .setParagraphNamedStyle,
                 .insertTable, .insertTableRowAbove, .insertTableRowBelow, .deleteTableRow,
                 .insertTableColumnLeft, .insertTableColumnRight, .deleteTableColumn, .deleteTable,
                 .setTableCellBackgroundYellow, .setTableCellBackgroundColor,
                 .clearTableCellBackground, .setTableCellBorderThin,
                 .setTableCellBorderColor, .setTableCellBorderDashStyle,
                 .setTableCellTopBorderThin, .setTableCellRightBorderThin,
                 .setTableCellBottomBorderThin, .setTableCellLeftBorderThin,
                 .clearTableCellBorder, .clearTableCellTopBorder,
                 .clearTableCellRightBorder, .clearTableCellBottomBorder,
                 .clearTableCellLeftBorder, .resizeTableColumn, .resizeTableRow,
                 .setTableCellVerticalAlignment, .clearTableCellVerticalAlignment,
                 .increaseTableCellPadding, .decreaseTableCellPadding, .clearTableCellPadding,
                 .mergeSelectedTableCells, .unmergeTableCell,
                 .insertInlineImage, .deleteInlineObject,
                 .createHeader, .deleteCurrentHeader, .createFooter, .deleteCurrentFooter,
                 .createFootnote, .deleteCurrentFootnote:
                // Handled above by paragraph/table emitters; the early
                // return means we never reach here. Compiler
                // exhaustiveness alone forces this branch to exist.
                return
            }

            onOperation(RichOperationEnvelopeBuilder.serialize(
                operationId: opId,
                documentId: parent.documentId,
                tabId: parent.tabId,
                baseRevisionId: parent.baseRevisionId,
                actor: parent.actor,
                op: opCase
            ))
            applyOptimisticStyleCommand(command, range: selection, storage: storage)
            registerStyleUndo(range: selection, beforeSnapshot: beforeSnapshot)
        }

        private func applyTypingStyleCommand(
            _ command: MelonPanTextView.StyleCommand,
            textView: NSTextView,
            storage: NSTextStorage
        ) -> Bool {
            guard command.canApplyAtInsertionPoint else { return false }
            let selection = textView.selectedRange()
            var attrs = currentTypingAttributes(textView: textView, storage: storage, location: selection.location)
            guard let delta = typingStyleDelta(for: command, attributes: attrs) else { return false }

            let sample = NSTextStorage(string: "x", attributes: attrs)
            applyOptimisticStyleCommand(command, range: NSRange(location: 0, length: 1), storage: sample)
            attrs = sample.attributes(at: 0, effectiveRange: nil)
            textView.typingAttributes = attrs
            pendingTypingStyleDelta = mergingStyleDelta(pendingTypingStyleDelta, with: delta)
            return true
        }

        private func currentTypingAttributes(
            textView: NSTextView,
            storage: NSTextStorage,
            location: Int
        ) -> [NSAttributedString.Key: Any] {
            let typingAttrs = textView.typingAttributes
            var attrs = typingAttrs
            if storage.length > 0 {
                let probe = min(max(0, location == storage.length ? location - 1 : location), storage.length - 1)
                attrs = storage.attributes(at: probe, effectiveRange: nil)
                for key in [
                    NSAttributedString.Key.font,
                    .underlineStyle,
                    .strikethroughStyle,
                    .foregroundColor,
                    .backgroundColor,
                    .link
                ] {
                    if let value = typingAttrs[key] {
                        attrs[key] = value
                    }
                }
            }
            if attrs[.font] == nil {
                attrs[.font] = NSFont.systemFont(ofSize: CGFloat(max(10, parent.editorFontSize)))
            }
            return attrs
        }

        private func typingStyleDelta(
            for command: MelonPanTextView.StyleCommand,
            attributes attrs: [NSAttributedString.Key: Any]
        ) -> RichOperationEnvelopeBuilder.StyleDelta? {
            var delta = RichOperationEnvelopeBuilder.StyleDelta()
            switch command {
            case .bold:
                delta.bold = !fontTraits(in: attrs).contains(.bold)
            case .italic:
                delta.italic = !fontTraits(in: attrs).contains(.italic)
            case .underline:
                delta.underline = !isUnderlineEnabled(in: attrs)
            case .clearFormatting:
                delta.bold = false
                delta.italic = false
                delta.underline = false
                delta.strikethrough = false
                delta.fontFamily = .some(nil)
                delta.fontSizePt = .some(nil)
                delta.foregroundColor = .some(nil)
                delta.backgroundColor = .some(nil)
                delta.linkUrl = .some(nil)
            case .setFontFamilyTimes:
                delta.fontFamily = .some("Times New Roman")
            case let .setFont(familyName, sizePt):
                delta.fontFamily = .some(familyName)
                delta.fontSizePt = .some(sizePt)
            case let .setFontSize(sizePt):
                delta.fontSizePt = .some(sizePt)
            case .increaseFontSize:
                delta.fontSizePt = .some(Double(currentFont(in: attrs).pointSize + 1))
            case .decreaseFontSize:
                delta.fontSizePt = .some(Double(max(6, currentFont(in: attrs).pointSize - 1)))
            case .setTextColorRed:
                delta.foregroundColor = .some(RichOperationEnvelopeBuilder.RGBColor(
                    red: 0.82,
                    green: 0.12,
                    blue: 0.12
                ))
            case let .setTextColor(color):
                delta.foregroundColor = .some(RichOperationEnvelopeBuilder.RGBColor(
                    red: color.red,
                    green: color.green,
                    blue: color.blue
                ))
            case .setTextBackgroundYellow:
                delta.backgroundColor = .some(RichOperationEnvelopeBuilder.RGBColor(
                    red: 1.0,
                    green: 0.92,
                    blue: 0.35
                ))
            case let .setTextBackgroundColor(color):
                delta.backgroundColor = .some(RichOperationEnvelopeBuilder.RGBColor(
                    red: color.red,
                    green: color.green,
                    blue: color.blue
                ))
            case .clearFontAndColors:
                delta.fontFamily = .some(nil)
                delta.fontSizePt = .some(nil)
                delta.foregroundColor = .some(nil)
                delta.backgroundColor = .some(nil)
            default:
                return nil
            }
            return delta
        }

        private func mergingStyleDelta(
            _ existing: RichOperationEnvelopeBuilder.StyleDelta?,
            with delta: RichOperationEnvelopeBuilder.StyleDelta
        ) -> RichOperationEnvelopeBuilder.StyleDelta {
            var result = existing ?? RichOperationEnvelopeBuilder.StyleDelta()
            if delta.bold != nil { result.bold = delta.bold }
            if delta.italic != nil { result.italic = delta.italic }
            if delta.underline != nil { result.underline = delta.underline }
            if delta.strikethrough != nil { result.strikethrough = delta.strikethrough }
            if delta.fontFamily != nil { result.fontFamily = delta.fontFamily }
            if delta.fontSizePt != nil { result.fontSizePt = delta.fontSizePt }
            if delta.foregroundColor != nil { result.foregroundColor = delta.foregroundColor }
            if delta.backgroundColor != nil { result.backgroundColor = delta.backgroundColor }
            if delta.linkUrl != nil { result.linkUrl = delta.linkUrl }
            return result
        }

        private func currentFont(in attrs: [NSAttributedString.Key: Any]) -> NSFont {
            attrs[.font] as? NSFont ?? NSFont.systemFont(ofSize: CGFloat(max(10, parent.editorFontSize)))
        }

        private func fontTraits(in attrs: [NSAttributedString.Key: Any]) -> NSFontDescriptor.SymbolicTraits {
            currentFont(in: attrs).fontDescriptor.symbolicTraits
        }

        private func isUnderlineEnabled(in attrs: [NSAttributedString.Key: Any]) -> Bool {
            if let raw = attrs[.underlineStyle] as? Int { return raw != 0 }
            if let raw = attrs[.underlineStyle] as? NSNumber { return raw.intValue != 0 }
            return false
        }

        private func registerStyleUndo(range: NSRange, beforeSnapshot: NSAttributedString) {
            guard let textView,
                  let undoManager = textView.undoManager,
                  range.length == beforeSnapshot.length else {
                return
            }
            undoManager.registerUndo(withTarget: self) { coordinator in
                coordinator.restoreStyleSnapshot(beforeSnapshot, range: range)
            }
            undoManager.setActionName("Formatting")
        }

        private func restoreStyleSnapshot(_ snapshot: NSAttributedString, range: NSRange) {
            guard parent.isEditable,
                  let textView,
                  let storage = textView.textStorage,
                  let onOperation = parent.onOperation,
                  range.location != NSNotFound,
                  range.length == snapshot.length,
                  NSMaxRange(range) <= storage.length else {
                return
            }
            let redoSnapshot = storage.attributedSubstring(from: range)

            suppressCapture = true
            storage.beginEditing()
            storage.replaceCharacters(in: range, with: snapshot)
            storage.endEditing()
            suppressCapture = false

            textView.setSelectedRange(range)
            emitStyleSnapshotOperations(snapshot, globalRange: range, storage: storage, onOperation: onOperation)

            textView.undoManager?.registerUndo(withTarget: self) { coordinator in
                coordinator.restoreStyleSnapshot(redoSnapshot, range: range)
            }
            textView.undoManager?.setActionName("Formatting")
        }

        private func emitStyleSnapshotOperations(
            _ snapshot: NSAttributedString,
            globalRange: NSRange,
            storage: NSTextStorage,
            onOperation: @escaping (String) -> Void
        ) {
            guard globalRange.length > 0,
                  NSMaxRange(globalRange) <= storage.length,
                  let packedId = storage.attribute(
                      .melonPanParagraphId,
                      at: globalRange.location,
                      effectiveRange: nil
                  ) as? String,
                  let paragraphStart = storage.attribute(
                      .melonPanParagraphStart,
                      at: globalRange.location,
                      effectiveRange: nil
                  ) as? Int,
                  let paragraphId = RichDocumentModel.NodeId.unpack(packedId) else {
                return
            }
            if let endPackedId = storage.attribute(
                .melonPanParagraphId,
                at: max(0, NSMaxRange(globalRange) - 1),
                effectiveRange: nil
            ) as? String, endPackedId != packedId {
                return
            }

            let utf16Start = max(0, globalRange.location - paragraphStart)
            let utf16End = utf16Start + globalRange.length
            onOperation(RichOperationEnvelopeBuilder.serialize(
                operationId: makeOperationId(),
                documentId: parent.documentId,
                tabId: parent.tabId,
                baseRevisionId: parent.baseRevisionId,
                actor: parent.actor,
                op: .clearTextStyle(
                    paragraphId: paragraphId,
                    utf16Start: utf16Start,
                    utf16End: utf16End
                )
            ))

            snapshot.enumerateAttributes(
                in: NSRange(location: 0, length: snapshot.length),
                options: []
            ) { attrs, localRange, _ in
                guard localRange.length > 0 else { return }
                let delta = styleDelta(from: attrs)
                onOperation(RichOperationEnvelopeBuilder.serialize(
                    operationId: makeOperationId(),
                    documentId: parent.documentId,
                    tabId: parent.tabId,
                    baseRevisionId: parent.baseRevisionId,
                    actor: parent.actor,
                    op: .setTextStyle(
                        paragraphId: paragraphId,
                        utf16Start: utf16Start + localRange.location,
                        utf16End: utf16Start + localRange.location + localRange.length,
                        delta: delta
                    )
                ))
            }
        }

        private func styleDelta(from attrs: [NSAttributedString.Key: Any]) -> RichOperationEnvelopeBuilder.StyleDelta {
            var delta = RichOperationEnvelopeBuilder.StyleDelta()
            let font = attrs[.font] as? NSFont
            let traits = font?.fontDescriptor.symbolicTraits ?? []
            delta.bold = traits.contains(.bold)
            delta.italic = traits.contains(.italic)
            delta.underline = {
                let value = attrs[.underlineStyle]
                if let raw = value as? Int { return raw != 0 }
                if let raw = value as? NSNumber { return raw.intValue != 0 }
                return false
            }()
            if let font {
                if let familyName = font.familyName, !familyName.hasPrefix(".") {
                    delta.fontFamily = .some(familyName)
                }
                delta.fontSizePt = .some(Double(font.pointSize))
            }
            if let color = attrs[.foregroundColor] as? NSColor,
               let rgb = rgbColor(from: color) {
                delta.foregroundColor = .some(rgb)
            }
            if let color = attrs[.backgroundColor] as? NSColor,
               let rgb = rgbColor(from: color) {
                delta.backgroundColor = .some(rgb)
            }
            if let url = attrs[.link] as? URL {
                delta.linkUrl = .some(url.absoluteString)
            } else if let url = attrs[.link] as? String {
                delta.linkUrl = .some(url)
            }
            return delta
        }

        private func rgbColor(from color: NSColor) -> RichOperationEnvelopeBuilder.RGBColor? {
            guard let converted = color.usingColorSpace(.sRGB) else { return nil }
            return RichOperationEnvelopeBuilder.RGBColor(
                red: Double(converted.redComponent),
                green: Double(converted.greenComponent),
                blue: Double(converted.blueComponent)
            )
        }

        private func paragraphAlignment(for command: MelonPanTextView.StyleCommand) -> String? {
            switch command {
            case .alignLeft: return "START"
            case .alignCenter: return "CENTER"
            case .alignRight: return "END"
            case .alignJustified: return "JUSTIFIED"
            default: return nil
            }
        }

        fileprivate func emitParagraphAlignment(
            storage: NSTextStorage,
            location: Int,
            alignment: String,
            onOperation: @escaping (String) -> Void
        ) {
            let probe = min(location, max(0, storage.length - 1))
            guard probe >= 0,
                  let packedId = storage.attribute(
                      .melonPanParagraphId,
                      at: probe,
                      effectiveRange: nil
                  ) as? String,
                  let paragraphId = RichDocumentModel.NodeId.unpack(packedId) else {
                return
            }
            let previousAlignment = paragraphAlignmentString(
                storage.attribute(.paragraphStyle, at: probe, effectiveRange: nil) as? NSParagraphStyle
            ) ?? "START"
            let op: RichOperationEnvelopeBuilder.Op = .setParagraphStyle(
                paragraphId: paragraphId,
                delta: RichOperationEnvelopeBuilder.ParagraphStyleDelta(alignment: alignment)
            )
            let inverse: RichOperationEnvelopeBuilder.Op = .setParagraphStyle(
                paragraphId: paragraphId,
                delta: RichOperationEnvelopeBuilder.ParagraphStyleDelta(alignment: previousAlignment)
            )
            emitUndoableOperation(
                op,
                inverse: inverse,
                actionName: "Alignment",
                onOperation: onOperation
            )
        }

        private func paragraphAlignmentString(_ style: NSParagraphStyle?) -> String? {
            switch style?.alignment {
            case .some(.center):
                return "CENTER"
            case .some(.right):
                return "END"
            case .some(.justified):
                return "JUSTIFIED"
            case .some(.left), .some(.natural):
                return "START"
            default:
                return nil
            }
        }

        fileprivate func emitParagraphNamedStyle(
            storage: NSTextStorage,
            location: Int,
            namedStyle: String,
            onOperation: @escaping (String) -> Void
        ) {
            let probe = min(location, max(0, storage.length - 1))
            guard probe >= 0,
                  let packedId = storage.attribute(
                      .melonPanParagraphId,
                      at: probe,
                      effectiveRange: nil
                  ) as? String,
                  let paragraphId = RichDocumentModel.NodeId.unpack(packedId) else {
                return
            }
            let previousStyle = (storage.attribute(
                .melonPanNamedStyle,
                at: probe,
                effectiveRange: nil
            ) as? String) ?? "NORMAL_TEXT"
            let op: RichOperationEnvelopeBuilder.Op = .setParagraphNamedStyle(
                paragraphId: paragraphId,
                namedStyle: namedStyle
            )
            let inverse: RichOperationEnvelopeBuilder.Op = .setParagraphNamedStyle(
                paragraphId: paragraphId,
                namedStyle: previousStyle
            )
            emitUndoableOperation(
                op,
                inverse: inverse,
                actionName: "Paragraph Style",
                onOperation: onOperation
            )
        }

        private enum TableOperation {
            case insertRowAbove
            case insertRowBelow
            case deleteRow
            case insertColumnLeft
            case insertColumnRight
            case deleteColumn
            case deleteTable
            case setBackgroundYellow
            case setBackgroundColor(MelonPanTextView.StyleCommand.RGBColor)
            case clearBackground
            case setBorderThin
            case setBorderColor(MelonPanTextView.StyleCommand.RGBColor)
            case setBorderDashStyle(String)
            case setTopBorderThin
            case setRightBorderThin
            case setBottomBorderThin
            case setLeftBorderThin
            case clearBorder
            case clearTopBorder
            case clearRightBorder
            case clearBottomBorder
            case clearLeftBorder
            case resizeColumn(Double)
            case resizeRow(Double)
            case setVerticalAlignment(String)
            case clearVerticalAlignment
            case increasePadding
            case decreasePadding
            case clearPadding
            case mergeSelected
            case unmerge
        }

        private func tableOperation(for command: MelonPanTextView.StyleCommand) -> TableOperation? {
            switch command {
            case .insertTableRowAbove: return .insertRowAbove
            case .insertTableRowBelow: return .insertRowBelow
            case .deleteTableRow: return .deleteRow
            case .insertTableColumnLeft: return .insertColumnLeft
            case .insertTableColumnRight: return .insertColumnRight
            case .deleteTableColumn: return .deleteColumn
            case .deleteTable: return .deleteTable
            case .setTableCellBackgroundYellow: return .setBackgroundYellow
            case let .setTableCellBackgroundColor(color): return .setBackgroundColor(color)
            case .clearTableCellBackground: return .clearBackground
            case .setTableCellBorderThin: return .setBorderThin
            case let .setTableCellBorderColor(color): return .setBorderColor(color)
            case let .setTableCellBorderDashStyle(style): return .setBorderDashStyle(style)
            case .setTableCellTopBorderThin: return .setTopBorderThin
            case .setTableCellRightBorderThin: return .setRightBorderThin
            case .setTableCellBottomBorderThin: return .setBottomBorderThin
            case .setTableCellLeftBorderThin: return .setLeftBorderThin
            case .clearTableCellBorder: return .clearBorder
            case .clearTableCellTopBorder: return .clearTopBorder
            case .clearTableCellRightBorder: return .clearRightBorder
            case .clearTableCellBottomBorder: return .clearBottomBorder
            case .clearTableCellLeftBorder: return .clearLeftBorder
            case let .resizeTableColumn(widthPt): return .resizeColumn(widthPt)
            case let .resizeTableRow(minHeightPt): return .resizeRow(minHeightPt)
            case let .setTableCellVerticalAlignment(alignment): return .setVerticalAlignment(alignment)
            case .clearTableCellVerticalAlignment: return .clearVerticalAlignment
            case .increaseTableCellPadding: return .increasePadding
            case .decreaseTableCellPadding: return .decreasePadding
            case .clearTableCellPadding: return .clearPadding
            case .mergeSelectedTableCells: return .mergeSelected
            case .unmergeTableCell: return .unmerge
            default: return nil
            }
        }

        fileprivate func emitInsertTable(
            storage: NSTextStorage,
            location: Int,
            rows: Int,
            columns: Int,
            onOperation: @escaping (String) -> Void
        ) {
            let probe = min(location, max(0, storage.length - 1))
            guard probe >= 0,
                  storage.attribute(.melonPanTableId, at: probe, effectiveRange: nil) == nil,
                  let packedId = storage.attribute(
                      .melonPanParagraphId,
                      at: probe,
                      effectiveRange: nil
                  ) as? String,
                  let paragraphId = RichDocumentModel.NodeId.unpack(packedId) else {
                return
            }
            let envelope = RichOperationEnvelopeBuilder.serialize(
                operationId: makeOperationId(),
                documentId: parent.documentId,
                tabId: parent.tabId,
                baseRevisionId: parent.baseRevisionId,
                actor: parent.actor,
                op: .insertTable(paragraphId: paragraphId, rows: rows, columns: columns)
            )
            onOperation(envelope)
        }

        fileprivate func emitInsertInlineImage(
            storage: NSTextStorage,
            location: Int,
            uri: String,
            onOperation: @escaping (String) -> Void
        ) {
            let probe = min(location, max(0, storage.length - 1))
            guard probe >= 0,
                  let packedId = storage.attribute(
                      .melonPanParagraphId,
                      at: probe,
                      effectiveRange: nil
                  ) as? String,
                  let paragraphStart = storage.attribute(
                      .melonPanParagraphStart,
                      at: probe,
                      effectiveRange: nil
                  ) as? Int,
                  let paragraphId = RichDocumentModel.NodeId.unpack(packedId) else {
                return
            }
            let envelope = RichOperationEnvelopeBuilder.serialize(
                operationId: makeOperationId(),
                documentId: parent.documentId,
                tabId: parent.tabId,
                baseRevisionId: parent.baseRevisionId,
                actor: parent.actor,
                op: .insertInlineImage(
                    paragraphId: paragraphId,
                    utf16Offset: max(0, location - paragraphStart),
                    uri: uri
                )
            )
            onOperation(envelope)
        }

        fileprivate func emitDeleteInlineObject(
            storage: NSTextStorage,
            location: Int,
            onOperation: @escaping (String) -> Void
        ) {
            let probe = min(location, max(0, storage.length - 1))
            guard probe >= 0 else { return }
            let objectId = (storage.attribute(
                .melonPanInlineObjectId,
                at: probe,
                effectiveRange: nil
            ) as? String)
                ?? (probe > 0 ? storage.attribute(
                    .melonPanInlineObjectId,
                    at: probe - 1,
                    effectiveRange: nil
                ) as? String : nil)
            guard let objectId else { return }
            let envelope = RichOperationEnvelopeBuilder.serialize(
                operationId: makeOperationId(),
                documentId: parent.documentId,
                tabId: parent.tabId,
                baseRevisionId: parent.baseRevisionId,
                actor: parent.actor,
                op: .deleteInlineObject(objectId: objectId)
            )
            onOperation(envelope)
        }

        private func isSegmentCommand(_ command: MelonPanTextView.StyleCommand) -> Bool {
            switch command {
            case .createHeader, .deleteCurrentHeader, .createFooter, .deleteCurrentFooter,
                 .createFootnote, .deleteCurrentFootnote:
                return true
            default:
                return false
            }
        }

        fileprivate func emitSegmentOperation(
            storage: NSTextStorage,
            location: Int,
            command: MelonPanTextView.StyleCommand,
            onOperation: @escaping (String) -> Void
        ) {
            let probe = min(location, max(0, storage.length - 1))
            guard probe >= 0 else { return }
            let op: RichOperationEnvelopeBuilder.Op?
            switch command {
            case .createHeader:
                op = .createHeader
            case .createFooter:
                op = .createFooter
            case .createFootnote:
                guard storage.attribute(
                    .melonPanSegmentId,
                    at: probe,
                    effectiveRange: nil
                ) == nil else {
                    return
                }
                guard let packedId = storage.attribute(
                    .melonPanParagraphId,
                    at: probe,
                    effectiveRange: nil
                ) as? String,
                let paragraphStart = storage.attribute(
                    .melonPanParagraphStart,
                    at: probe,
                    effectiveRange: nil
                ) as? Int,
                let paragraphId = RichDocumentModel.NodeId.unpack(packedId) else {
                    return
                }
                op = .createFootnote(
                    paragraphId: paragraphId,
                    utf16Offset: max(0, location - paragraphStart)
                )
            case .deleteCurrentHeader:
                guard let segmentId = currentSegmentId(storage: storage, at: probe, kind: "header") else {
                    return
                }
                op = .deleteHeader(headerId: segmentId)
            case .deleteCurrentFooter:
                guard let segmentId = currentSegmentId(storage: storage, at: probe, kind: "footer") else {
                    return
                }
                op = .deleteFooter(footerId: segmentId)
            case .deleteCurrentFootnote:
                guard let segmentId = currentSegmentId(storage: storage, at: probe, kind: "footnote") else {
                    return
                }
                op = .deleteFootnote(footnoteId: segmentId)
            default:
                op = nil
            }
            guard let op else { return }
            emitCancellableOperation(op, actionName: "Segments", onOperation: onOperation)
        }

        private func currentSegmentId(
            storage: NSTextStorage,
            at location: Int,
            kind: String
        ) -> String? {
            guard storage.length > 0 else { return nil }
            for probe in [location, max(0, location - 1)] where probe < storage.length {
                guard storage.attribute(.melonPanSegmentKind, at: probe, effectiveRange: nil) as? String == kind,
                      let segmentId = storage.attribute(.melonPanSegmentId, at: probe, effectiveRange: nil) as? String,
                      !segmentId.isEmpty else {
                    continue
                }
                return segmentId
            }
            return nil
        }

        private func emitTableOperation(
            storage: NSTextStorage,
            location: Int,
            tableOp: TableOperation,
            onOperation: @escaping (String) -> Void
        ) {
            let probe = min(location, max(0, storage.length - 1))
            guard probe >= 0,
                  let range = tableCellSelectionRange(storage: storage, fallbackLocation: probe),
                  let tableId = RichDocumentModel.NodeId.unpack(range.packedTableId) else {
                return
            }
            let rowIndex = range.rowIndex
            let columnIndex = range.columnIndex
            let rowSpan = range.rowSpan
            let columnSpan = range.columnSpan
            let previousBackgroundColor = (storage.attribute(
                .backgroundColor,
                at: probe,
                effectiveRange: nil
            ) as? NSColor).flatMap(rgbColor(from:))

            let opCase: RichOperationEnvelopeBuilder.Op
            let inverse: RichOperationEnvelopeBuilder.Op?
            switch tableOp {
            case .insertRowAbove:
                opCase = .insertTableRow(tableId: tableId, rowIndex: rowIndex, insertBelow: false)
                inverse = .deleteTableRow(tableId: tableId, rowIndex: rowIndex)
            case .insertRowBelow:
                opCase = .insertTableRow(tableId: tableId, rowIndex: rowIndex, insertBelow: true)
                inverse = .deleteTableRow(tableId: tableId, rowIndex: rowIndex + 1)
            case .deleteRow:
                opCase = .deleteTableRow(tableId: tableId, rowIndex: rowIndex)
                inverse = nil
            case .insertColumnLeft:
                opCase = .insertTableColumn(tableId: tableId, columnIndex: columnIndex, insertRight: false)
                inverse = .deleteTableColumn(tableId: tableId, columnIndex: columnIndex)
            case .insertColumnRight:
                opCase = .insertTableColumn(tableId: tableId, columnIndex: columnIndex, insertRight: true)
                inverse = .deleteTableColumn(tableId: tableId, columnIndex: columnIndex + 1)
            case .deleteColumn:
                opCase = .deleteTableColumn(tableId: tableId, columnIndex: columnIndex)
                inverse = nil
            case .deleteTable:
                opCase = .deleteTable(tableId: tableId)
                inverse = nil
            case .setBackgroundYellow:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.backgroundColor = .some(RichOperationEnvelopeBuilder.RGBColor(
                    red: 1.0,
                    green: 0.92,
                    blue: 0.35
                ))
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = tableCellBackgroundOperation(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    color: previousBackgroundColor
                )
            case let .setBackgroundColor(color):
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.backgroundColor = .some(RichOperationEnvelopeBuilder.RGBColor(
                    red: color.red,
                    green: color.green,
                    blue: color.blue
                ))
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = tableCellBackgroundOperation(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    color: previousBackgroundColor
                )
            case .clearBackground:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.backgroundColor = .some(nil)
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = tableCellBackgroundOperation(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    color: previousBackgroundColor
                )
            case .setBorderThin:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.borderWidthPt = .some(1.0)
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = nil
            case let .setBorderColor(color):
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.borderColor = .some(RichOperationEnvelopeBuilder.RGBColor(
                    red: color.red,
                    green: color.green,
                    blue: color.blue
                ))
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = nil
            case let .setBorderDashStyle(style):
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.borderDashStyle = .some(style)
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = nil
            case .setTopBorderThin:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.borderTopWidthPt = .some(1.0)
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = nil
            case .setRightBorderThin:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.borderRightWidthPt = .some(1.0)
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = nil
            case .setBottomBorderThin:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.borderBottomWidthPt = .some(1.0)
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = nil
            case .setLeftBorderThin:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.borderLeftWidthPt = .some(1.0)
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = nil
            case .clearBorder:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.borderWidthPt = .some(nil)
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = nil
            case .clearTopBorder:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.borderTopWidthPt = .some(nil)
                opCase = .setTableCellStyle(tableId: tableId, rowIndex: rowIndex, columnIndex: columnIndex, rowSpan: rowSpan, columnSpan: columnSpan, delta: delta)
                inverse = nil
            case .clearRightBorder:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.borderRightWidthPt = .some(nil)
                opCase = .setTableCellStyle(tableId: tableId, rowIndex: rowIndex, columnIndex: columnIndex, rowSpan: rowSpan, columnSpan: columnSpan, delta: delta)
                inverse = nil
            case .clearBottomBorder:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.borderBottomWidthPt = .some(nil)
                opCase = .setTableCellStyle(tableId: tableId, rowIndex: rowIndex, columnIndex: columnIndex, rowSpan: rowSpan, columnSpan: columnSpan, delta: delta)
                inverse = nil
            case .clearLeftBorder:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.borderLeftWidthPt = .some(nil)
                opCase = .setTableCellStyle(tableId: tableId, rowIndex: rowIndex, columnIndex: columnIndex, rowSpan: rowSpan, columnSpan: columnSpan, delta: delta)
                inverse = nil
            case let .resizeColumn(widthPt):
                opCase = .setTableColumnWidth(
                    tableId: tableId,
                    columnIndex: columnIndex,
                    widthPt: widthPt
                )
                inverse = nil
            case let .resizeRow(minHeightPt):
                opCase = .setTableRowMinHeight(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    minHeightPt: minHeightPt
                )
                inverse = nil
            case let .setVerticalAlignment(alignment):
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.contentAlignment = .some(alignment)
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = nil
            case .clearVerticalAlignment:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.contentAlignment = .some(nil)
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = nil
            case .increasePadding:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.paddingPt = .some(12.0)
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = nil
            case .decreasePadding:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.paddingPt = .some(4.0)
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = nil
            case .clearPadding:
                var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
                delta.paddingPt = .some(nil)
                opCase = .setTableCellStyle(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan,
                    delta: delta
                )
                inverse = nil
            case .mergeSelected:
                let targetRowSpan = max(rowSpan, 1)
                let targetColumnSpan = max(columnSpan, 1)
                opCase = .mergeTableCells(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: targetRowSpan,
                    columnSpan: targetColumnSpan
                )
                inverse = .unmergeTableCells(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: targetRowSpan,
                    columnSpan: targetColumnSpan
                )
            case .unmerge:
                opCase = .unmergeTableCells(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan
                )
                inverse = .mergeTableCells(
                    tableId: tableId,
                    rowIndex: rowIndex,
                    columnIndex: columnIndex,
                    rowSpan: rowSpan,
                    columnSpan: columnSpan
                )
            }
            if inverse == nil {
                emitCancellableOperation(
                    opCase,
                    actionName: "Table",
                    onOperation: onOperation
                )
                return
            }
            emitUndoableOperation(
                opCase,
                inverse: inverse,
                actionName: "Table",
                onOperation: onOperation
            )
        }

        private func tableCellBackgroundOperation(
            tableId: RichDocumentModel.NodeId,
            rowIndex: Int,
            columnIndex: Int,
            rowSpan: Int,
            columnSpan: Int,
            color: RichOperationEnvelopeBuilder.RGBColor?
        ) -> RichOperationEnvelopeBuilder.Op {
            var delta = RichOperationEnvelopeBuilder.TableCellStyleDelta()
            delta.backgroundColor = .some(color)
            return .setTableCellStyle(
                tableId: tableId,
                rowIndex: rowIndex,
                columnIndex: columnIndex,
                rowSpan: rowSpan,
                columnSpan: columnSpan,
                delta: delta
            )
        }

        private struct TableCellSelectionRange {
            let packedTableId: String
            let rowIndex: Int
            let columnIndex: Int
            let rowSpan: Int
            let columnSpan: Int
        }

        private func tableCellSelectionRange(
            storage: NSTextStorage,
            fallbackLocation: Int
        ) -> TableCellSelectionRange? {
            guard storage.length > 0 else { return nil }
            let selected = textView?.selectedRange() ?? NSRange(location: fallbackLocation, length: 0)
            let scanRange: NSRange
            if selected.length > 0, NSMaxRange(selected) <= storage.length {
                scanRange = selected
            } else {
                scanRange = NSRange(location: min(fallbackLocation, storage.length - 1), length: 1)
            }

            var packedTableId: String?
            var minRow = Int.max
            var minColumn = Int.max
            var maxRow = Int.min
            var maxColumn = Int.min
            storage.enumerateAttribute(.melonPanTableId, in: scanRange) { value, subrange, stop in
                guard let table = value as? String else { return }
                if let packedTableId, packedTableId != table {
                    stop.pointee = true
                    return
                }
                let probe = min(subrange.location, storage.length - 1)
                guard let row = storage.attribute(.melonPanTableRowIndex, at: probe, effectiveRange: nil) as? Int,
                      let column = storage.attribute(.melonPanTableColumnIndex, at: probe, effectiveRange: nil) as? Int else {
                    return
                }
                let rowSpan = max(1, (storage.attribute(.melonPanTableRowSpan, at: probe, effectiveRange: nil) as? Int) ?? 1)
                let columnSpan = max(1, (storage.attribute(.melonPanTableColumnSpan, at: probe, effectiveRange: nil) as? Int) ?? 1)
                packedTableId = table
                minRow = min(minRow, row)
                minColumn = min(minColumn, column)
                maxRow = max(maxRow, row + rowSpan - 1)
                maxColumn = max(maxColumn, column + columnSpan - 1)
            }

            if packedTableId == nil, fallbackLocation > 0 {
                return tableCellSelectionRange(storage: storage, fallbackLocation: fallbackLocation - 1)
            }
            guard let packedTableId, minRow != Int.max, minColumn != Int.max else { return nil }
            return TableCellSelectionRange(
                packedTableId: packedTableId,
                rowIndex: minRow,
                columnIndex: minColumn,
                rowSpan: max(1, maxRow - minRow + 1),
                columnSpan: max(1, maxColumn - minColumn + 1)
            )
        }

        private func isAttributeOnAt(
            _ storage: NSTextStorage,
            _ key: NSAttributedString.Key,
            at location: Int,
            check: (Any?) -> Bool
        ) -> Bool {
            guard location < storage.length else { return false }
            let value = storage.attribute(key, at: location, effectiveRange: nil)
            return check(value)
        }

        private func applyOptimisticStyleCommand(
            _ command: MelonPanTextView.StyleCommand,
            range: NSRange,
            storage: NSTextStorage
        ) {
            guard range.length > 0, NSMaxRange(range) <= storage.length else { return }

            suppressCapture = true
            storage.beginEditing()
            defer {
                storage.endEditing()
                suppressCapture = false
            }

            switch command {
            case .bold:
                let enabled = !isAttributeOnAt(storage, .font, at: range.location) {
                    ($0 as? NSFont)?.fontDescriptor.symbolicTraits.contains(.bold) == true
                }
                setFontTrait(.boldFontMask, enabled: enabled, range: range, storage: storage)
            case .italic:
                let enabled = !isAttributeOnAt(storage, .font, at: range.location) {
                    ($0 as? NSFont)?.fontDescriptor.symbolicTraits.contains(.italic) == true
                }
                setFontTrait(.italicFontMask, enabled: enabled, range: range, storage: storage)
            case .underline:
                let enabled = !isAttributeOnAt(storage, .underlineStyle, at: range.location) { value in
                    if let raw = value as? Int { return raw != 0 }
                    if let raw = value as? NSNumber { return raw.intValue != 0 }
                    return false
                }
                if enabled {
                    storage.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: range)
                } else {
                    storage.removeAttribute(.underlineStyle, range: range)
                }
            case .clearFormatting:
                clearInlinePresentation(range: range, storage: storage)
            case .setFontFamilyTimes:
                setFontFamily("Times New Roman", range: range, storage: storage)
            case let .setFont(familyName, sizePt):
                setFont(familyName: familyName, sizePt: CGFloat(sizePt), range: range, storage: storage)
            case let .setFontSize(sizePt):
                setFontSize(CGFloat(sizePt), range: range, storage: storage)
            case .increaseFontSize:
                adjustFontSize(delta: 1, range: range, storage: storage)
            case .decreaseFontSize:
                adjustFontSize(delta: -1, range: range, storage: storage)
            case .setTextColorRed:
                storage.addAttribute(.foregroundColor, value: NSColor(calibratedRed: 0.82, green: 0.12, blue: 0.12, alpha: 1), range: range)
            case let .setTextColor(color):
                storage.addAttribute(.foregroundColor, value: nsColor(color), range: range)
            case .setTextBackgroundYellow:
                storage.addAttribute(.backgroundColor, value: NSColor(calibratedRed: 1.0, green: 0.92, blue: 0.35, alpha: 1), range: range)
            case let .setTextBackgroundColor(color):
                storage.addAttribute(.backgroundColor, value: nsColor(color), range: range)
            case .clearFontAndColors:
                storage.removeAttribute(.font, range: range)
                storage.removeAttribute(.foregroundColor, range: range)
                storage.removeAttribute(.backgroundColor, range: range)
            case let .link(url):
                if let parsed = URL(string: url) {
                    storage.addAttribute(.link, value: parsed, range: range)
                    storage.addAttribute(.foregroundColor, value: NSColor.linkColor, range: range)
                    storage.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: range)
                }
            case .toggleNumberedList, .toggleBulletedList, .listIndent, .listOutdent,
                 .alignLeft, .alignCenter, .alignRight, .alignJustified,
                 .setParagraphNamedStyle,
                 .insertTable, .insertTableRowAbove, .insertTableRowBelow, .deleteTableRow,
                 .insertTableColumnLeft, .insertTableColumnRight, .deleteTableColumn, .deleteTable,
                 .setTableCellBackgroundYellow, .setTableCellBackgroundColor,
                 .clearTableCellBackground, .setTableCellBorderThin,
                 .setTableCellBorderColor, .setTableCellBorderDashStyle,
                 .setTableCellTopBorderThin, .setTableCellRightBorderThin,
                 .setTableCellBottomBorderThin, .setTableCellLeftBorderThin,
                 .clearTableCellBorder, .clearTableCellTopBorder,
                 .clearTableCellRightBorder, .clearTableCellBottomBorder,
                 .clearTableCellLeftBorder, .resizeTableColumn, .resizeTableRow,
                 .setTableCellVerticalAlignment, .clearTableCellVerticalAlignment,
                 .increaseTableCellPadding, .decreaseTableCellPadding, .clearTableCellPadding,
                 .mergeSelectedTableCells, .unmergeTableCell,
                 .insertInlineImage, .deleteInlineObject,
                 .createHeader, .deleteCurrentHeader, .createFooter, .deleteCurrentFooter,
                 .createFootnote, .deleteCurrentFootnote:
                break
            }
        }

        private func setFontTrait(
            _ trait: NSFontTraitMask,
            enabled: Bool,
            range: NSRange,
            storage: NSTextStorage
        ) {
            let manager = NSFontManager.shared
            storage.enumerateAttribute(.font, in: range, options: []) { value, subrange, _ in
                let current = (value as? NSFont) ?? NSFont.systemFont(ofSize: 14)
                let next = enabled
                    ? manager.convert(current, toHaveTrait: trait)
                    : manager.convert(current, toNotHaveTrait: trait)
                storage.addAttribute(.font, value: next, range: subrange)
            }
        }

        private func setFontFamily(
            _ family: String,
            range: NSRange,
            storage: NSTextStorage
        ) {
            storage.enumerateAttribute(.font, in: range, options: []) { value, subrange, _ in
                let current = (value as? NSFont) ?? NSFont.systemFont(ofSize: 14)
                let descriptor = current.fontDescriptor.withFamily(family)
                let next = NSFont(descriptor: descriptor, size: current.pointSize) ?? current
                storage.addAttribute(.font, value: next, range: subrange)
            }
        }

        private func setFont(
            familyName: String,
            sizePt: CGFloat,
            range: NSRange,
            storage: NSTextStorage
        ) {
            storage.enumerateAttribute(.font, in: range, options: []) { value, subrange, _ in
                let current = (value as? NSFont) ?? NSFont.systemFont(ofSize: 14)
                let descriptor = current.fontDescriptor.withFamily(familyName)
                let next = NSFont(descriptor: descriptor, size: max(6, sizePt))
                    ?? NSFont(name: familyName, size: max(6, sizePt))
                    ?? current
                storage.addAttribute(.font, value: next, range: subrange)
            }
        }

        private func adjustFontSize(
            delta: CGFloat,
            range: NSRange,
            storage: NSTextStorage
        ) {
            storage.enumerateAttribute(.font, in: range, options: []) { value, subrange, _ in
                let current = (value as? NSFont) ?? NSFont.systemFont(ofSize: 14)
                let nextSize = max(6, current.pointSize + delta)
                let next = NSFont(descriptor: current.fontDescriptor, size: nextSize) ?? current
                storage.addAttribute(.font, value: next, range: subrange)
            }
        }

        private func setFontSize(
            _ sizePt: CGFloat,
            range: NSRange,
            storage: NSTextStorage
        ) {
            storage.enumerateAttribute(.font, in: range, options: []) { value, subrange, _ in
                let current = (value as? NSFont) ?? NSFont.systemFont(ofSize: 14)
                let next = NSFont(descriptor: current.fontDescriptor, size: max(6, sizePt)) ?? current
                storage.addAttribute(.font, value: next, range: subrange)
            }
        }

        private func clearInlinePresentation(range: NSRange, storage: NSTextStorage) {
            let keys: [NSAttributedString.Key] = [
                .font,
                .foregroundColor,
                .backgroundColor,
                .underlineStyle,
                .strikethroughStyle,
                .link
            ]
            for key in keys {
                storage.removeAttribute(key, range: range)
            }
        }

        private func nsColor(_ color: MelonPanTextView.StyleCommand.RGBColor) -> NSColor {
            NSColor(
                calibratedRed: CGFloat(color.red),
                green: CGFloat(color.green),
                blue: CGFloat(color.blue),
                alpha: 1
            )
        }

        private func rangeTouchesProtectedRenderRange(
            _ range: NSRange,
            in storage: NSTextStorage
        ) -> Bool {
            guard storage.length > 0 else { return false }
            if range.length == 0 {
                let probes = [
                    min(range.location, storage.length - 1),
                    max(0, min(range.location - 1, storage.length - 1))
                ]
                return probes.contains { probe in
                    (storage.attribute(
                        .melonPanProtectedRenderRange,
                        at: probe,
                        effectiveRange: nil
                    ) as? Bool) == true
                }
            }
            let clamped = NSIntersectionRange(
                range,
                NSRange(location: 0, length: storage.length)
            )
            guard clamped.length > 0 else { return false }
            var touchesProtected = false
            storage.enumerateAttribute(
                .melonPanProtectedRenderRange,
                in: clamped,
                options: []
            ) { value, _, stop in
                if (value as? Bool) == true {
                    touchesProtected = true
                    stop.pointee = true
                }
            }
            return touchesProtected
        }

        /// Toggle list state on the paragraph at `location`. If the
        /// paragraph already carries .melonPanParagraphInList = true,
        /// emit DeleteList; otherwise CreateList with the requested
        /// ordered/unordered flag.
        fileprivate func emitListToggle(
            storage: NSTextStorage,
            location: Int,
            ordered: Bool,
            onOperation: @escaping (String) -> Void
        ) {
            // Probe attributes — clamp to a valid index for end-of-doc
            // carets.
            let probe = min(location, max(0, storage.length - 1))
            guard probe >= 0,
                  let packedId = storage.attribute(
                      .melonPanParagraphId,
                      at: probe,
                      effectiveRange: nil
                  ) as? String,
                  let paragraphId = RichDocumentModel.NodeId.unpack(packedId) else {
                return
            }
            let alreadyInList = (storage.attribute(
                .melonPanParagraphInList,
                at: probe,
                effectiveRange: nil
            ) as? Bool) ?? false

            let opCase: RichOperationEnvelopeBuilder.Op
            if alreadyInList {
                opCase = .deleteList(paragraphId: paragraphId)
            } else {
                opCase = .createList(paragraphId: paragraphId, ordered: ordered)
            }
            let inverse: RichOperationEnvelopeBuilder.Op? = alreadyInList
                ? nil
                : .deleteList(paragraphId: paragraphId)
            emitUndoableOperation(
                opCase,
                inverse: inverse,
                actionName: "List",
                onOperation: onOperation
            )
        }

        fileprivate func emitListNestingDelta(
            storage: NSTextStorage,
            location: Int,
            delta: Int,
            onOperation: @escaping (String) -> Void
        ) {
            let probe = min(location, max(0, storage.length - 1))
            guard probe >= 0,
                  let packedId = storage.attribute(
                      .melonPanParagraphId,
                      at: probe,
                      effectiveRange: nil
                  ) as? String,
                  let paragraphId = RichDocumentModel.NodeId.unpack(packedId) else {
                return
            }
            let alreadyInList = (storage.attribute(
                .melonPanParagraphInList,
                at: probe,
                effectiveRange: nil
            ) as? Bool) ?? false
            guard alreadyInList else { return }
            let current = (storage.attribute(
                .melonPanListNestingLevel,
                at: probe,
                effectiveRange: nil
            ) as? Int) ?? 0
            let next = max(0, current + delta)
            guard next != current else { return }
            emitUndoableOperation(
                .updateListNesting(paragraphId: paragraphId, nestingLevel: next),
                inverse: .updateListNesting(paragraphId: paragraphId, nestingLevel: current),
                actionName: "List Indent",
                onOperation: onOperation
            )
        }
    }
}
