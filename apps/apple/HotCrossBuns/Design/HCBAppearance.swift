import SwiftUI

enum HCBBaseColorSchemePreference: String, CaseIterable, Identifiable {
    static let storageKey = "hcb.baseColorSchemePreference"

    case dark
    case light
    case system

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dark: "Dark"
        case .light: "Light"
        case .system: "Adapt to system"
        }
    }

    var preferredColorScheme: ColorScheme? {
        switch self {
        case .dark: .dark
        case .light: .light
        case .system: nil
        }
    }

    static func fallback(for settings: AppSettings) -> HCBBaseColorSchemePreference {
        HCBColorScheme.scheme(id: settings.colorSchemeID, customSchemes: settings.customColorSchemes)?.isDark == true ? .dark : .light
    }
}

enum HCBTextSize {
    static let minPoints: Double = 9
    static let maxPoints: Double = 24
    static let defaultPoints: Double = 13
    static let stepPoints: Double = 1

    static func clamp(_ points: Double) -> Double {
        max(minPoints, min(points, maxPoints))
    }
}

private struct HCBLayoutScaleKey: EnvironmentKey {
    static let defaultValue: CGFloat = 1.0
}

private struct HCBFontFamilyKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

extension EnvironmentValues {
    var hcbLayoutScale: CGFloat {
        get { self[HCBLayoutScaleKey.self] }
        set { self[HCBLayoutScaleKey.self] = newValue }
    }

    var hcbFontFamily: String? {
        get { self[HCBFontFamilyKey.self] }
        set { self[HCBFontFamilyKey.self] = newValue }
    }
}

private struct HCBTextSizePointsKey: EnvironmentKey {
    static let defaultValue: Double = HCBTextSize.defaultPoints
}

extension EnvironmentValues {
    var hcbTextSizePoints: Double {
        get { self[HCBTextSizePointsKey.self] }
        set { self[HCBTextSizePointsKey.self] = newValue }
    }
}

struct HCBAppearanceModifier: ViewModifier {
    let layoutScale: CGFloat
    let textSizePoints: Double
    let fontName: String?

    func body(content: Content) -> some View {
        content
            .environment(\.hcbLayoutScale, layoutScale)
            .environment(\.hcbFontFamily, fontName)
            .environment(\.hcbTextSizePoints, textSizePoints)
    }
}

struct HCBPreferredColorSchemeModifier: ViewModifier {
    let settings: AppSettings
    @AppStorage(HCBBaseColorSchemePreference.storageKey) private var storedPreference: String = ""

    func body(content: Content) -> some View {
        content.preferredColorScheme(resolvedPreference.preferredColorScheme)
    }

    private var resolvedPreference: HCBBaseColorSchemePreference {
        HCBBaseColorSchemePreference(rawValue: storedPreference) ?? HCBBaseColorSchemePreference.fallback(for: settings)
    }
}

extension View {
    // Applies the app-wide appearance (layout scale + text size + font family)
    // to a subtree. Use at the shell root AND at every out-of-tree presentation
    // site (sheets, popovers, menubar panels).
    func withHCBAppearance(_ settings: AppSettings) -> some View {
        modifier(HCBAppearanceModifier(
            layoutScale: CGFloat(settings.uiLayoutScale),
            textSizePoints: HCBTextSize.clamp(settings.uiTextSizePoints),
            fontName: settings.uiFontName
        ))
    }

    func hcbPreferredColorScheme(_ settings: AppSettings) -> some View {
        modifier(HCBPreferredColorSchemeModifier(settings: settings))
    }
}

// Layout helpers that multiply by the ambient hcbLayoutScale. Use these
// anywhere the app hard-codes a numeric padding / frame / icon size. Text
// sizes are NOT scaled — DynamicType + hcbFontFamily handle those.

extension View {
    func hcbScaledPadding(_ length: CGFloat) -> some View {
        modifier(HCBScaledPaddingModifier(length: length, edges: .all))
    }

