import SwiftUI

enum AppColor {
    static let ember = Color(red: 0.965, green: 0.420, blue: 0.231)
    static let ink = Color(red: 0.106, green: 0.118, blue: 0.145)
    static let cream = Color(red: 0.988, green: 0.957, blue: 0.894)
    static let moss = Color(red: 0.235, green: 0.447, blue: 0.333)
    static let blue = Color(red: 0.086, green: 0.467, blue: 1.000)
    static let cardStroke = Color.white.opacity(0.22)
}

struct AppBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .background {
                ZStack {
                    LinearGradient(
                        colors: [AppColor.cream, Color(red: 0.992, green: 0.886, blue: 0.737)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Circle()
                        .fill(AppColor.ember.opacity(0.30))
                        .frame(width: 280, height: 280)
                        .blur(radius: 36)
                        .offset(x: -160, y: -260)
                    Circle()
                        .fill(AppColor.blue.opacity(0.18))
                        .frame(width: 360, height: 360)
                        .blur(radius: 48)
                        .offset(x: 180, y: 240)
                }
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
