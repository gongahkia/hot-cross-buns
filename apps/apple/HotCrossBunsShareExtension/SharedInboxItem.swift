import Foundation

// Duplicated from HotCrossBuns/Services/SharedInbox/SharedInboxItem.swift
// so the Share Extension target can reference the same types without
// pulling in the entire main-app module. Keep the two files in sync —
// they must agree on the suite name and key to round-trip.
struct SharedInboxItem: Codable, Hashable, Sendable {
    var text: String
    var createdAt: Date
}

enum SharedInboxDefaults {
    static let appGroupID = "group.com.gongahkia.hotcrossbuns"
    private static let itemsKey = "sharedInbox.items"

    static var suite: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    static func append(_ item: SharedInboxItem) {
        guard let suite else { return }
        var items = load(suite: suite)
        items.append(item)
        save(items, suite: suite)
    }

    private static func load(suite: UserDefaults) -> [SharedInboxItem] {
        guard let data = suite.data(forKey: itemsKey) else { return [] }
        return (try? JSONDecoder().decode([SharedInboxItem].self, from: data)) ?? []
    }

    private static func save(_ items: [SharedInboxItem], suite: UserDefaults) {
        guard let data = try? JSONEncoder().encode(items) else { return }
        suite.set(data, forKey: itemsKey)
    }
}
