// First-run welcome surface.
// Shows the cache root + credentials path resolution so the user can
// confirm where their data will live before signing in.

import SwiftUI

struct WelcomeView: View {
    @Environment(\.appTheme) private var theme
    @EnvironmentObject private var session: AppSession
    @State private var showSignIn = false

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                Spacer(minLength: 12)

                VStack(spacing: 16) {
                    Image("melon-pan-main")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 120, height: 120)
                        .accessibilityHidden(true)

                    VStack(spacing: 8) {
                        Text("Melon Pan")
                            .font(.system(size: 40, weight: .bold))
                        Text("Rich Google Docs as the source of truth.")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        Text("Press ⌘P to open the command palette.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }

                    HStack(spacing: 12) {
                        if session.activeAccount == nil {
                            Button {
                                showSignIn = true
                            } label: {
                                Label("Sign in with Google", systemImage: "person.crop.circle.badge.plus")
                            }
                            .buttonStyle(.borderedProminent)
                        } else {
                            Button {
                                session.refreshDriveTree()
                            } label: {
                                Label("Refresh Drive", systemImage: "arrow.clockwise")
                            }
                            .buttonStyle(.borderedProminent)
                        }

                        Button {
                            session.openUtilityWindow(.diagnostics)
                        } label: {
                            Label("Open Diagnostics", systemImage: "stethoscope")
                        }
                        .buttonStyle(.bordered)

                        if !session.onboardingCompleted {
                            Button {
                                session.showOnboardingSheet = true
                            } label: {
                                Label("Run setup", systemImage: "checklist")
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    InfoRow(
                        title: "Active account",
                        value: session.activeAccount ?? "Not signed in"
                    )
                    InfoRow(
                        title: "Cache root",
                        value: session.cacheRoot,
                        monospacedValue: true
                    )
                    InfoRow(
                        title: "Credentials",
                        value: session.credentialsPath,
                        monospacedValue: true
                    )
                }
                .padding(16)
                .background(theme.surface.opacity(0.88), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(theme.separator.opacity(0.8), lineWidth: 1)
                )
                .frame(maxWidth: 560)

                Spacer(minLength: 12)
            }
            .frame(maxWidth: .infinity, minHeight: 520)
            .padding(32)
        }
        .background(theme.background)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .sheet(isPresented: $showSignIn) {
            SignInSheet()
                .environmentObject(session)
        }
    }
}

#Preview {
    WelcomeView().environmentObject(AppSession())
}