    func hcbScaledPadding(_ edges: Edge.Set, _ length: CGFloat) -> some View {
        modifier(HCBScaledPaddingModifier(length: length, edges: edges))
    }

    func hcbScaledFrame(
        width: CGFloat? = nil,
        height: CGFloat? = nil,
        alignment: Alignment = .center
    ) -> some View {
        modifier(HCBScaledFrameModifier(width: width, height: height, alignment: alignment))
    }

    func hcbScaledFrame(
        minWidth: CGFloat? = nil,
        idealWidth: CGFloat? = nil,
        maxWidth: CGFloat? = nil,
        minHeight: CGFloat? = nil,
        idealHeight: CGFloat? = nil,
        maxHeight: CGFloat? = nil,
        alignment: Alignment = .center
    ) -> some View {
        modifier(HCBScaledFlexibleFrameModifier(
            minWidth: minWidth,
            idealWidth: idealWidth,
            maxWidth: maxWidth,
            minHeight: minHeight,
            idealHeight: idealHeight,
            maxHeight: maxHeight,
            alignment: alignment
        ))
    }

    // Applies a semantic text style that honors the custom UI font family.
    // If no custom family is set, falls back to SwiftUI's system font for
    // that style. DynamicType still scales text size independently.
    func hcbFont(_ style: HCBFontStyle) -> some View {
        modifier(HCBFontModifier(style: style, weight: nil))
    }

    // Weight-qualified variant — matches call sites like .font(.body.weight(.semibold)).
    func hcbFont(_ style: HCBFontStyle, weight: Font.Weight) -> some View {
        modifier(HCBFontModifier(style: style, weight: weight))
    }

    // Explicit-size call site that still honors the custom family. Size
    // stays fixed (no layoutScale) — text isn't part of the zoom.
    func hcbFontSystem(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> some View {
        modifier(HCBFontSystemModifier(size: size, weight: weight, design: design))
    }
}

enum HCBFontStyle {
    case largeTitle, title, title2, title3
    case headline, subheadline
    case body, callout, footnote
    case caption, caption2

    var systemFont: Font {
        switch self {
        case .largeTitle: return .largeTitle
        case .title: return .title
        case .title2: return .title2
        case .title3: return .title3
        case .headline: return .headline
        case .subheadline: return .subheadline
        case .body: return .body
        case .callout: return .callout
        case .footnote: return .footnote
        case .caption: return .caption
        case .caption2: return .caption2
        }
    }

    // Reference size (macOS) used when a custom font family is applied.
    // DynamicType scales these because Font.custom(_:size:relativeTo:) opts in.
    var referenceSize: CGFloat {
        switch self {
        case .largeTitle: return 26
        case .title: return 22
        case .title2: return 17
        case .title3: return 15
        case .headline: return 13
        case .subheadline: return 11
        case .body: return 13
        case .callout: return 12
        case .footnote: return 10
        case .caption: return 10
        case .caption2: return 10
        }
    }

    var relativeTextStyle: Font.TextStyle {
        switch self {
        case .largeTitle: return .largeTitle
        case .title: return .title
        case .title2: return .title2
        case .title3: return .title3
        case .headline: return .headline
        case .subheadline: return .subheadline
        case .body: return .body
        case .callout: return .callout
        case .footnote: return .footnote
        case .caption: return .caption
        case .caption2: return .caption2
        }
    }
}

private struct HCBScaledPaddingModifier: ViewModifier {
    @Environment(\.hcbLayoutScale) private var scale
    let length: CGFloat
    let edges: Edge.Set

    func body(content: Content) -> some View {
        content.padding(edges, length * scale)
    }
}

private struct HCBScaledFrameModifier: ViewModifier {
    @Environment(\.hcbLayoutScale) private var scale
    let width: CGFloat?
    let height: CGFloat?
    let alignment: Alignment

