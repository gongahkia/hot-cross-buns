import SwiftUI

struct AppearanceSection: View {
    @Environment(AppModel.self) private var model
    @State private var fontQuery: String = ""
    @State private var availableFonts: [String] = []

    var body: some View {
        Section("Appearance") {
            layoutScaleRow
            textSizeRow
            fontRow
            Text("Layout scale resizes UI chrome (sidebar, icons, padding). Text size and font are controlled independently. System dialogs (alerts, confirmation dialogs) follow macOS display settings and aren't affected.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .task {
            if availableFonts.isEmpty {
                availableFonts = HCBInstalledFonts.available()
            }
        }
    }

    private var layoutScaleRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Layout scale")
                Spacer()
                Text("\(Int(model.settings.uiLayoutScale * 100))%")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Slider(
                value: Binding(
                    get: { model.settings.uiLayoutScale },
                    set: { model.setUILayoutScale($0) }
                ),
                in: 0.80...1.50,
                step: 0.05
            )
            HStack {
                Button("Reset") { model.setUILayoutScale(1.0) }
                    .buttonStyle(.borderless)
                    .font(.caption)
                Spacer()
            }
        }
    }

    private var textSizeRow: some View {
        Picker("Text size", selection: textStepBinding) {
            ForEach(Array(HCBTextSizeLadder.titles.enumerated()), id: \.offset) { idx, title in
                Text(title).tag(idx)
            }
        }
        .pickerStyle(.segmented)
    }

    private var textStepBinding: Binding<Int> {
        Binding(
            get: { model.settings.uiTextSizeStep },
            set: { model.setUITextSizeStep($0) }
        )
    }

    private var fontRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("UI font")
                Spacer()
                Button("System default") { model.setUIFontName(nil) }
                    .buttonStyle(.borderless)
                    .font(.caption)
                    .disabled(model.settings.uiFontName == nil)
            }
            HStack(spacing: 8) {
                TextField("Search fonts", text: $fontQuery)
                    .textFieldStyle(.roundedBorder)
                Menu {
                    if filteredFonts.isEmpty {
                        Text("No fonts match").foregroundStyle(.secondary)
                    } else {
                        ForEach(filteredFonts.prefix(200), id: \.self) { family in
                            Button(family) { model.setUIFontName(family) }
                        }
                        if filteredFonts.count > 200 {
                            Text("Showing first 200 — refine the search").foregroundStyle(.secondary)
                        }
                    }
                } label: {
                    Label(model.settings.uiFontName ?? "System", systemImage: "textformat")
                        .lineLimit(1)
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
            }
            Text("Custom font applies wherever the app uses the default font. Explicit .font(.headline) / .font(.body) sites still use the system font until migrated.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var filteredFonts: [String] {
        let q = fontQuery.trimmingCharacters(in: .whitespaces)
        guard q.isEmpty == false else { return availableFonts }
        return availableFonts.filter { $0.localizedCaseInsensitiveContains(q) }
    }
}
