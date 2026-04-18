import AppKit
import SwiftUI

enum AppColor {
    static let ember = Color(red: 0.965, green: 0.420, blue: 0.231)
    static let moss = Color(red: 0.235, green: 0.447, blue: 0.333)
    static let blue = Color(red: 0.086, green: 0.467, blue: 1.000)

    static let ink = dynamic(
        light: NSColor(red: 0.106, green: 0.118, blue: 0.145, alpha: 1),
        dark: NSColor(red: 0.960, green: 0.955, blue: 0.935, alpha: 1)
    )

    static let cream = dynamic(
        light: NSColor(red: 0.988, green: 0.957, blue: 0.894, alpha: 1),
        dark: NSColor(red: 0.145, green: 0.135, blue: 0.120, alpha: 1)
    )

    static let cardStroke = dynamic(
        light: NSColor(white: 0, alpha: 0.08),
        dark: NSColor(white: 1, alpha: 0.14)
    )

    private static func dynamic(light: NSColor, dark: NSColor) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .vibrantDark, .accessibilityHighContrastDarkAqua, .accessibilityHighContrastVibrantDark]) != nil
            return isDark ? dark : light
        })
    }
}

struct AppBackground: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .background {
                ZStack {
                    LinearGradient(
                        colors: gradientColors,
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Circle()
                        .fill(AppColor.ember.opacity(colorScheme == .dark ? 0.22 : 0.30))
                        .frame(width: 280, height: 280)
                        .blur(radius: 36)
                        .offset(x: -160, y: -260)
                    Circle()
                        .fill(AppColor.blue.opacity(colorScheme == .dark ? 0.14 : 0.18))
                        .frame(width: 360, height: 360)
                        .blur(radius: 48)
                        .offset(x: 180, y: 240)
                }
                .ignoresSafeArea()
            }
    }

    private var gradientColors: [Color] {
        if colorScheme == .dark {
            return [
                Color(red: 0.102, green: 0.095, blue: 0.090),
                Color(red: 0.158, green: 0.134, blue: 0.110)
            ]
        }
        return [
            AppColor.cream,
            Color(red: 0.992, green: 0.886, blue: 0.737)
        ]
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