    func body(content: Content) -> some View {
        content.frame(
            width: width.map { $0 * scale },
            height: height.map { $0 * scale },
            alignment: alignment
        )
    }
}

private struct HCBScaledFlexibleFrameModifier: ViewModifier {
    @Environment(\.hcbLayoutScale) private var scale
    let minWidth: CGFloat?
    let idealWidth: CGFloat?
    let maxWidth: CGFloat?
    let minHeight: CGFloat?
    let idealHeight: CGFloat?
    let maxHeight: CGFloat?
    let alignment: Alignment

    func body(content: Content) -> some View {
        content.frame(
            minWidth: minWidth.map { $0 * scale },
            idealWidth: idealWidth.map { $0 * scale },
            maxWidth: maxWidth.map { $0 * scale },
            minHeight: minHeight.map { $0 * scale },
            idealHeight: idealHeight.map { $0 * scale },
            maxHeight: maxHeight.map { $0 * scale },
            alignment: alignment
        )
    }
}

private struct HCBFontModifier: ViewModifier {
    @Environment(\.hcbFontFamily) private var family
    @Environment(\.hcbTextSizePoints) private var basePoints
    let style: HCBFontStyle
    let weight: Font.Weight?

    func body(content: Content) -> some View {
        content.font(resolved)
    }

    // Literal size: style's reference size is scaled by (userBody / 13).
    // Picking 16 as body multiplies every semantic style by 16/13 ≈ 1.23.
    private var resolved: Font {
        let scale = basePoints / HCBTextSize.defaultPoints
        let size = style.referenceSize * scale
        let base: Font
        if let family, family.isEmpty == false {
            base = .custom(family, fixedSize: size)
        } else {
            base = .system(size: size)
        }
        if let weight {
            return base.weight(weight)
        }
        return base
    }
}

private struct HCBFontSystemModifier: ViewModifier {
    @Environment(\.hcbFontFamily) private var family
    @Environment(\.hcbTextSizePoints) private var basePoints
    let size: CGFloat
    let weight: Font.Weight
    let design: Font.Design

    func body(content: Content) -> some View {
        content.font(resolved)
    }

    // System-font call sites (e.g., explicit size) are rarer; still scale
    // them by the same body-size ratio so headings + icons follow the
    // user's chosen text size proportionally.
    private var resolved: Font {
        let scale = basePoints / HCBTextSize.defaultPoints
        let scaledSize = size * scale
        if let family, family.isEmpty == false {
            return Font.custom(family, fixedSize: scaledSize).weight(weight)
        }
        return .system(size: scaledSize, weight: weight, design: design)
    }
}

// Installed-font enumeration for the Settings picker.
enum HCBInstalledFonts {
    static func available() -> [String] {
        var names = Set<String>()
        for family in NSFontManager.shared.availableFontFamilies {
            names.insert(family)
        }
        return names.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }
}

// §6.11: per-surface appearance override. Re-derives the ambient
// hcbFontFamily / hcbTextSizePoints for a subtree so every nested
// `.hcbFont(.role)` call site inherits the surface's family + size without
// touching individual call sites. Unset fields on the override fall back to
// the global Appearance values, so users only see overrides where they've
// explicitly set one.
extension View {
    func hcbSurface(_ surface: HCBSurface) -> some View {
        modifier(HCBSurfaceAppearanceModifier(surface: surface))
    }
}

private struct HCBSurfaceAppearanceModifier: ViewModifier {
    @Environment(AppModel.self) private var model
    @Environment(\.hcbFontFamily) private var ambientFamily
    @Environment(\.hcbTextSizePoints) private var ambientPoints
    let surface: HCBSurface

    func body(content: Content) -> some View {
        let override = model.settings.perSurfaceFontOverrides[surface.rawValue] ?? .empty
        // Family: surface override → ambient (global) → nil (system font).
        let resolvedFamily: String? = {
            if let name = override.fontName, name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
                return name
            }
            return ambientFamily
        }()
        // Size: surface override clamped → ambient base points (already clamped upstream).
        let resolvedPoints: Double = override.pointSize.map { HCBTextSize.clamp($0) } ?? ambientPoints
        return content
            .environment(\.hcbFontFamily, resolvedFamily)
            .environment(\.hcbTextSizePoints, resolvedPoints)
    }
}
