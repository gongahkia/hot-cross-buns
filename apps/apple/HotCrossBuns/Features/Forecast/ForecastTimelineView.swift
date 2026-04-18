import SwiftUI

struct ForecastTimelineView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router

    var body: some View {
        let forecast = buildForecast()

        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18, pinnedViews: [.sectionHeaders]) {
                if forecast.overdueTasks.isEmpty == false {
                    overdueCard(tasks: forecast.overdueTasks)
                }
                ForEach(forecast.days) { day in
                    dayCard(day)
                }
                if forecast.hasContent == false {
                    ContentUnavailableView(
                        "Nothing scheduled",
                        systemImage: "calendar.day.timeline.leading",
                        description: Text("Tasks and events in the next \(ForecastBuilder.horizonDays) days will appear here.")
                    )
                    .padding(.top, 80)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .appBackground()
        .navigationTitle("Forecast")
        .toolbar {
            Button {
                router.present(.quickAddTask)
            } label: {
                Label("Quick Add", systemImage: "plus")
            }
        }
    }

    private func buildForecast() -> Forecast {
        let visibleTaskListIDs: Set<TaskListMirror.ID> = model.settings.hasConfiguredTaskListSelection
            ? model.settings.selectedTaskListIDs
            : Set(model.taskLists.map(\.id))
        let selectedCalendarIDs = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        return ForecastBuilder.build(
            tasks: model.tasks,
            events: model.events,
            selectedTaskListIDs: visibleTaskListIDs,
            selectedCalendarIDs: selectedCalendarIDs
        )
    }

    private func overdueCard(tasks: [TaskMirror]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(AppColor.ember)
                Text("Overdue")
                    .font(.title3.weight(.bold))
                Text("\(tasks.count)")
                    .font(.caption.monospacedDigit())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(AppColor.ember.opacity(0.2)))
                    .foregroundStyle(AppColor.ember)
                Spacer()
            }
            VStack(spacing: 6) {
                ForEach(tasks) { task in
                    taskRow(task, highlightOverdue: true)
                }
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(AppColor.ember.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(AppColor.ember.opacity(0.35), lineWidth: 1)
        )
    }

    private func dayCard(_ day: ForecastDay) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(day.date.formatted(.dateTime.weekday(.wide)))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(dayIsToday(day.date) ? AppColor.ember : AppColor.ink)
                    Text(day.date.formatted(.dateTime.month(.abbreviated).day()))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if day.isEmpty {
                    Text("Clear")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("\(day.events.count) \(day.events.count == 1 ? "event" : "events") · \(day.tasks.count) \(day.tasks.count == 1 ? "task" : "tasks")")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            if day.isEmpty == false {
                VStack(spacing: 6) {
                    ForEach(day.events, id: \.id) { event in
                        eventRow(event)
                    }
                    ForEach(day.tasks) { task in
                        taskRow(task, highlightOverdue: false)
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.ultraThinMaterial)
        )
    }

    private func taskRow(_ task: TaskMirror, highlightOverdue: Bool) -> some View {
        Button {
            router.navigate(to: .task(task.id))
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "circle")
                    .foregroundStyle(highlightOverdue ? AppColor.ember : AppColor.moss)
                VStack(alignment: .leading, spacing: 2) {
                    Text(task.title)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(AppColor.ink)
                    if let due = task.dueDate, highlightOverdue {
                        Text("Was due \(due.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))")
                            .font(.caption2)
                            .foregroundStyle(AppColor.ember)
                    }
                }
                Spacer(minLength: 0)
                Text(taskListTitle(for: task))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(AppColor.cream.opacity(0.4))
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(task.title), in \(taskListTitle(for: task))\(highlightOverdue && task.dueDate != nil ? ", overdue" : "")")
        .accessibilityHint("Double tap to open task.")
    }

    private func eventRow(_ event: CalendarEventMirror) -> some View {
        Button {
            router.navigate(to: .event(event.id))
        } label: {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(calendarColor(for: event))
                    .frame(width: 4)
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.summary)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AppColor.ink)
                    Text(timeLabel(event))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(calendarColor(for: event).opacity(0.12))
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(event.summary), \(timeLabel(event))")
        .accessibilityHint("Double tap to open event.")
    }

    private func taskListTitle(for task: TaskMirror) -> String {
        model.taskLists.first(where: { $0.id == task.taskListID })?.title ?? ""
    }

    private func calendarColor(for event: CalendarEventMirror) -> Color {
        guard let cal = model.calendars.first(where: { $0.id == event.calendarID }) else { return AppColor.blue }
        return Color(hex: cal.colorHex)
    }

    private func timeLabel(_ event: CalendarEventMirror) -> String {
        if event.isAllDay { return "All day" }
        return "\(event.startDate.formatted(.dateTime.hour().minute())) – \(event.endDate.formatted(.dateTime.hour().minute()))"
    }

    private func dayIsToday(_ date: Date) -> Bool {
        Calendar.current.isDateInToday(date)
    }
}
