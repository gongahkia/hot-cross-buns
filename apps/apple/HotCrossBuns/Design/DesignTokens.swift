import AppKit
import SwiftUI

// Semantic colors resolve through the active HCBColorScheme. AppColor.X
// accessors stay as static properties so the 185 existing call sites keep
// working; the actual palette comes from HCBColorSchemeStore.current,
// which Settings updates. The MacSidebarShell applies .id(schemeID) so
// views re-render when the scheme changes.
enum AppColor {
    static var ember: Color { HCBColorSchemeStore.current.ember.swiftColor }
    static var moss: Color { HCBColorSchemeStore.current.moss.swiftColor }
    static var blue: Color { HCBColorSchemeStore.current.blue.swiftColor }
    static var ink: Color { HCBColorSchemeStore.current.ink.swiftColor }
    static var cream: Color { HCBColorSchemeStore.current.cream.swiftColor }
    static var cardStroke: Color { HCBColorSchemeStore.current.cardStroke.swiftColor }
}

struct AppBackground: ViewModifier {
    func body(content: Content) -> some View {
        let scheme = HCBColorSchemeStore.current
        return content
            .scrollContentBackground(.hidden)
            .background {
                ZStack {
                    LinearGradient(
                        colors: gradientColors(for: scheme),
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Circle()
                        .fill(AppColor.ember.opacity(scheme.isDark ? 0.22 : 0.30))
                        .frame(width: 280, height: 280)
                        .blur(radius: 36)
                        .offset(x: -160, y: -260)
                    Circle()
                        .fill(AppColor.blue.opacity(scheme.isDark ? 0.14 : 0.18))
                        .frame(width: 360, height: 360)
                        .blur(radius: 48)
                        .offset(x: 180, y: 240)
                }
                .ignoresSafeArea()
            }
    }

    // Derive a subtle second gradient stop by brightening (light scheme)
    // or darkening (dark scheme) the base cream — avoids hard-coding per
    // scheme and still reads as a gradient, not a flat fill.
    private func gradientColors(for scheme: HCBColorScheme) -> [Color] {
        let base = scheme.cream
        let delta: Double = scheme.isDark ? 0.04 : -0.04
        let second = HCBColorScheme.RGB(
            red: clamp(base.red - delta),
            green: clamp(base.green - delta),
            blue: clamp(base.blue - delta),
            alpha: base.alpha
        )
        return [base.swiftColor, second.swiftColor]
    }

    private func clamp(_ v: Double) -> Double { max(0, min(1, v)) }
}

struct CardSurface: ViewModifier {
    var cornerRadius: CGFloat = 28

    func body(content: Content) -> some View {
        content
            .padding(18)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(AppColor.cardStroke, lineWidth: 1)
            }
    }
}

extension View {
    func appBackground() -> some View {
        modifier(AppBackground())
    }

    func cardSurface(cornerRadius: CGFloat = 28) -> some View {
        modifier(CardSurface(cornerRadius: cornerRadius))
    }
}

extension Color {
    init(hex: String) {
        let normalized = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var value: UInt64 = 0
        Scanner(string: normalized).scanHexInt64(&value)
        let red = Double((value >> 16) & 0xff) / 255.0
        let green = Double((value >> 8) & 0xff) / 255.0
        let blue = Double(value & 0xff) / 255.0
        self.init(red: red, green: green, blue: blue)
    }
}
