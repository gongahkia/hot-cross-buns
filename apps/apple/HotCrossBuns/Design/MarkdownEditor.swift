import SwiftUI

struct MarkdownEditor: View {
    @Binding var text: String
    var placeholder: String = ""
    var minHeight: CGFloat = 120
    var maxHeight: CGFloat = 240
    var showInlinePreview: Bool = true

    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            toolbar
            editor
            if showInlinePreview, isFocused == false, trimmed.isEmpty == false {
                Text.markdown(trimmed)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 2)
            }
        }
    }

    private var trimmed: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var toolbar: some View {
        HStack(spacing: 4) {
            toolbarButton(title: "B", systemImage: "bold", help: "Bold (**text**)") {
                wrapSelection(prefix: "**", suffix: "**", placeholder: "bold")
            }
            .font(.caption.weight(.bold))
            toolbarButton(title: "I", systemImage: "italic", help: "Italic (*text*)") {
                wrapSelection(prefix: "*", suffix: "*", placeholder: "italic")
            }
            .font(.caption.italic())
            toolbarButton(title: "U", systemImage: "underline", help: "Underline (__text__, Calendar only)") {
                wrapSelection(prefix: "__", suffix: "__", placeholder: "underline")
            }
            .font(.caption.weight(.semibold))
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
        .padding(.horizontal, 2)
    }

    private func toolbarButton(title: String, systemImage: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.caption)
                .frame(width: 22, height: 20)
        }
        .buttonStyle(.borderless)
        .help(help)
    }

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty, placeholder.isEmpty == false {
                Text(placeholder)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)
                    .padding(.top, 14)
                    .allowsHitTesting(false)
            }
            TextEditor(text: $text)
                .font(.body)
                .scrollContentBackground(.hidden)
                .enableWritingTools()
                .frame(minHeight: minHeight, maxHeight: maxHeight)
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(AppColor.cream.opacity(0.6))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(AppColor.cardStroke, lineWidth: 0.8)
                )
                .focused($isFocused)
        }
    }

    private func wrapSelection(prefix: String, suffix: String, placeholder: String) {
        // TextEditor doesn't expose selection; append the wrapped placeholder.
        let addition = "\(prefix)\(placeholder)\(suffix)"
        appendAddition(addition)
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
