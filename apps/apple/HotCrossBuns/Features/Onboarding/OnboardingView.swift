import SwiftUI

struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    OnboardingHero()
                    ConnectGoogleCard()
                    SyncPreferenceCard()
                    SourceSelectionCard()
                    ReminderPreferenceCard()
                    FinishOnboardingCard(finish: finish)
                }
                .padding(20)
            }
            .appBackground()
            .navigationTitle("Set Up")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Later") {
                        finish()
                    }
                }
            }
        }
        .interactiveDismissDisabled(model.settings.hasCompletedOnboarding == false)
    }

    private func finish() {
        model.completeOnboarding()
        dismiss()
    }
}

private struct OnboardingHero: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Google-native planning")
                .font(.callout.weight(.semibold))
                .foregroundStyle(AppColor.moss)
            Text("Make Tasks and Calendar usable from the Apple devices you already use.")
                .font(.system(.largeTitle, design: .serif, weight: .bold))
                .foregroundStyle(AppColor.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("This setup connects Google, chooses sync behavior, scopes the lists/calendars you care about, and optionally schedules local reminders.")
                .foregroundStyle(.secondary)
        }
        .cardSurface(cornerRadius: 32)
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
            case .authenticating:
                ProgressView("Opening Google Sign-In")
            case .failed(let message):
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
                connectButton
            case .signedOut:
                Text("Sign in once to grant Tasks and Calendar access.")
                    .foregroundStyle(.secondary)
                connectButton
            }
        }
        .cardSurface(cornerRadius: 26)
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
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .cardSurface(cornerRadius: 26)
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

            if model.taskLists.isEmpty && model.calendars.isEmpty {
                Text("Refresh after connecting Google to load selectable task lists and calendars.")
                    .foregroundStyle(.secondary)
            }

            if model.taskLists.isEmpty == false {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Task lists")
                        .font(.headline)
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
                        .font(.headline)
                    ForEach(model.calendars) { calendar in
                        Toggle(isOn: calendarBinding(calendar.id)) {
                            HStack(spacing: 10) {
                                Circle()
                                    .fill(Color(hex: calendar.colorHex))
                                    .frame(width: 10, height: 10)
                                Text(calendar.summary)
                            }
                        }
                    }
                }
            }
        }
        .cardSurface(cornerRadius: 26)
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
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .cardSurface(cornerRadius: 26)
    }

    private var remindersBinding: Binding<Bool> {
        Binding(
            get: { model.settings.enableLocalNotifications },
            set: { model.updateLocalNotificationsEnabled($0) }
        )
    }
}

private struct FinishOnboardingCard: View {
    let finish: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("You can change all of this later in Settings.")
                .foregroundStyle(.secondary)
            Button(action: finish) {
                Label("Finish Setup", systemImage: "checkmark.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(AppColor.moss)
        }
        .cardSurface(cornerRadius: 26)
    }
}

private struct OnboardingStepHeader: View {
    let number: Int
    let title: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 10) {
            Text("\(number)")
                .font(.caption.bold())
                .foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background(AppColor.ink, in: Circle())
            Label(title, systemImage: systemImage)
                .font(.headline)
        }
    }
}

#Preview {
    OnboardingView()
        .environment(AppModel.preview)
}
