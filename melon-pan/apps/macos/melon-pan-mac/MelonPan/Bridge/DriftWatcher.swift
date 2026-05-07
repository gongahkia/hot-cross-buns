import Foundation

@MainActor
final class DriftWatcher: ObservableObject {
    static let shared = DriftWatcher()

    private var task: Task<Void, Never>?
    private var driftingKeys: Set<String> = []

    func start(cacheRoot: String, center: AppStatusCenter) {
        task?.cancel()
        task = Task { [weak self] in
            await self?.runSweep(cacheRoot: cacheRoot, center: center)
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                await self?.runSweep(cacheRoot: cacheRoot, center: center)
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        driftingKeys.removeAll()
    }

    private func runSweep(cacheRoot: String, center: AppStatusCenter) async {
        let result = await Task.detached(priority: .utility) {
            try RuntimeBridge.auditDriftCheck(cacheRoot: cacheRoot)
        }.result
        guard case .success(let driftingDocs) = result else { return }
        let currentKeys = Set(driftingDocs.map { "drift:\($0.documentId)" })
        for document in driftingDocs {
            center.postDrift(documentId: document.documentId, title: document.title)
        }
        for clearedKey in driftingKeys.subtracting(currentKeys) {
            center.clear(dedupeKey: clearedKey)
        }
        driftingKeys = currentKeys
    }
}
