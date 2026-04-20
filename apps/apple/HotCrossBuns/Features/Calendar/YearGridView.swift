import SwiftUI

// §7.01 Phase D3 — year overview. 4 columns × 3 rows of mini-months.
// Each day cell shades by event-count heatmap; clicking a day jumps to
// Day view via onPickDay. Reuses existing model.events and the calendar-
// selection pipeline — no new backend plumbing.
struct YearGridView: View {
    @Environment(AppModel.self) private var model
    @Binding var anchorDate: Date
    let onPickDay: (Date) -> Void

    private let calendar = Calendar.current

    private var year: Int {
        calendar.component(.year, from: anchorDate)
    }

    private var months: [Date] {
        (1...12).compactMap { month in
            calendar.date(from: DateComponents(year: year, month: month, day: 1))
        }
    }

    private var eventsByDay: [Date: Int] {
        let selected = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        guard let yearStart = calendar.date(from: DateComponents(year: year, month: 1, day: 1)),
              let yearEnd = calendar.date(from: DateComponents(year: year + 1, month: 1, day: 1)) else {
            return [:]
        }
        var counts: [Date: Int] = [:]
        for event in model.events {
            guard event.status != .cancelled, selected.contains(event.calendarID) else { continue }
            if event.endDate < yearStart || event.startDate >= yearEnd { continue }
            var cursor = max(calendar.startOfDay(for: event.startDate), yearStart)
            let end = min(calendar.startOfDay(for: event.endDate), calendar.date(byAdding: .day, value: -1, to: yearEnd) ?? yearEnd)
            while cursor <= end {
                counts[cursor, default: 0] += 1
                guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
                cursor = next
            }
        }
        return counts
    }

    var body: some View {
        let counts = eventsByDay
        let maxCount = counts.values.max() ?? 0
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 4), spacing: 16) {
                ForEach(months, id: \.self) { month in
                    miniMonth(for: month, counts: counts, maxCount: maxCount)
                }
            }
            .hcbScaledPadding(16)
        }
    }

    private func miniMonth(for monthStart: Date, counts: [Date: Int], maxCount: Int) -> some View {
        let cells = CalendarGridLayout.monthCells(for: monthStart, calendar: calendar)
        let monthNum = calendar.component(.month, from: monthStart)
        return VStack(alignment: .leading, spacing: 6) {
            Text(monthStart.formatted(.dateTime.month(.wide)))
                .hcbFont(.subheadline, weight: .semibold)
                .foregroundStyle(AppColor.ink)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 1), count: 7), spacing: 2) {
                ForEach(weekdayHeaders, id: \.self) { wd in
                    Text(wd)
                        .hcbFont(.caption2, weight: .medium)
                        .foregroundStyle(.secondary)
                }
                ForEach(cells, id: \.self) { day in
                    dayCell(day: day, monthNum: monthNum, counts: counts, maxCount: maxCount)
                }
            }
        }
        .hcbScaledPadding(10)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(AppColor.cream.opacity(0.25))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(AppColor.cardStroke, lineWidth: 0.5)
        )
    }

    private func dayCell(day: Date, monthNum: Int, counts: [Date: Int], maxCount: Int) -> some View {
        let startOfDay = calendar.startOfDay(for: day)
        let isInMonth = calendar.component(.month, from: day) == monthNum
        let isToday = calendar.isDateInToday(day)
        let count = counts[startOfDay] ?? 0
        let shade: Double = maxCount > 0 ? min(0.7, Double(count) / Double(max(maxCount, 1)) * 0.7) : 0
        return Button {
            onPickDay(startOfDay)
        } label: {
            Text("\(calendar.component(.day, from: day))")
                .hcbFontSystem(size: 9, weight: isToday ? .bold : .regular)
                .foregroundStyle(isInMonth ? AppColor.ink : .secondary.opacity(0.5))
                .frame(maxWidth: .infinity, minHeight: 18)
                .background(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(isToday ? AppColor.ember.opacity(0.35) : AppColor.ember.opacity(shade))
                )
        }
        .buttonStyle(.plain)
        .opacity(isInMonth ? 1.0 : 0.4)
        .help(count > 0 ? "\(count) event\(count == 1 ? "" : "s") on \(day.formatted(.dateTime.month(.abbreviated).day().year()))" : "\(day.formatted(.dateTime.month(.abbreviated).day().year()))")
    }

    private var weekdayHeaders: [String] {
        let symbols = calendar.veryShortStandaloneWeekdaySymbols
        let first = calendar.firstWeekday - 1
        return (0..<7).map { symbols[(first + $0) % 7] }
    }
}
