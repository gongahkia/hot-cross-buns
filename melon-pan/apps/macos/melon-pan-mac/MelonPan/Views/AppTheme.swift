import AppKit
import SwiftUI

struct AppThemePreset: Identifiable, Equatable {
    let id: String
    let displayName: String
    let background: String
    let sidebar: String
    let surface: String
    let elevatedSurface: String
    let foreground: String
    let secondaryForeground: String
    let accent: String
    let caret: String
    let selection: String
    let separator: String
    let isDark: Bool
}

enum AppThemePresetRegistry {
    static let presets: [AppThemePreset] = [
        AppThemePreset(
            id: "Default",
            displayName: "Auto",
            background: "#fffaf0",
            sidebar: "#f2e4cf",
            surface: "#fbf1df",
            elevatedSurface: "#fffdf7",
            foreground: "#28231d",
            secondaryForeground: "#8c7861",
            accent: "#a76f2b",
            caret: "#a76f2b",
            selection: "#ead7bb",
            separator: "#e1cfb6",
            isDark: false
        ),
        AppThemePreset(
            id: "Default Dark",
            displayName: "Dark",
            background: "#28231e",
            sidebar: "#211c18",
            surface: "#302a24",
            elevatedSurface: "#3a3129",
            foreground: "#f2e7d5",
            secondaryForeground: "#b7aa99",
            accent: "#d6b47e",
            caret: "#d6b47e",
            selection: "#5c4630",
            separator: "#4b4036",
            isDark: true
        ),
        AppThemePreset(
            id: "Solarized Light",
            displayName: "Solarized Light",
            background: "#fdf6e3",
            sidebar: "#eee8d5",
            surface: "#f7f0d8",
            elevatedSurface: "#fffaf0",
            foreground: "#586e75",
            secondaryForeground: "#839496",
            accent: "#268bd2",
            caret: "#268bd2",
            selection: "#c9e2ee",
            separator: "#d8cfb7",
            isDark: false
        ),
        AppThemePreset(
            id: "Solarized Dark",
            displayName: "Solarized Dark",
            background: "#002b36",
            sidebar: "#073642",
            surface: "#0b3d49",
            elevatedSurface: "#114c59",
            foreground: "#93a1a1",
            secondaryForeground: "#657b83",
            accent: "#268bd2",
            caret: "#268bd2",
            selection: "#174d5f",
            separator: "#19505b",
            isDark: true
        ),
        AppThemePreset(
            id: "Dracula",
            displayName: "Dracula",
            background: "#282a36",
            sidebar: "#21222c",
            surface: "#303241",
            elevatedSurface: "#383a4a",
            foreground: "#f8f8f2",
            secondaryForeground: "#bdc0d0",
            accent: "#ff79c6",
            caret: "#ff79c6",
            selection: "#51446e",
            separator: "#44475a",
            isDark: true
        ),
        AppThemePreset(
            id: "Gruvbox Dark",
            displayName: "Gruvbox Dark",
            background: "#282828",
            sidebar: "#1d2021",
            surface: "#32302f",
            elevatedSurface: "#3c3836",
            foreground: "#ebdbb2",
            secondaryForeground: "#a89984",
            accent: "#fabd2f",
            caret: "#fabd2f",
            selection: "#5c4a24",
            separator: "#504945",
            isDark: true
        ),
        AppThemePreset(
            id: "Nord",
            displayName: "Nord",
            background: "#2e3440",
            sidebar: "#3b4252",
            surface: "#353c4a",
            elevatedSurface: "#434c5e",
            foreground: "#d8dee9",
            secondaryForeground: "#a9b2c3",
            accent: "#88c0d0",
            caret: "#88c0d0",
            selection: "#45556f",
            separator: "#4c566a",
            isDark: true
        ),
        AppThemePreset(
            id: "Catppuccin Latte",
            displayName: "Catppuccin Latte",
            background: "#eff1f5",
            sidebar: "#e6e9ef",
            surface: "#ccd0da",
            elevatedSurface: "#dce0e8",
            foreground: "#4c4f69",
            secondaryForeground: "#6c6f85",
            accent: "#8839ef",
            caret: "#8839ef",
            selection: "#bcc0cc",
            separator: "#acb0be",
            isDark: false
        ),
        AppThemePreset(
            id: "Catppuccin Mocha",
            displayName: "Catppuccin Mocha",
            background: "#1e1e2e",
            sidebar: "#181825",
            surface: "#313244",
            elevatedSurface: "#45475a",
            foreground: "#cdd6f4",
            secondaryForeground: "#a6adc8",
            accent: "#cba6f7",
            caret: "#f5e0dc",
            selection: "#45475a",
            separator: "#585b70",
            isDark: true
        ),
        AppThemePreset(
            id: "Tokyo Night",
            displayName: "Tokyo Night",
            background: "#1a1b26",
            sidebar: "#16161e",
            surface: "#24283b",
            elevatedSurface: "#2f3549",
            foreground: "#c0caf5",
            secondaryForeground: "#9aa5ce",
            accent: "#7aa2f7",
            caret: "#7dcfff",
            selection: "#33467c",
            separator: "#3b4261",
            isDark: true
        ),
        AppThemePreset(
            id: "One Dark",
            displayName: "One Dark",
            background: "#282c34",
            sidebar: "#21252b",
            surface: "#2c313c",
            elevatedSurface: "#353b45",
            foreground: "#abb2bf",
            secondaryForeground: "#7f848e",
            accent: "#61afef",
            caret: "#528bff",
            selection: "#3e4451",
            separator: "#4b5263",
            isDark: true
        ),
        AppThemePreset(
            id: "GitHub Light",
            displayName: "GitHub Light",
            background: "#ffffff",
            sidebar: "#f6f8fa",
            surface: "#f6f8fa",
            elevatedSurface: "#ffffff",
            foreground: "#24292f",
            secondaryForeground: "#57606a",
            accent: "#0969da",
            caret: "#0969da",
            selection: "#ddf4ff",
            separator: "#d0d7de",
            isDark: false
        ),
        AppThemePreset(
            id: "GitHub Dark",
            displayName: "GitHub Dark",
            background: "#0d1117",
            sidebar: "#010409",
            surface: "#161b22",
            elevatedSurface: "#21262d",
            foreground: "#c9d1d9",
            secondaryForeground: "#8b949e",
            accent: "#58a6ff",
            caret: "#79c0ff",
            selection: "#264f78",
            separator: "#30363d",
            isDark: true
        ),
        AppThemePreset(
            id: "Ayu Light",
            displayName: "Ayu Light",
            background: "#fafafa",
            sidebar: "#f0f0f0",
            surface: "#f3f4f5",
            elevatedSurface: "#ffffff",
            foreground: "#5c6773",
            secondaryForeground: "#828c99",
            accent: "#ff9940",
            caret: "#ffaa33",
            selection: "#e6eef7",
            separator: "#d9d8d7",
            isDark: false
        ),
        AppThemePreset(
            id: "Ayu Mirage",
            displayName: "Ayu Mirage",
            background: "#1f2430",
            sidebar: "#191e2a",
            surface: "#242936",
            elevatedSurface: "#2b3140",
            foreground: "#cbccc6",
            secondaryForeground: "#707a8c",
            accent: "#ffcc66",
            caret: "#ffcc66",
            selection: "#33415e",
            separator: "#3d4558",
            isDark: true
        ),
        AppThemePreset(
            id: "Rose Pine",
            displayName: "Rose Pine",
            background: "#191724",
            sidebar: "#12101a",
            surface: "#1f1d2e",
            elevatedSurface: "#26233a",
            foreground: "#e0def4",
            secondaryForeground: "#908caa",
            accent: "#ebbcba",
            caret: "#c4a7e7",
            selection: "#403d52",
            separator: "#524f67",
            isDark: true
        ),
        AppThemePreset(
            id: "Everforest Dark",
            displayName: "Everforest Dark",
            background: "#2d353b",
            sidebar: "#232a2e",
            surface: "#343f44",
            elevatedSurface: "#3d484d",
            foreground: "#d3c6aa",
            secondaryForeground: "#9da9a0",
            accent: "#a7c080",
            caret: "#dbbc7f",
            selection: "#4f585e",
            separator: "#56635f",
            isDark: true
        ),
        AppThemePreset(
            id: "High Contrast Light",
            displayName: "High Contrast Light",
            background: "#ffffff",
            sidebar: "#f2f2f2",
            surface: "#ffffff",
            elevatedSurface: "#ffffff",
            foreground: "#000000",
            secondaryForeground: "#333333",
            accent: "#0047ff",
            caret: "#0047ff",
            selection: "#b8d7ff",
            separator: "#5f6368",
            isDark: false
        ),
        AppThemePreset(
            id: "High Contrast Dark",
            displayName: "High Contrast Dark",
            background: "#000000",
            sidebar: "#101010",
            surface: "#171717",
            elevatedSurface: "#242424",
            foreground: "#ffffff",
            secondaryForeground: "#d0d0d0",
            accent: "#ffd400",
            caret: "#00e5ff",
            selection: "#314a00",
            separator: "#8a8a8a",
            isDark: true
        )
    ]

