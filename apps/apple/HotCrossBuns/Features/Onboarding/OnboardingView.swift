import SwiftUI
import AppKit

private enum OnboardingStage {
    case introWelcome
    case introDetails
    case setup
}

struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var stage: OnboardingStage = .introWelcome

    var body: some View {
        NavigationStack {
            Group {
                switch stage {
                case .introWelcome:
                    IntroWelcomeView(
                        onContinue: { stage = .introDetails },
                        onLater: finish
                    )
                case .introDetails:
                    IntroDetailsView(
                        onContinue: { stage = .setup },
                        onLater: finish
                    )
                case .setup:
                    setupBody
                }
            }
            .appBackground()
            .navigationTitle(stage == .setup ? "Set Up" : "Welcome")
        }
        .interactiveDismissDisabled(model.settings.hasCompletedOnboarding == false)
    }

    private var setupBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ConnectGoogleCard()
                SyncPreferenceCard()
                SourceSelectionCard()
                ReminderPreferenceCard()
                FinishOnboardingCard(finish: finish)
            }
            .hcbScaledPadding(20)
        }
    }

    private func finish() {
        model.completeOnboarding()
        dismiss()
    }
}

private struct IntroWelcomeView: View {
    let onContinue: () -> Void
    let onLater: () -> Void

    private var heroImage: NSImage? {
        guard let url = Bundle.main.url(
            forResource: "buns-welcomepage",
            withExtension: "webp",
            subdirectory: "Onboarding"
        ) else {
            return nil
        }
        return NSImage(contentsOf: url)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Text("Welcome to Hot Cross Buns")
                    .font(.system(.largeTitle, design: .serif, weight: .bold))
                    .foregroundStyle(AppColor.ink)
                    .fixedSize(horizontal: false, vertical: true)

                Group {
                    if let heroImage {
                        Image(nsImage: heroImage)
                            .resizable()
                            .scaledToFit()
                    } else {
                        Image(systemName: "photo")
                            .resizable()
                            .scaledToFit()
                            .foregroundStyle(.secondary)
                    }
                }
                .hcbScaledFrame(maxWidth: 520)
                .frame(maxWidth: .infinity)

                HStack {
                    Button("Later", action: onLater)
                        .buttonStyle(.borderless)
                    Spacer()
                    Button {
                        onContinue()
                    } label: {
                        Label("Continue", systemImage: "arrow.right")
                            .hcbScaledFrame(minWidth: 120)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppColor.ember)
                    .keyboardShortcut(.defaultAction)
                }
            }
            .hcbScaledPadding(28)
            .cardSurface(cornerRadius: 16)
            .hcbScaledPadding(20)
        }
    }
}

private struct IntroDetailsView: View {
    let onContinue: () -> Void
    let onLater: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Hot Cross Buns")
                        .font(.system(.largeTitle, design: .serif, weight: .bold))
                        .foregroundStyle(AppColor.ink)
                    Text("A Mac-native client for Google Tasks and Google Calendar.")
                        .hcbFont(.title3)
                        .foregroundStyle(.secondary)
                }

                VStack(alignment: .leading, spacing: 14) {
                    introPoint(
                        icon: "cloud.fill",
                        title: "Your data stays with Google",
                        body: "Hot Cross Buns is a viewer and editor. Every task and event lives in your Google account; edits in Gmail, the Calendar web UI, or your phone show up here and vice versa."
                    )
                    introPoint(
                        icon: "bolt.fill",
                        title: "Fast and offline-tolerant",
                        body: "New tasks and events appear instantly, even without a connection. They show a pending badge until Google accepts them, then the local ID is swapped for the server one."
                    )
                    introPoint(
                        icon: "lock.fill",
                        title: "No extra servers",
                        body: "We don't run a backend. Your OAuth token stays in the Keychain; sync goes directly to Google's APIs. Disconnecting Google in Settings wipes local state."
                    )
                }

                HStack {
                    Button("Later", action: onLater)
                        .buttonStyle(.borderless)
                    Spacer()
                    Button {
                        onContinue()
                    } label: {
                        Label("Continue", systemImage: "arrow.right")
                            .hcbScaledFrame(minWidth: 120)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppColor.ember)
                    .keyboardShortcut(.defaultAction)
                }
            }
            .hcbScaledPadding(28)
            .cardSurface(cornerRadius: 16)
            .hcbScaledPadding(20)
        }
    }

    private func introPoint(icon: String, title: String, body: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .hcbFont(.title3)
                .foregroundStyle(AppColor.ember)
                .hcbScaledFrame(width: 28, height: 28)
                .background(Circle().fill(AppColor.ember.opacity(0.15)))
            VStack(alignment: .leading, spacing: 4) {
                Text(title).hcbFont(.headline)
                Text(body).hcbFont(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}

private struct ConnectGoogleCard: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            OnboardingStepHeader(number: 1, title: "Connect Google", systemImage: "person.crop.circle.badge.checkmark")

            switch model.authState {
            case .signedIn(let account):
                Label(account.displayName, systemImage: "checkmark.circle.fill")
                    .foregroundStyle(AppColor.moss)
                Text("Signed in with Tasks + Calendar scopes.")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            case .authenticating:
                ProgressView("Opening Google Sign-In")
            case .failed(let message):
                Text(message)
                    .hcbFont(.footnote)
                    .foregroundStyle(.red)
                connectButton
                scopeFootnote
            case .signedOut:
                Text("Sign in once to grant access. Hot Cross Buns asks for Google Tasks + Calendar only — no Gmail, Drive, or contacts.")
                    .foregroundStyle(.secondary)
                connectButton
                scopeFootnote
            }
        }
        .cardSurface(cornerRadius: 14)
    }

    private var connectButton: some View {
        Button {
            Task {
                await model.connectGoogleAccount()
            }
        } label: {
            Label("Connect Google", systemImage: "person.crop.circle.badge.plus")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(AppColor.ember)
    }

    private var scopeFootnote: some View {
        Text("Tokens stay in your Mac Keychain. Disconnecting in Settings wipes local state.")
            .hcbFont(.caption)
            .foregroundStyle(.secondary)
    }
}

