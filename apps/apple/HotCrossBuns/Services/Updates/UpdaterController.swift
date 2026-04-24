import Foundation
import Observation
import Sparkle

@MainActor
@Observable
final class UpdaterController: NSObject, SPUUpdaterDelegate {
    struct ToastState: Equatable {
        let title: String
        let message: String
        let isWarning: Bool
    }

    private let bundle: Bundle
    private var controller: SPUStandardUpdaterController?
    private(set) var toastState: ToastState?

    init(bundle: Bundle = .main) {
        self.bundle = bundle
        super.init()
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
        guard let controller = updaterController(startingUpdater: true) else {
            toastState = ToastState(
                title: "Updates unavailable",
                message: "Preview builds do not have a Sparkle update feed yet. Install newer DMGs from the Releases page.",
                isWarning: true
            )
            return
        }
        controller.checkForUpdates(nil)
    }

    func clearToast() {
        toastState = nil
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
            updaterDelegate: self,
            userDriverDelegate: nil
        )
        controller = created
        return created
    }

    func updaterDidNotFindUpdate(_ updater: SPUUpdater) {
        toastState = ToastState(
            title: "You're on the latest version",
            message: "Hot Cross Buns didn't find anything newer to install.",
            isWarning: false
        )
    }

    func updater(_ updater: SPUUpdater, didAbortWithError error: any Error) {
        toastState = ToastState(
            title: "Couldn't reach update server",
            message: error.localizedDescription,
            isWarning: true
        )
    }
}
