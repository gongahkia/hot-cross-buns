import SwiftUI

struct LoadingView: View {
    let message: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isAnimating = false

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.regularMaterial)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                Image("LoadingBunsWelcome")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 104, height: 104)
                    .rotationEffect(reduceMotion ? .zero : .degrees(isAnimating ? 360 : 0))
                    .animation(
                        reduceMotion ? nil : .linear(duration: 1.25).repeatForever(autoreverses: false),
                        value: isAnimating
                    )
                    .accessibilityHidden(true)

                Text(message)
                    .hcbFont(.headline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(AppColor.ink)
            }
            .padding(28)
        }
        .onAppear { isAnimating = true }
    }
}

struct LoadingOverlayModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let state: LoadingOverlayState?

    func body(content: Content) -> some View {
        content
            .overlay {
                if let state {
                    LoadingView(message: state.message)
                        .hcbMotionTransition(.opacity)
                }
            }
            .animation(HCBMotion.animation(.easeInOut(duration: 0.18), reduceMotion: reduceMotion), value: state)
    }
}

extension View {
    func loadingOverlay(_ state: LoadingOverlayState?) -> some View {
        modifier(LoadingOverlayModifier(state: state))
    }
}
