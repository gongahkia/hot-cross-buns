import Foundation
import SwiftUI

public struct HistoryFilter: Equatable {
    public var enabledKinds: Set<HistoryEvent.Kind> = Set(HistoryEvent.Kind.allCases)
    public var dateRange: ClosedRange<Date>? = nil
    public var documentId: String? = nil
    public var searchText: String = ""

    public func matches(_ event: HistoryEvent) -> Bool {
        guard enabledKinds.contains(event.kind) else { return false }
        if let documentId, documentId != event.documentId { return false }
        if let dateRange, !dateRange.contains(event.date) { return false }
        if !searchText.isEmpty {
            let query = searchText.lowercased()
            if !event.documentId.lowercased().contains(query),
               !event.message.lowercased().contains(query) {
                return false
            }
        }
        return true
    }
}

struct HistoryFilterChips: View {
    @Binding var filter: HistoryFilter
    let documentIds: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Menu {
                    ForEach(HistoryEvent.Kind.allCases, id: \.self) { kind in
                        Toggle(kind.label, isOn: Binding(
                            get: { filter.enabledKinds.contains(kind) },
                            set: { enabled in
                                if enabled {
                                    filter.enabledKinds.insert(kind)
                                } else {
                                    filter.enabledKinds.remove(kind)
                                }
                            }
                        ))
                    }
                } label: {
                    Label("Kinds", systemImage: "line.3.horizontal.decrease.circle")
                }

                Picker("Document", selection: Binding(
                    get: { filter.documentId },
                    set: { filter.documentId = $0 }
                )) {
                    Text("All documents").tag(String?.none)
                    ForEach(documentIds, id: \.self) { id in
                        Text(shortDocumentId(id)).tag(String?.some(id))
                    }
                }
                .frame(maxWidth: 220)

                Menu {
                    Button("All dates") { filter.dateRange = nil }
                    Button("Last 24 hours") {
                        filter.dateRange = Date(timeIntervalSinceNow: -86_400)...Date()
                    }
                    Button("Last 7 days") {
                        filter.dateRange = Date(timeIntervalSinceNow: -604_800)...Date()
                    }
                    Button("Last 30 days") {
                        filter.dateRange = Date(timeIntervalSinceNow: -2_592_000)...Date()
                    }
                } label: {
                    Label(dateLabel, systemImage: "calendar")
                }

                if filter.enabledKinds.count < HistoryEvent.Kind.allCases.count ||
                    filter.documentId != nil ||
                    filter.dateRange != nil ||
                    !filter.searchText.isEmpty {
                    Button {
                        filter = HistoryFilter()
                    } label: {
                        Label("Reset", systemImage: "xmark.circle")
                    }
                    .buttonStyle(.borderless)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }

    private var dateLabel: String {
        filter.dateRange == nil ? "All dates" : "Date range"
    }
}

extension HistoryEvent.Kind {
    var label: String {
        switch self {
        case .pull: "Pull"
        case .push: "Push"
        case .drain: "Drain"
        case .conflict: "Conflict"
        case .drift: "Drift"
        case .error: "Error"
        case .import: "Import"
        }
    }
}

func shortDocumentId(_ id: String) -> String {
    guard id.count > 16 else { return id }
    return "\(id.prefix(8))...\(id.suffix(4))"
}
