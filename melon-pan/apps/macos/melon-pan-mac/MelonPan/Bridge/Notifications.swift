// Wraps UNUserNotificationCenter for the macOS shell.
//
// Authorization is gated by a primer sheet before macOS shows its
// system prompt. Failures (user denied, system suppressed) are logged
// but never surfaced as user-visible errors — desktop notifications
// are best-effort, not load-bearing.

import AppKit
import Foundation
import UserNotifications

public enum NotificationKind {
    case info
    case warning
    case error

    fileprivate var sound: UNNotificationSound? {
        switch self {
        case .info: return nil
        case .warning: return UNNotificationSound.default
        case .error: return UNNotificationSound.defaultCritical
        }
    }

    fileprivate var interruptionLevel: UNNotificationInterruptionLevel {
        switch self {
        case .info: return .passive
        case .warning: return .active
        case .error: return .timeSensitive
        }
    }
}

public enum PrimerDecision {
    case enable
    case notNow
    case dontAskAgain
}

public protocol NotificationPrimerPresenter: AnyObject {
    @MainActor func presentPrimer() async -> PrimerDecision
}

public enum AppNotifications {
    @MainActor
    private static var authorizationStatusProvider: () async -> UNAuthorizationStatus = {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return settings.authorizationStatus
    }

    @MainActor
    private static var authorizationRequester: () async -> Void = {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound]
        )
    }

    /// Requests user authorization for alerts + sounds immediately.
    /// Prefer requestWithPrimer(presenter:cacheRoot:) for launch-time
    /// permission flow.
    public static func requestAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound]
        ) { granted, error in
            if let error {
                NSLog(
                    "AppNotifications: authorization error: %@",
                    error.localizedDescription
                )
                return
            }
            if !granted {
                NSLog(
                    "AppNotifications: authorization denied — desktop alerts disabled."
                )
            }
        }
    }

    @MainActor
    public static func currentAuthorizationStatus() async -> UNAuthorizationStatus {
        await authorizationStatusProvider()
    }

    @MainActor
    @discardableResult
    public static func requestWithPrimer(
        presenter: NotificationPrimerPresenter,
        cacheRoot: String
    ) async -> UNAuthorizationStatus {
        let status = await currentAuthorizationStatus()
        guard status == .notDetermined, !cacheRoot.isEmpty else { return status }

        var preferences = PermissionPreferences.load(cacheRoot: cacheRoot)
        if preferences.notificationsDoNotAsk || preferences.notificationsAskCount >= 3 {
            return status
        }

        preferences.notificationsAskCount += 1
        preferences.lastAskedAt = Date()
        preferences.save(cacheRoot: cacheRoot)

        switch await presenter.presentPrimer() {
        case .enable:
            await authorizationRequester()
        case .notNow:
            break
        case .dontAskAgain:
            preferences.notificationsDoNotAsk = true
            preferences.save(cacheRoot: cacheRoot)
        }

        return await currentAuthorizationStatus()
    }

    @MainActor
    static func setAuthorizationHooksForTesting(
        statusProvider: @escaping () async -> UNAuthorizationStatus,
        requestAuthorization: @escaping () async -> Void = {}
    ) {
        authorizationStatusProvider = statusProvider
        authorizationRequester = requestAuthorization
    }

    @MainActor
    static func resetAuthorizationHooksForTesting() {
        authorizationStatusProvider = {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            return settings.authorizationStatus
        }
        authorizationRequester = {
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .sound]
            )
        }
    }

    /// Posts a notification. Best-effort: logs failures, never throws.
    public static func post(
        title: String,
        body: String,
        kind: NotificationKind = .info,
        identifier: String? = nil
    ) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        if let sound = kind.sound {
            content.sound = sound
        }
        content.interruptionLevel = kind.interruptionLevel

        let request = UNNotificationRequest(
            identifier: identifier ?? UUID().uuidString,
            content: content,
            trigger: nil // fire immediately
        )
        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                NSLog(
                    "AppNotifications: post failed: %@",
                    error.localizedDescription
                )
            }
        }
    }

    // MARK: - Convenience wrappers

    public static func notifySyncError(documentId: String, message: String) {
        Task { @MainActor in
            AppStatusCenter.shared.postSyncError(
                documentId: documentId,
                message: message
            )
        }
        post(
            title: "Melon Pan sync failed",
            body: "\(documentId): \(message)",
            kind: .error,
            identifier: "sync-error-\(documentId)"
        )
    }

    public static func notifyConflict(documentId: String) {
        Task { @MainActor in
            AppStatusCenter.shared.postConflict(documentId: documentId)
        }
        post(
            title: "Melon Pan: revision conflict",
            body: "\(documentId) has a revision conflict. Open the Conflicts page to resolve.",
            kind: .warning,
            identifier: "conflict-\(documentId)"
        )
    }

    public static func notifyUpdateAvailable(latestVersion: String) {
        post(
            title: "Melon Pan: update available",
            body: "Version \(latestVersion) is ready to install. Visit GitHub Releases to download.",
            kind: .info,
            identifier: "update-\(latestVersion)"
        )
    }
}

/// NSApp delegate that asks UNUserNotificationCenter to display
/// notifications even when the app is foregrounded — by default
/// macOS suppresses banners while the source app is active, but a
/// sync error during active editing is exactly when the user needs
/// to see the alert. SwiftUI app lifecycle attaches this in
/// MelonPanApp via @NSApplicationDelegateAdaptor.
public final class NotificationsDelegate: NSObject,
    NSApplicationDelegate,
    UNUserNotificationCenterDelegate
{
    public func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler:
            @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}
