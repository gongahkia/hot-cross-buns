import Foundation

enum AppIntentRoute: String, Sendable {
    case addTask
    case addEvent
    case store
    case calendar
}

enum AppIntentHandoff {
    private static let pendingRouteKey = "appIntent.pendingRoute"

    static func save(_ route: AppIntentRoute) {
        UserDefaults.standard.set(route.rawValue, forKey: pendingRouteKey)
    }

    static func consumePendingRoute() -> AppIntentRoute? {
        guard let rawValue = UserDefaults.standard.string(forKey: pendingRouteKey) else {
            return nil
        }

        UserDefaults.standard.removeObject(forKey: pendingRouteKey)
        return AppIntentRoute(rawValue: rawValue)
    }
}