    static var allNames: [String] {
        presets.map(\.id)
    }

    static func preset(named name: String) -> AppThemePreset {
        presets.first { $0.id == name } ?? presets[0]
    }
}

struct AppThemePalette {
    let name: String
    let background: NSColor
    let sidebar: NSColor
    let surface: NSColor
    let elevatedSurface: NSColor
    let foreground: NSColor
    let secondaryForeground: NSColor
    let accent: NSColor
    let caret: NSColor
    let selection: NSColor
    let separator: NSColor
    let isDark: Bool

    init(name: String) {
        let preset = AppThemePresetRegistry.preset(named: name)
        self.name = preset.id
        background = NSColor.melonPanHex(preset.background)
        sidebar = NSColor.melonPanHex(preset.sidebar)
        surface = NSColor.melonPanHex(preset.surface)
        elevatedSurface = NSColor.melonPanHex(preset.elevatedSurface)
        foreground = NSColor.melonPanHex(preset.foreground)
        secondaryForeground = NSColor.melonPanHex(preset.secondaryForeground)
        accent = NSColor.melonPanHex(preset.accent)
        caret = NSColor.melonPanHex(preset.caret)
        selection = NSColor.melonPanHex(preset.selection)
        separator = NSColor.melonPanHex(preset.separator)
        isDark = preset.isDark
    }
}

