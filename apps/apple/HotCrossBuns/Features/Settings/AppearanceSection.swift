import SwiftUI

struct AppearanceSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var systemColorScheme
    @AppStorage(HCBBaseColorSchemePreference.storageKey) private var baseColorSchemePreference: String = ""
    @State private var fontQuery: String = ""
    @State private var availableFonts: [String] = []

    var body: some View {
        Section("Appearance") {
            colourPanel
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
            coerceThemeToBaseColourScheme()
        }
        .onChange(of: effectiveThemeIsDark) { _, _ in
            coerceThemeToBaseColourScheme()
        }
    }

    private var colourPanel: some View {
        VStack(spacing: 0) {
            baseColourSchemeRow
            Divider()
                .hcbScaledPadding(.vertical, 10)
            themeRow
        }
    }

    private var baseColourSchemeRow: some View {
        HStack(alignment: .center, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Base colour scheme")
                    .hcbFont(.body, weight: .semibold)
                Text("Choose whether app chrome resolves as dark, light, or follows macOS.")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 16)
            Picker("Base colour scheme", selection: baseColourSchemeBinding) {
                ForEach(HCBBaseColorSchemePreference.allCases) { preference in
                    Text(preference.title).tag(preference)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .frame(width: 170)
        }
    }

    private var themeRow: some View {
        HStack(alignment: .center, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Themes")
                    .hcbFont(.body, weight: .semibold)
                Text("Choose the Hot Cross Buns palette used by cards, text, and app surfaces.")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 16)
            HStack(spacing: 8) {
                Button("Reset to \(defaultTheme.title)") { model.setColorSchemeID(defaultTheme.id) }
                    .buttonStyle(.borderless)
                    .hcbFont(.caption)
                    .disabled(model.settings.colorSchemeID == defaultTheme.id)
                Picker("Theme", selection: Binding(
                    get: { model.settings.colorSchemeID },
                    set: { newID in
                        guard filteredThemes.contains(where: { $0.id == newID }) else { return }
                        model.setColorSchemeID(newID)
                    }
                )) {
                    ForEach(filteredThemes) { scheme in
                        HStack(spacing: 8) {
                            ColorSchemeSwatch(scheme: scheme)
                            Text(scheme.title)
                        }
                        .tag(scheme.id)
                    }
                }
                .pickerStyle(.menu)
                .frame(width: 190)
            }
        }
    }

    private var baseColourSchemeBinding: Binding<HCBBaseColorSchemePreference> {
        Binding(
            get: {
                HCBBaseColorSchemePreference(rawValue: baseColorSchemePreference) ?? HCBBaseColorSchemePreference.fallback(for: model.settings)
            },
            set: { preference in
                baseColorSchemePreference = preference.rawValue
                coerceThemeToBaseColourScheme(for: preference)
            }
        )
    }

    private var resolvedBaseColourScheme: HCBBaseColorSchemePreference {
        HCBBaseColorSchemePreference(rawValue: baseColorSchemePreference) ?? HCBBaseColorSchemePreference.fallback(for: model.settings)
    }

    private var effectiveThemeIsDark: Bool {
        switch resolvedBaseColourScheme {
        case .dark:
            true
        case .light:
            false
        case .system:
            systemColorScheme == .dark
        }
    }

    private var filteredThemes: [HCBColorScheme] {
        HCBColorScheme.all.filter { $0.isDark == effectiveThemeIsDark }
    }

    private var defaultTheme: HCBColorScheme {
        filteredThemes.first ?? .notion
    }

    private func coerceThemeToBaseColourScheme(for preference: HCBBaseColorSchemePreference? = nil) {
        let targetIsDark: Bool
        switch preference ?? resolvedBaseColourScheme {
        case .dark:
            targetIsDark = true
        case .light:
            targetIsDark = false
        case .system:
            targetIsDark = systemColorScheme == .dark
        }

        guard HCBColorScheme.scheme(id: model.settings.colorSchemeID)?.isDark != targetIsDark else { return }
        let replacement = HCBColorScheme.all.first { $0.isDark == targetIsDark } ?? HCBColorScheme.notion
        model.setColorSchemeID(replacement.id)
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
