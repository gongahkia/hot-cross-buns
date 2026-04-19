import Foundation

// Data handed off from the macOS Share Extension (and, in the future,
// the Services menu / drag-import paths) to the main app via an App
// Group UserDefaults suite. The main app reads + clears this on
// activation and presents the queued items in QuickAdd.
struct SharedInboxItem: Codable, Hashable, Sendable {
    var text: String
    var createdAt: Date
}

enum SharedInboxDefaults {
    // Both the main app and the Share Extension must declare this App
    // Group id in their entitlements for the suite to be accessible.
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

    static func consumeAll() -> [SharedInboxItem] {
        guard let suite else { return [] }
        let items = load(suite: suite)
        guard items.isEmpty == false else { return [] }
        suite.removeObject(forKey: itemsKey)
        return items
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
