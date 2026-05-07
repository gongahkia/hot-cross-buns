@preconcurrency import CoreSpotlight
import AppKit
import SwiftUI

@MainActor
enum SpotlightDelegate {
    static func handle(_ activity: NSUserActivity, session: AppSession) {
        guard activity.activityType == CSSearchableItemActionType,
              let uid = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
              let identifier = SpotlightIdentifier(uniqueIdentifier: uid)
        else { return }

        switch identifier {
        case .document(let id):
            DeepLinkRouter.handle(DeepLinkBuilder.documentURL(id: id), session: session)
            NSApp.activate(ignoringOtherApps: true)
        }
    }
}
