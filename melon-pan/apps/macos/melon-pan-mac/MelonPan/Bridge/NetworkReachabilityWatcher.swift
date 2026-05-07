import Foundation
import Network

@MainActor
final class NetworkReachabilityWatcher {
    static let shared = NetworkReachabilityWatcher()

    private let monitor = NWPathMonitor()
    private var started = false
    private var lastStatus: NWPath.Status?
    private var onSatisfied: (() -> Void)?

    func start(center: AppStatusCenter, onSatisfied: (() -> Void)? = nil) {
        self.onSatisfied = onSatisfied
        guard !started else { return }
        started = true
        monitor.pathUpdateHandler = { path in
            Task { @MainActor in
                let wasSatisfied = self.lastStatus == .satisfied
                self.lastStatus = path.status
                if path.status == .satisfied {
                    center.clear(dedupeKey: "offline")
                    if !wasSatisfied {
                        self.onSatisfied?()
                    }
                } else {
                    center.postOffline()
                }
            }
        }
        monitor.start(queue: DispatchQueue(label: "melon-pan.reachability"))
    }
}
