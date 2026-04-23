import AppKit
import SwiftUI

// Edit-mode markdown surface that renders formatting live as the user
// types, keeping the raw syntax visible but dimmed (Obsidian-style live
// preview). Wraps an NSTextView so we can style arbitrary character
// ranges via NSTextStorage — SwiftUI's TextEditor can't do per-character
// attributes without resetting typing state.
//
// Public API mirrors SwiftUI's TextEditor: a text binding, optional
// placeholder, and size constraints. Callers don't need to know about
// NSText internals.
struct MarkdownLiveEditor: NSViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var minHeight: CGFloat
    var maxHeight: CGFloat
    var baseFont: NSFont
    var theme: MarkdownHighlightTheme
    var onFocusChange: ((Bool) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSTextView.scrollableTextView()
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = false
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.borderType = .noBorder

        guard let tv = scroll.documentView as? NSTextView else { return scroll }
        tv.delegate = context.coordinator
        tv.isRichText = false
        tv.isEditable = true
        tv.isSelectable = true
        tv.allowsUndo = true
        tv.drawsBackground = false
        tv.textContainerInset = NSSize(width: 4, height: 6)
        tv.font = baseFont
        tv.textColor = theme.baseColor
        tv.insertionPointColor = theme.accentColor
        tv.usesAdaptiveColorMappingForDarkAppearance = false
        tv.usesFindBar = true
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.isAutomaticDashSubstitutionEnabled = false
        tv.isAutomaticTextReplacementEnabled = false
        tv.isAutomaticSpellingCorrectionEnabled = false
        tv.isAutomaticLinkDetectionEnabled = false
        tv.smartInsertDeleteEnabled = false
        tv.typingAttributes = [
            .font: baseFont,
            .foregroundColor: theme.baseColor
        ]
        tv.string = text
        if let storage = tv.textStorage {
            MarkdownHighlighter.apply(to: storage, theme: theme)
        }
        context.coordinator.placeholderLabel = attachPlaceholder(to: tv)
        updatePlaceholderVisibility(coordinator: context.coordinator, isEmpty: text.isEmpty)
        return scroll
    }

    func updateNSView(_ nsView: NSScrollView, context: Context) {
        guard let tv = nsView.documentView as? NSTextView else { return }
        context.coordinator.parent = self
        tv.insertionPointColor = theme.accentColor
        if tv.font != baseFont {
            tv.font = baseFont
        }
        tv.typingAttributes = [
            .font: baseFont,
            .foregroundColor: theme.baseColor
        ]
        if tv.string != text {
            let selection = tv.selectedRange()
            tv.string = text
            let len = (text as NSString).length
            if selection.location <= len {
                tv.setSelectedRange(NSRange(location: min(selection.location, len), length: 0))
            }
        }
        if let storage = tv.textStorage {
            MarkdownHighlighter.apply(to: storage, theme: theme)
        }
        updatePlaceholderVisibility(coordinator: context.coordinator, isEmpty: text.isEmpty)
        if let placeholderLabel = context.coordinator.placeholderLabel {
            placeholderLabel.stringValue = placeholder
            placeholderLabel.textColor = theme.dimColor
            placeholderLabel.font = baseFont
        }
    }

    private func attachPlaceholder(to tv: NSTextView) -> NSTextField {
        let label = NSTextField(labelWithString: placeholder)
        label.translatesAutoresizingMaskIntoConstraints = false
        label.textColor = theme.dimColor
        label.font = baseFont
        label.isBezeled = false
        label.drawsBackground = false
        label.isEditable = false
        label.isSelectable = false
        tv.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: tv.leadingAnchor, constant: tv.textContainerInset.width + 5),
            label.topAnchor.constraint(equalTo: tv.topAnchor, constant: tv.textContainerInset.height + 1)
        ])
        return label
    }

    private func updatePlaceholderVisibility(coordinator: Coordinator, isEmpty: Bool) {
        coordinator.placeholderLabel?.isHidden = !isEmpty
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MarkdownLiveEditor
        weak var placeholderLabel: NSTextField?

        init(_ parent: MarkdownLiveEditor) {
            self.parent = parent
        }

        func textDidChange(_ notification: Notification) {
            guard let tv = notification.object as? NSTextView else { return }
            let newString = tv.string
            if parent.text != newString {
                parent.text = newString
            }
            if let storage = tv.textStorage {
                MarkdownHighlighter.apply(to: storage, theme: parent.theme)
            }
            placeholderLabel?.isHidden = !newString.isEmpty
            // typingAttributes is reset on every keystroke so new input
            // inherits base styling rather than whatever run the cursor
            // happened to be sitting inside.
            tv.typingAttributes = [
                .font: parent.baseFont,
                .foregroundColor: parent.theme.baseColor
            ]
        }

        func textDidBeginEditing(_ notification: Notification) {
            parent.onFocusChange?(true)
        }

        func textDidEndEditing(_ notification: Notification) {
            parent.onFocusChange?(false)
        }
    }
}

// Convenience wrapper that resolves the current AppColor scheme + resolved
// editor font into a theme. Kept on this layer so MarkdownEditor stays a
// one-line call.
extension MarkdownHighlightTheme {
    @MainActor
    static func current(baseFont: NSFont) -> MarkdownHighlightTheme {
        let scheme = HCBColorSchemeStore.current
        return .make(
            baseFont: baseFont,
            ink: scheme.ink.nsColor,
            accent: scheme.ember.nsColor,
            stroke: scheme.cardStroke.nsColor
        )
    }
}
