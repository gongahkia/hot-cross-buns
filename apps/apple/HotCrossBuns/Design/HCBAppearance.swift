import SwiftUI

enum HCBTextSizeLadder {
    static let sizes: [DynamicTypeSize] = [
        .xSmall,
        .small,
        .medium,
        .large,
        .xLarge,
        .xxLarge,
        .xxxLarge
    ]

    static let titles: [String] = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"]

    static func size(forStep step: Int) -> DynamicTypeSize {
        sizes[clamped(step)]
    }

    static func clamped(_ step: Int) -> Int {
        max(0, min(step, sizes.count - 1))
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

struct HCBAppearanceModifier: ViewModifier {
    let layoutScale: CGFloat
    let textSize: DynamicTypeSize
    let fontName: String?

    func body(content: Content) -> some View {
        let resolvedFont = Self.resolvedFont(fontName)
        return content
            .environment(\.hcbLayoutScale, layoutScale)
            .environment(\.hcbFontFamily, fontName)
            .dynamicTypeSize(textSize)
            .modifier(OptionalFontModifier(font: resolvedFont))
    }

    // Only override \.font if a custom family is set. Setting it to .body
    // when nil would clobber SwiftUI's per-view font resolution (e.g. .font(.headline)).
    static func resolvedFont(_ name: String?) -> Font? {
        guard let name, name.isEmpty == false else { return nil }
        // Use a relative font so DynamicTypeSize still scales it.
        return Font.custom(name, size: NSFont.systemFontSize, relativeTo: .body)
    }
}

private struct OptionalFontModifier: ViewModifier {
    let font: Font?

    func body(content: Content) -> some View {
        if let font {
            content.environment(\.font, font)
        } else {
            content
        }
    }
}

extension View {
    // Applies the app-wide appearance (layout scale + text size + font family)
    // to a subtree. Use at the shell root AND at every out-of-tree presentation
    // site (sheets, popovers, menubar panels).
    func withHCBAppearance(_ settings: AppSettings) -> some View {
        modifier(HCBAppearanceModifier(
            layoutScale: CGFloat(settings.uiLayoutScale),
            textSize: HCBTextSizeLadder.size(forStep: settings.uiTextSizeStep),
            fontName: settings.uiFontName
        ))
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
    let style: HCBFontStyle
    let weight: Font.Weight?

    func body(content: Content) -> some View {
        content.font(resolved)
    }

    private var resolved: Font {
        let base: Font
        if let family, family.isEmpty == false {
            base = .custom(family, size: style.referenceSize, relativeTo: style.relativeTextStyle)
        } else {
            base = style.systemFont
        }
        if let weight {
            return base.weight(weight)
        }
        return base
    }
}

private struct HCBFontSystemModifier: ViewModifier {
    @Environment(\.hcbFontFamily) private var family
    let size: CGFloat
    let weight: Font.Weight
    let design: Font.Design

    func body(content: Content) -> some View {
        content.font(resolved)
    }

    private var resolved: Font {
        if let family, family.isEmpty == false {
            // Custom fonts don't honor Font.Design — design is system-only.
            // Apply weight on top of the custom family.
            return Font.custom(family, size: size, relativeTo: .body).weight(weight)
        }
        return .system(size: size, weight: weight, design: design)
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
