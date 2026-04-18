import SwiftUI

struct WeekGridView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router
    @Binding var anchorDate: Date

    private let hourHeight: CGFloat = 44
    private let hourStart = 0
    private let hourEnd = 24
    private let calendar = Calendar.current

    var body: some View {
        VStack(spacing: 0) {
            weekHeader
            Divider()
            allDayStrip
            Divider()
            ScrollView {
                timeGrid
            }
        }
    }

    private var weekDays: [Date] {
        CalendarGridLayout.weekDays(containing: anchorDate, calendar: calendar)
    }

    private var visibleEvents: [CalendarEventMirror] {
        let selected = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        return model.events.filter { selected.contains($0.calendarID) && $0.status != .cancelled }
    }

    private var weekHeader: some View {
        HStack(spacing: 0) {
            Text("")
                .frame(width: 54)
            ForEach(weekDays, id: \.self) { day in
                VStack(spacing: 2) {
                    Text(day.formatted(.dateTime.weekday(.abbreviated)))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(day.formatted(.dateTime.day()))
                        .font(.title3.weight(isToday(day) ? .bold : .regular))
                        .foregroundStyle(isToday(day) ? AppColor.ember : AppColor.ink)
                        .frame(width: 30, height: 30)
                        .background(
                            Circle()
                                .fill(isToday(day) ? AppColor.ember.opacity(0.15) : .clear)
                        )
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 10)
    }

    private var allDayStrip: some View {
        let byDay = CalendarGridLayout.eventsByDay(
            visibleEvents.filter(\.isAllDay),
            from: weekDays.first ?? anchorDate,
            to: weekDays.last ?? anchorDate,
            calendar: calendar
        )
        let maxLanes = byDay.values.map(\.count).max() ?? 0
        return Group {
            if maxLanes == 0 {
                EmptyView()
            } else {
                HStack(spacing: 0) {
                    Text("All-day")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 54, alignment: .trailing)
                        .padding(.trailing, 6)
                    GeometryReader { geo in
                        let columnWidth = geo.size.width / 7
                        ZStack(alignment: .topLeading) {
                            ForEach(Array(weekDays.enumerated()), id: \.offset) { idx, day in
                                VStack(alignment: .leading, spacing: 2) {
                                    ForEach((byDay[calendar.startOfDay(for: day)] ?? []).prefix(3), id: \.id) { event in
                                        Button {
                                            router.navigate(to: .event(event.id))
                                        } label: {
                                            Text(event.summary)
                                                .font(.caption)
                                                .lineLimit(1)
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 3)
                                                .frame(maxWidth: .infinity, alignment: .leading)
                                                .background(
                                                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                                                        .fill(calendarColor(for: event).opacity(0.3))
                                                )
                                                .foregroundStyle(AppColor.ink)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                .padding(.horizontal, 2)
                                .frame(width: columnWidth, alignment: .leading)
                                .offset(x: CGFloat(idx) * columnWidth)
                            }
                        }
                    }
                    .frame(height: CGFloat(min(maxLanes, 3)) * 22)
                }
                .padding(.vertical, 4)
            }
        }
    }

    private var timeGrid: some View {
        HStack(alignment: .top, spacing: 0) {
            hoursColumn
            GeometryReader { geo in
                let columnWidth = geo.size.width / 7
                ZStack(alignment: .topLeading) {
                    gridLines
                    ForEach(Array(weekDays.enumerated()), id: \.offset) { idx, day in
                        dayColumn(day: day, xOffset: CGFloat(idx) * columnWidth, width: columnWidth)
                    }
                    if let nowOffset = currentTimeOffset() {
                        nowIndicator(offset: nowOffset)
                    }
                }
                .frame(height: CGFloat(hourEnd - hourStart) * hourHeight)
            }
        }
    }

    private var hoursColumn: some View {
        VStack(spacing: 0) {
            ForEach(hourStart..<hourEnd, id: \.self) { hour in
                HStack {
                    Spacer()
                    Text(labelForHour(hour))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .offset(y: -6)
                        .padding(.trailing, 6)
                }
                .frame(height: hourHeight, alignment: .top)
            }
        }
        .frame(width: 54)
    }

    private var gridLines: some View {
        VStack(spacing: 0) {
            ForEach(hourStart..<hourEnd, id: \.self) { _ in
                Divider()
                    .frame(height: hourHeight, alignment: .top)
            }
        }
    }

    private func dayColumn(day: Date, xOffset: CGFloat, width: CGFloat) -> some View {
        let startOfDay = calendar.startOfDay(for: day)
        let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay) ?? startOfDay
        let eventsForDay = visibleEvents.filter { event in
            event.isAllDay == false && event.startDate < endOfDay && event.endDate > startOfDay
        }
        let laid = CalendarGridLayout.layout(eventsInDay: eventsForDay, calendar: calendar)

        return ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(Color.clear)
                .contentShape(Rectangle())
                .dropDestination(for: DraggedTask.self) { items, location in
                    guard let dropped = items.first else { return false }
                    Task {
                        await scheduleTaskAsEvent(dropped, dropY: location.y, dayStart: startOfDay)
                    }
                    return true
                }
            ForEach(Array(laid.enumerated()), id: \.offset) { _, placed in
                eventTile(placed: placed, dayStart: startOfDay, dayEnd: endOfDay, columnWidth: width)
            }
        }
        .frame(width: width)
        .offset(x: xOffset)
    }

    private func scheduleTaskAsEvent(_ dropped: DraggedTask, dropY: CGFloat, dayStart: Date) async {
        let start = CalendarDropComputer.snappedStart(for: dropY, hourHeight: hourHeight, dayStart: dayStart, calendar: calendar)
        let end = CalendarDropComputer.defaultEndDate(from: start, calendar: calendar)
        let destinationCalendar = primaryEditableCalendarID() ?? model.calendarSnapshot.selectedCalendars.first?.id
        guard let calendarID = destinationCalendar else { return }
        _ = await model.createEvent(
            summary: dropped.title,
            details: CalendarDropComputer.backLinkDescription(for: dropped.title, taskID: dropped.taskID),
            startDate: start,
            endDate: end,
            isAllDay: false,
            reminderMinutes: nil,
            calendarID: calendarID
        )
    }

    private func primaryEditableCalendarID() -> CalendarListMirror.ID? {
        model.calendarSnapshot.selectedCalendars.first(where: { $0.accessRole == "owner" || $0.accessRole == "writer" })?.id
    }

    private func eventTile(placed: CalendarGridLayout.LaidOutEvent, dayStart: Date, dayEnd: Date, columnWidth: CGFloat) -> some View {
        let clampedStart = max(placed.event.startDate, dayStart)
        let clampedEnd = min(placed.event.endDate, dayEnd)
        let startMinutes = clampedStart.timeIntervalSince(dayStart) / 60
        let durationMinutes = max(clampedEnd.timeIntervalSince(clampedStart) / 60, 20)
        let yOffset = CGFloat(startMinutes) * (hourHeight / 60)
        let height = CGFloat(durationMinutes) * (hourHeight / 60)
        let slotWidth = columnWidth / CGFloat(placed.columnCount)
        let xOffsetWithinDay = CGFloat(placed.columnIndex) * slotWidth
        let fill = calendarColor(for: placed.event)

        return Button {
            router.navigate(to: .event(placed.event.id))
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(placed.event.summary)
                    .font(.caption.weight(.semibold))
                    .lineLimit(2)
                if height > 34 {
                    Text("\(placed.event.startDate.formatted(.dateTime.hour().minute())) – \(placed.event.endDate.formatted(.dateTime.hour().minute()))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .frame(width: slotWidth - 2, height: height - 2, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(fill.opacity(0.2))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(fill.opacity(0.55), lineWidth: 0.8)
            )
        }
        .buttonStyle(.plain)
        .offset(x: xOffsetWithinDay + 1, y: yOffset)
    }

    private func currentTimeOffset() -> CGFloat? {
        let now = Date()
        guard let todayInWeek = weekDays.first(where: { calendar.isDate($0, inSameDayAs: now) }) else { return nil }
        _ = todayInWeek
        let minutes = calendar.component(.hour, from: now) * 60 + calendar.component(.minute, from: now)
        return CGFloat(minutes) * (hourHeight / 60)
    }

    private func nowIndicator(offset: CGFloat) -> some View {
        Rectangle()
            .fill(AppColor.ember)
            .frame(height: 1)
            .offset(y: offset)
    }

    private func isToday(_ day: Date) -> Bool {
        calendar.isDateInToday(day)
    }

    private func labelForHour(_ hour: Int) -> String {
        let components = DateComponents(hour: hour)
        let date = calendar.date(from: components) ?? Date()
        return date.formatted(.dateTime.hour())
    }

    private func calendarColor(for event: CalendarEventMirror) -> Color {
        guard let cal = model.calendars.first(where: { $0.id == event.calendarID }) else { return AppColor.blue }
        return Color(hex: cal.colorHex)
    }
}
