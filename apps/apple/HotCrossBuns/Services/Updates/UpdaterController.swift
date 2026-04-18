import Foundation
import Observation
import Sparkle

@MainActor
@Observable
final class UpdaterController {
    private let bundle: Bundle
    private var controller: SPUStandardUpdaterController?

    init(bundle: Bundle = .main) {
        self.bundle = bundle
    }

    var isConfigured: Bool {
        let feedURL = (bundle.object(forInfoDictionaryKey: "SUFeedURL") as? String) ?? ""
        let publicKey = (bundle.object(forInfoDictionaryKey: "SUPublicEDKey") as? String) ?? ""
        return feedURL.isEmpty == false && publicKey.isEmpty == false
    }

    var automaticallyChecksForUpdates: Bool {
        get { updaterController(startingUpdater: false)?.updater.automaticallyChecksForUpdates ?? false }
        set { updaterController(startingUpdater: false)?.updater.automaticallyChecksForUpdates = newValue }
    }

    var lastUpdateCheckDate: Date? {
        updaterController(startingUpdater: false)?.updater.lastUpdateCheckDate
    }

    func checkForUpdates() {
        updaterController(startingUpdater: true)?.checkForUpdates(nil)
    }

    private func updaterController(startingUpdater: Bool) -> SPUStandardUpdaterController? {
        guard isConfigured else {
            return nil
        }

        if let controller {
            return controller
        }

        let created = SPUStandardUpdaterController(
            startingUpdater: startingUpdater,
            updaterDelegate: nil,
            userDriverDelegate: nil
        )
        controller = created
        return created
    }
}