struct AppUIFont: Equatable {
    let requestedFamily: String
    let resolvedFamily: String?
    let size: CGFloat

    var displayName: String {
        resolvedFamily ?? "System"
    }
}

enum AppUIFontResolver {
    static let systemFamily = ""
    static let minSize = 10
    static let maxSize = 18

    static var availableFontFamilies: [String] {
        NSFontManager.shared.availableFontFamilies.sorted {
            $0.localizedCaseInsensitiveCompare($1) == .orderedAscending
        }
    }

    static func resolvedFont(settings: AppSettings) -> AppUIFont {
        let requested = settings.mac.uiFontFamily.trimmingCharacters(in: .whitespacesAndNewlines)
        let size = CGFloat(clampedSize(settings.mac.uiFontSize))
        guard !requested.isEmpty else {
            return AppUIFont(requestedFamily: requested, resolvedFamily: nil, size: size)
        }
        guard availableFontFamilies.contains(requested) else {
            return AppUIFont(requestedFamily: requested, resolvedFamily: nil, size: size)
        }
        return AppUIFont(requestedFamily: requested, resolvedFamily: requested, size: size)
    }

    static func clampedSize(_ size: Int) -> Int {
        min(max(size, minSize), maxSize)
    }

    static func font(
        family: String?,
        size: CGFloat,
        weight: NSFont.Weight = .regular
    ) -> Font {
        let nsFont: NSFont
        if let family, !family.isEmpty,
           let resolved = NSFontManager.shared.font(
            withFamily: family,
            traits: [],
            weight: nsFontManagerWeight(for: weight),
            size: size
           )
        {
            nsFont = resolved
        } else {
            nsFont = NSFont.systemFont(ofSize: size, weight: weight)
        }
        return Font(nsFont)
    }

    private static func nsFontManagerWeight(for weight: NSFont.Weight) -> Int {
        switch weight {
        case .ultraLight:
            return 1
        case .thin:
            return 2
        case .light:
            return 3
        case .regular:
            return 5
        case .medium:
            return 6
        case .semibold:
            return 8
        case .bold:
            return 9
        case .heavy:
            return 10
        case .black:
            return 12
        default:
            return 5
        }
    }
}

