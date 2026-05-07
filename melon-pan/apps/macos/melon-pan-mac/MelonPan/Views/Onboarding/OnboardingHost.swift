import SwiftUI

struct OnboardingHost<Content: View>: View {
    @StateObject private var vm: OnboardingViewModel
    @ViewBuilder let content: () -> Content

    init(
        cacheRoot: String,
        onCacheRootChanged: @escaping (String) -> Void = { _ in },
        onFinished: @escaping () -> Void = {},
        @ViewBuilder content: @escaping () -> Content
    ) {
        _vm = StateObject(wrappedValue: OnboardingViewModel(
            cacheRoot: cacheRoot,
            onCacheRootChanged: onCacheRootChanged,
            onFinished: onFinished
        ))
        self.content = content
    }

    var body: some View {
        ZStack {
            if vm.state.isComplete {
                content()
            } else {
                wizard
                    .background(.regularMaterial)
                    .transition(.opacity)
            }
        }
    }

    private var wizard: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollView {
                stepBody
                    .frame(maxWidth: 680, alignment: .topLeading)
                    .padding(24)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            Divider()
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier(vm.currentStep.rawValue)
    }

    @ViewBuilder
    private var stepBody: some View {
        switch vm.currentStep {
        case .welcome:
            WelcomeStep(vm: vm)
        case .oauthClient:
            OAuthClientSetupStep(vm: vm)
        case .signIn:
            SignInStep(vm: vm)
        case .scope:
            ScopeStep(vm: vm)
        case .cacheRoot:
            CacheRootStep(vm: vm)
        case .encryption:
            EncryptionStep(vm: vm)
        case .notifications:
            NotificationsStep(vm: vm)
        case .driveFolder:
            DriveFolderStep(vm: vm)
        case .done:
            DoneStep(vm: vm)
        }
    }

    private var header: some View {
        HStack {
            Text("Setup")
                .font(.title3.weight(.semibold))
            Spacer()
            Text("Step \(vm.currentStep.index + 1) of \(OnboardingStep.allCases.count)")
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .accessibilityLabel(
            "Step \(vm.currentStep.index + 1) of \(OnboardingStep.allCases.count): \(vm.currentStep.title)"
        )
    }

    private var footer: some View {
        HStack {
            Button("Back") {
                vm.back()
            }
            .disabled(vm.currentStep == .welcome)
            Spacer()
            if vm.currentStep.isOptional {
                Button("Skip") {
                    vm.stepError = nil
                    markSkippedIfNeeded()
                    vm.advance()
                }
            }
            Button(vm.currentStep == .done ? "Open Melon Pan" : "Continue") {
                vm.currentStep == .done ? vm.finish() : vm.advance()
            }
            .keyboardShortcut(.defaultAction)
            .buttonStyle(.borderedProminent)
            .disabled(!vm.canAdvance(from: vm.currentStep))
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    private func markSkippedIfNeeded() {
        switch vm.currentStep {
        case .encryption:
            vm.update { $0.encryption = .skipped }
        case .notifications:
            vm.update { $0.notifications = .skipped }
        default:
            break
        }
    }
}

struct OnboardingStepCard<Content: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(title, systemImage: systemImage)
                .font(.title2.weight(.semibold))
            content()
        }
        .padding(20)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(.quaternary)
        )
    }
}
