import SwiftUI

struct MonthGridView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router
    @Binding var anchorDate: Date

    private let calendar = Calendar.current
    private let weekdaySymbols: [String] = {
        var cal = Calendar.current
        cal.locale = Locale.current
        let formatter = DateFormatter()
        formatter.calendar = cal
        let symbols = formatter.shortWeekdaySymbols ?? []
        let firstWeekday = cal.firstWeekday - 1
        guard firstWeekday < symbols.count else { return symbols }
        return Array(symbols[firstWeekday...]) + Array(symbols[..<firstWeekday])
    }()

    var body: some View {
        VStack(spacing: 0) {
            weekdayHeader
            Divider()
            grid
        }
    }

    private var cells: [Date] {
        CalendarGridLayout.monthCells(for: anchorDate, calendar: calendar)
    }

    private var eventsByDay: [Date: [CalendarEventMirror]] {
        let selected = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        let events = model.events.filter { selected.contains($0.calendarID) }
        return CalendarGridLayout.eventsByDay(
            events,
            from: cells.first ?? anchorDate,
            to: cells.last ?? anchorDate,
            calendar: calendar
        )
    }

    private var weekdayHeader: some View {
        HStack(spacing: 0) {
            ForEach(weekdaySymbols, id: \.self) { symbol in
                Text(symbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 8)
    }

    private var grid: some View {
        let groupedCells = stride(from: 0, to: cells.count, by: 7).map { start in
            Array(cells[start..<min(start + 7, cells.count)])
        }
        return GeometryReader { geo in
            let rowHeight = geo.size.height / CGFloat(groupedCells.count)
            VStack(spacing: 0) {
                ForEach(Array(groupedCells.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: 0) {
                        ForEach(row, id: \.self) { day in
                            monthCell(day: day)
                                .frame(maxWidth: .infinity, minHeight: rowHeight, maxHeight: rowHeight, alignment: .top)
                        }
                    }
                }
            }
        }
    }

    private func monthCell(day: Date) -> some View {
        let dayStart = calendar.startOfDay(for: day)
        let isCurrentMonth = calendar.component(.month, from: day) == calendar.component(.month, from: anchorDate)
        let events = eventsByDay[dayStart] ?? []
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("\(calendar.component(.day, from: day))")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(dayNumberColor(isCurrentMonth: isCurrentMonth, day: day))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        Capsule()
                            .fill(calendar.isDateInToday(day) ? AppColor.ember.opacity(0.25) : .clear)
                    )
                Spacer(minLength: 0)
            }
            ForEach(events.prefix(3), id: \.id) { event in
                Button {
                    router.navigate(to: .event(event.id))
                } label: {
                    Text(eventLabel(event, in: day))
                        .font(.caption2)
                        .lineLimit(1)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(calendarColor(for: event).opacity(0.25))
                        )
                        .foregroundStyle(AppColor.ink)
                }
                .buttonStyle(.plain)
            }
            if events.count > 3 {
                Text("+\(events.count - 3) more")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 6)
            }
            Spacer(minLength: 0)
        }
        .padding(6)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(
            Rectangle()
                .fill(isCurrentMonth ? Color.clear : AppColor.cream.opacity(0.15))
        )
        .overlay(
            Rectangle()
                .strokeBorder(AppColor.cardStroke, lineWidth: 0.5)
        )
    }

    private func eventLabel(_ event: CalendarEventMirror, in day: Date) -> String {
        if event.isAllDay { return event.summary }
        let start = calendar.startOfDay(for: event.startDate)
        let dayStart = calendar.startOfDay(for: day)
        if start < dayStart {
            return "… \(event.summary)"
        }
        return "\(event.startDate.formatted(.dateTime.hour().minute())) \(event.summary)"
    }

    private func dayNumberColor(isCurrentMonth: Bool, day: Date) -> Color {
        if calendar.isDateInToday(day) { return AppColor.ember }
        return isCurrentMonth ? AppColor.ink : .secondary
    }

    private func calendarColor(for event: CalendarEventMirror) -> Color {
        guard let cal = model.calendars.first(where: { $0.id == event.calendarID }) else { return AppColor.blue }
        return Color(hex: cal.colorHex)
    }
}
