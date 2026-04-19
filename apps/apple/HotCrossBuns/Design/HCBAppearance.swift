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

// Layout helpers that multiply by the ambient hcbLayoutScale.
extension View {
    func hcbScaledPadding(_ length: CGFloat) -> some View {
        modifier(HCBScaledPaddingModifier(length: length, edges: .all))
    }

    func hcbScaledPadding(_ edges: Edge.Set, _ length: CGFloat) -> some View {
        modifier(HCBScaledPaddingModifier(length: length, edges: edges))
    }

    func hcbScaledFrame(width: CGFloat? = nil, height: CGFloat? = nil, alignment: Alignment = .center) -> some View {
        modifier(HCBScaledFrameModifier(width: width, height: height, alignment: alignment))
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
