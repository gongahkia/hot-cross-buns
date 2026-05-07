import Foundation

struct PermissionPreferences: Codable, Equatable {
    var notificationsAskCount: Int = 0
    var notificationsDoNotAsk: Bool = false
    var lastAskedAt: Date? = nil

    static func storeURL(cacheRoot: String) -> URL {
        URL(fileURLWithPath: cacheRoot).appendingPathComponent("permissions.json")
    }

    static func load(cacheRoot: String) -> PermissionPreferences {
        guard let data = try? Data(contentsOf: storeURL(cacheRoot: cacheRoot)) else {
            return PermissionPreferences()
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let preferences = try? decoder.decode(Self.self, from: data) else {
            return PermissionPreferences()
        }
        return preferences
    }

    func save(cacheRoot: String) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(self) else { return }
        try? data.write(to: Self.storeURL(cacheRoot: cacheRoot), options: .atomic)
    }
}
