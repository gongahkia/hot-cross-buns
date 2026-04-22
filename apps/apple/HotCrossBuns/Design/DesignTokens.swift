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
    static var cardSurface: Color { HCBColorSchemeStore.current.cardSurface.swiftColor }
}

struct AppBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .background {
                AppColor.cream
                    .ignoresSafeArea()
            }
    }
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
