import SwiftUI

struct AppearanceSection: View {
    @Environment(AppModel.self) private var model
    @State private var fontQuery: String = ""
    @State private var availableFonts: [String] = []

    var body: some View {
        Section("Appearance") {
            colorSchemeRow
            layoutScaleRow
            textSizeRow
            fontRow
            Text("Layout scale resizes UI chrome (sidebar, icons, padding). Text size, font, and color scheme are controlled independently. System dialogs (alerts, confirmation dialogs) follow macOS display settings and aren't affected.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        }
        .task {
            if availableFonts.isEmpty {
                availableFonts = HCBInstalledFonts.available()
            }
        }
    }

    private var colorSchemeRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Color scheme")
                Spacer()
                Button("Reset to Notion") { model.setColorSchemeID("notion") }
                    .buttonStyle(.borderless)
                    .hcbFont(.caption)
                    .disabled(model.settings.colorSchemeID == "notion")
            }
            Picker("Scheme", selection: Binding(
                get: { model.settings.colorSchemeID },
                set: { model.setColorSchemeID($0) }
            )) {
                ForEach(HCBColorScheme.all) { scheme in
                    HStack(spacing: 8) {
                        ColorSchemeSwatch(scheme: scheme)
                        Text(scheme.title)
                        if scheme.isDark {
                            Text("· dark").foregroundStyle(.secondary)
                        }
                    }
                    .tag(scheme.id)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
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
                    .hcbFont(.caption)
                Spacer()
            }
        }
    }

    private var textSizeRow: some View {
        Stepper(
            value: Binding(
                get: { model.settings.uiTextSizePoints },
                set: { model.setUITextSizePoints($0) }
            ),
            in: HCBTextSize.minPoints...HCBTextSize.maxPoints,
            step: HCBTextSize.stepPoints
        ) {
            HStack {
                Text("Text size")
                Spacer()
                Text("\(Int(model.settings.uiTextSizePoints)) pt")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                if model.settings.uiTextSizePoints != HCBTextSize.defaultPoints {
                    Button("Reset") { model.setUITextSizePoints(HCBTextSize.defaultPoints) }
                        .buttonStyle(.borderless)
                        .hcbFont(.caption)
                }
            }
        }
    }

    private var fontRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("UI font")
                Spacer()
                Button("System default") { model.setUIFontName(nil) }
                    .buttonStyle(.borderless)
                    .hcbFont(.caption)
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
            Text("Custom font applies to all text rendered via the app's semantic text styles. Calls that use system design variants (monospaced digits, rounded, serif) keep the system font on purpose.")
                .hcbFont(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var filteredFonts: [String] {
        let q = fontQuery.trimmingCharacters(in: .whitespaces)
        guard q.isEmpty == false else { return availableFonts }
        return availableFonts.filter { $0.localizedCaseInsensitiveContains(q) }
    }
}

private struct ColorSchemeSwatch: View {
    let scheme: HCBColorScheme

    var body: some View {
        ZStack {
            Circle().fill(scheme.cream.swiftColor)
            Circle()
                .fill(scheme.ember.swiftColor)
                .frame(width: 8, height: 8)
                .offset(x: -3, y: -3)
            Circle()
                .fill(scheme.blue.swiftColor)
                .frame(width: 8, height: 8)
                .offset(x: 3, y: 3)
        }
        .frame(width: 22, height: 22)
        .overlay(Circle().strokeBorder(scheme.cardStroke.swiftColor, lineWidth: 0.5))
    }
}