struct AppTheme {
    let palette: AppThemePalette
    let background: Color
    let sidebar: Color
    let surface: Color
    let elevatedSurface: Color
    let foreground: Color
    let secondaryForeground: Color
    let accent: Color
    let caret: Color
    let selection: Color
    let separator: Color
    let preferredColorScheme: ColorScheme?

    init(settings: AppSettings = .default) {
        let palette = AppThemePalette(name: settings.colorScheme)
        let defaults = AppSettings.default
        let background = Self.overrideColor(
            settings.customBackground,
            defaultValue: defaults.customBackground,
            paletteColor: palette.background,
            settings: settings
        )
        let sidebar = Self.overrideColor(
            settings.customSidebar,
            defaultValue: defaults.customSidebar,
            paletteColor: palette.sidebar,
            settings: settings
        )
        let accent = Self.overrideColor(
            settings.customAccent,
            defaultValue: defaults.customAccent,
            paletteColor: palette.accent,
            settings: settings
        )

        self.palette = palette
        self.background = Color(nsColor: background)
        self.sidebar = Color(nsColor: sidebar)
        surface = Color(nsColor: palette.surface)
        elevatedSurface = Color(nsColor: palette.elevatedSurface)
        foreground = Color(nsColor: palette.foreground)
        secondaryForeground = Color(nsColor: palette.secondaryForeground)
        self.accent = Color(nsColor: accent)
        caret = Color(nsColor: palette.caret)
        selection = Color(nsColor: palette.selection)
        separator = Color(nsColor: palette.separator)
        preferredColorScheme = palette.isDark ? .dark : .light
    }

    private static func overrideColor(
        _ value: String,
        defaultValue: String,
        paletteColor: NSColor,
        settings: AppSettings
    ) -> NSColor {
        guard settings.colorScheme == AppSettings.default.colorScheme || value != defaultValue else {
            return paletteColor
        }
        return NSColor.melonPanHexIfValid(value) ?? paletteColor
    }
}

private struct AppThemeKey: EnvironmentKey {
    static let defaultValue = AppTheme()
}

private struct AppUIFontKey: EnvironmentKey {
    static let defaultValue = AppUIFontResolver.resolvedFont(settings: .default)
}

extension EnvironmentValues {
    var appTheme: AppTheme {
        get { self[AppThemeKey.self] }
        set { self[AppThemeKey.self] = newValue }
    }

    var appUIFont: AppUIFont {
        get { self[AppUIFontKey.self] }
        set { self[AppUIFontKey.self] = newValue }
    }
}

private struct AppThemeModifier: ViewModifier {
    let settings: AppSettings

    func body(content: Content) -> some View {
        let theme = AppTheme(settings: settings)
        let uiFont = AppUIFontResolver.resolvedFont(settings: settings)
        content
            .environment(\.appTheme, theme)
            .environment(\.appUIFont, uiFont)
            .font(.melonPanUI(uiFont))
            .preferredColorScheme(theme.preferredColorScheme)
            .tint(theme.accent)
            .accentColor(theme.accent)
            .foregroundStyle(theme.foreground)
            .background(theme.background.ignoresSafeArea())
    }
}

extension View {
    func melonPanThemed(settings: AppSettings) -> some View {
        modifier(AppThemeModifier(settings: settings))
    }
}

extension Font {
    static func melonPanUI(
        _ uiFont: AppUIFont,
        relativeSize: CGFloat = 0,
        weight: NSFont.Weight = .regular
    ) -> Font {
        AppUIFontResolver.font(
            family: uiFont.resolvedFamily,
            size: uiFont.size + relativeSize,
            weight: weight
        )
    }
}

extension NSColor {
    static func melonPanHex(_ hex: String) -> NSColor {
        melonPanHexIfValid(hex) ?? .controlAccentColor
    }

    static func melonPanHexIfValid(_ hex: String) -> NSColor? {
        let trimmed = hex.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard trimmed.count == 6 else { return nil }
        var value: UInt64 = 0
        guard Scanner(string: trimmed).scanHexInt64(&value) else { return nil }
        let red = CGFloat((value >> 16) & 0xff) / 255.0
        let green = CGFloat((value >> 8) & 0xff) / 255.0
        let blue = CGFloat(value & 0xff) / 255.0
        return NSColor(calibratedRed: red, green: green, blue: blue, alpha: 1)
    }
}