private struct SyncPreferenceCard: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            OnboardingStepHeader(number: 2, title: "Pick Sync Behavior", systemImage: "arrow.triangle.2.circlepath")

            Picker("Sync mode", selection: syncModeBinding) {
                ForEach(SyncMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .syncModePickerStyle()

            Text(model.settings.syncMode.detail)
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        }
        .cardSurface(cornerRadius: 14)
    }

    private var syncModeBinding: Binding<SyncMode> {
        Binding(
            get: { model.settings.syncMode },
            set: { model.updateSyncMode($0) }
        )
    }
}

private struct SourceSelectionCard: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                OnboardingStepHeader(number: 3, title: "Choose Sources", systemImage: "line.3.horizontal.decrease.circle")
                Spacer()
                Button {
                    Task {
                        await model.refreshNow()
                    }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                        .labelStyle(.iconOnly)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Refresh Google lists and calendars")
            }

            if model.account == nil {
                Text("Finish step 1 first — your task lists and calendars will appear here once Google is connected.")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            } else if model.taskLists.isEmpty && model.calendars.isEmpty {
                if case .syncing = model.syncState {
                    Label("Loading from Google…", systemImage: "arrow.triangle.2.circlepath")
                        .hcbFont(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    Text("No lists or calendars yet. Tap Refresh above, or create a list in Google Tasks and try again.")
                        .hcbFont(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            if model.taskLists.isEmpty == false {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Task lists")
                        .hcbFont(.headline)
                    ForEach(model.taskLists) { taskList in
                        Toggle(isOn: taskListBinding(taskList.id)) {
                            Text(taskList.title)
                        }
                    }
                }
            }

            if model.calendars.isEmpty == false {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Calendars")
                        .hcbFont(.headline)
                    ForEach(model.calendars) { calendar in
                        Toggle(isOn: calendarBinding(calendar.id)) {
                            HStack(spacing: 10) {
                                Circle()
                                    .fill(Color(hex: calendar.colorHex))
                                    .hcbScaledFrame(width: 10, height: 10)
                                Text(calendar.summary)
                            }
                        }
                    }
                }
            }
        }
        .cardSurface(cornerRadius: 14)
    }

    private func taskListBinding(_ id: TaskListMirror.ID) -> Binding<Bool> {
        Binding(
            get: { model.isTaskListSelected(id) },
            set: { _ in model.toggleTaskList(id) }
        )
    }

    private func calendarBinding(_ id: CalendarListMirror.ID) -> Binding<Bool> {
        Binding(
            get: { model.calendars.first(where: { $0.id == id })?.isSelected ?? false },
            set: { _ in model.toggleCalendar(id) }
        )
    }
}

private struct ReminderPreferenceCard: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            OnboardingStepHeader(number: 4, title: "Local Reminders", systemImage: "bell.badge")
            Toggle("Schedule device-local reminders", isOn: remindersBinding)
            Text("Task reminders fire at 9:00 AM on the due date. Timed events fire 15 minutes before start.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        }
        .cardSurface(cornerRadius: 14)
    }

    private var remindersBinding: Binding<Bool> {
        Binding(
            get: { model.settings.enableLocalNotifications },
            set: { model.updateLocalNotificationsEnabled($0) }
        )
    }
}

private struct FinishOnboardingCard: View {
    @Environment(AppModel.self) private var model
    let finish: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("You can change all of this later in Settings.")
                .foregroundStyle(.secondary)
            Button(action: finish) {
                Label(model.account == nil ? "Finish Without Connecting" : "Finish Setup", systemImage: "checkmark.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(model.account == nil ? AppColor.ember : AppColor.moss)
            if model.account == nil {
                Text("You can connect Google later from Settings — we'll just show empty states until you do.")
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .cardSurface(cornerRadius: 14)
    }
}

private struct OnboardingStepHeader: View {
    let number: Int
    let title: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 10) {
            Text("\(number)")
                .hcbFont(.caption, weight: .bold)
                .foregroundStyle(.white)
                .hcbScaledFrame(width: 26, height: 26)
                .background(AppColor.ink, in: Circle())
            Label(title, systemImage: systemImage)
                .hcbFont(.headline)
        }
    }
}

#Preview {
    OnboardingView()
        .environment(AppModel.preview)
}
