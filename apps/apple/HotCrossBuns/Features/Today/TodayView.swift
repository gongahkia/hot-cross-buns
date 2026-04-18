import SwiftUI

struct TodayView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                TodayHero(snapshot: model.todaySnapshot, syncState: model.syncState) {
                    Task {
                        await model.refreshNow()
                    }
                }

                TodaySectionHeader(title: "Due today", count: model.todaySnapshot.dueTasks.count)
                if model.todaySnapshot.dueTasks.isEmpty {
                    EmptyStateCard(
                        title: "No due tasks",
                        message: "Google Tasks items with today's due date will land here."
                    )
                } else {
                    ForEach(model.todaySnapshot.dueTasks) { task in
                        TaskRowView(task: task) {
                            router.navigate(to: .task(task.id))
                        }
                    }
                }

                TodaySectionHeader(title: "On calendar", count: model.todaySnapshot.scheduledEvents.count)
                if model.todaySnapshot.scheduledEvents.isEmpty {
                    EmptyStateCard(
                        title: "No calendar blocks",
                        message: "Time-specific work should be modeled as Google Calendar events."
                    )
                } else {
                    ForEach(model.todaySnapshot.scheduledEvents) { event in
                        EventRowView(event: event) {
                            router.navigate(to: .event(event.id))
                        }
                    }
                }
            }
            .padding(20)
        }
        .appBackground()
        .navigationTitle("Today")
    }
}

private struct TodayHero: View {
    let snapshot: TodaySnapshot
    let syncState: SyncState
    let refresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(snapshot.date.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(AppColor.moss)
                }
                Spacer(minLength: 12)
                Button(action: refresh) {
                    Label("Refresh", systemImage: "arrow.clockwise")
                        .labelStyle(.iconOnly)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityLabel("Refresh Google data")
            }

            HStack(spacing: 12) {
                StatPill(value: "\(snapshot.dueTasks.count)", label: "Tasks")
                StatPill(value: "\(snapshot.scheduledEvents.count)", label: "Events")
                StatPill(value: "\(snapshot.overdueCount)", label: "Overdue")
                Spacer(minLength: 0)
            }

            Label(syncState.title, systemImage: "bolt.horizontal.circle")
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .cardSurface(cornerRadius: 32)
    }
}

private struct StatPill: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.title2.bold())
            Text(label)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .frame(minWidth: 66, alignment: .leading)
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .background(Color.white.opacity(0.42), in: Capsule())
    }
}

private struct TodaySectionHeader: View {
    let title: String
    let count: Int

    var body: some View {
        HStack {
            Text(title)
                .font(.title3.weight(.bold))
                .foregroundStyle(AppColor.ink)
            Spacer()
            Text("\(count)")
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Color.white.opacity(0.5), in: Capsule())
        }
        .padding(.top, 4)
    }
}

struct EmptyStateCard: View {
    let title: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface(cornerRadius: 24)
    }
}

#Preview {
    NavigationStack {
        TodayView()
            .environment(AppModel.preview)
            .environment(RouterPath())
    }
}
