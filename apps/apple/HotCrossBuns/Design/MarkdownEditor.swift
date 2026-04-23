import AppKit
import SwiftUI

// Edit surface for task notes and event descriptions. The underlying text
// view is MarkdownLiveEditor, which renders markdown formatting live while
// keeping syntax visible but dimmed (Obsidian-style live preview). The
// toolbar on top still inserts raw markdown — the live render does the
// rest.
struct MarkdownEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme
    @Binding var text: String
    var placeholder: String = ""
    var minHeight: CGFloat = 120
    var maxHeight: CGFloat = 240
    // Kept for backwards compatibility with existing call sites; the live
    // editor makes the below-editor preview redundant.
    var showInlinePreview: Bool = true

    @State private var isFocused: Bool = false

    private var editorFontSize: CGFloat {
        let base = CGFloat(HCBTextSize.clamp(model.settings.uiTextSizePoints))
        let override = model.settings.perSurfaceFontOverrides[HCBSurface.editor.rawValue] ?? .empty
        if let pt = override.pointSize {
            return CGFloat(HCBTextSize.clamp(pt))
        }
        return base
    }

    private var editorFontName: String? {
        let override = model.settings.perSurfaceFontOverrides[HCBSurface.editor.rawValue] ?? .empty
        if let name = override.fontName, name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            return name
        }
        if let global = model.settings.uiFontName, global.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            return global
        }
        return nil
    }

    private var baseNSFont: NSFont {
        if let name = editorFontName, let f = NSFont(name: name, size: editorFontSize) {
            return f
        }
        return NSFont.systemFont(ofSize: editorFontSize)
    }

    private var theme: MarkdownHighlightTheme {
        .current(baseFont: baseNSFont)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            toolbar
            editor
        }
        // colorScheme is read so the view re-renders when the user flips
        // light/dark or swaps palette — NSTextView colors are pulled from
        // the scheme store on each update.
        .id(colorScheme)
    }

    private var trimmed: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var toolbar: some View {
        HStack(spacing: 4) {
            toolbarButton(title: "B", systemImage: "bold", help: "Bold (**text**)") {
                wrapAtEnd(prefix: "**", suffix: "**", placeholder: "bold")
            }
            .hcbFont(.caption, weight: .bold)
            toolbarButton(title: "I", systemImage: "italic", help: "Italic (*text*)") {
                wrapAtEnd(prefix: "*", suffix: "*", placeholder: "italic")
            }
            .font(.caption.italic())
            toolbarButton(title: "U", systemImage: "underline", help: "Underline (__text__, Calendar only)") {
                wrapAtEnd(prefix: "__", suffix: "__", placeholder: "underline")
            }
            .hcbFont(.caption, weight: .semibold)
            toolbarButton(title: "•", systemImage: "list.bullet", help: "Bulleted list") {
                insertLinePrefix("- ")
            }
            toolbarButton(title: "1.", systemImage: "list.number", help: "Numbered list") {
                insertLinePrefix("1. ")
            }
            toolbarButton(title: "🔗", systemImage: "link", help: "Link ([text](url))") {
                insertAtEnd("[text](https://)")
            }
            Spacer(minLength: 8)
            if trimmed.isEmpty == false {
                Text("markdown")
                    .font(.caption2.weight(.medium).monospaced())
                    .foregroundStyle(.secondary)
            }
        }
        .hcbScaledPadding(.horizontal, 2)
    }

    private func toolbarButton(title: String, systemImage: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .hcbFont(.caption)
                .hcbScaledFrame(width: 22, height: 20)
        }
        .buttonStyle(.borderless)
        .help(help)
    }

    private var editor: some View {
        MarkdownLiveEditor(
            text: $text,
            placeholder: placeholder,
            minHeight: minHeight,
            maxHeight: maxHeight,
            baseFont: baseNSFont,
            theme: theme,
            onFocusChange: { focused in isFocused = focused }
        )
        .frame(minHeight: minHeight, maxHeight: maxHeight)
        .hcbScaledPadding(10)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(AppColor.cream.opacity(0.6))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(AppColor.cardStroke, lineWidth: 0.8)
        )
    }

    // Toolbar still appends since NSTextView's selection isn't round-tripped
    // through the SwiftUI binding. Wrapping at cursor remains a possible
    // follow-up if callers ask.
    private func wrapAtEnd(prefix: String, suffix: String, placeholder: String) {
        appendAddition("\(prefix)\(placeholder)\(suffix)")
    }

    private func insertLinePrefix(_ prefix: String) {
        if text.isEmpty {
            text = prefix
        } else if text.hasSuffix("\n") {
            text.append(prefix)
        } else {
            text.append("\n\(prefix)")
        }
    }

    private func insertAtEnd(_ snippet: String) {
        appendAddition(snippet)
    }

    private func appendAddition(_ addition: String) {
        if text.isEmpty {
            text = addition
        } else if text.hasSuffix(" ") || text.hasSuffix("\n") {
            text.append(addition)
        } else {
            text.append(" \(addition)")
        }
    }
}
