import Foundation

actor SyncScheduler {
    func syncNow(mode: SyncMode) async throws -> CachedAppState {
        try await Task.sleep(for: .milliseconds(mode == .nearRealtime ? 250 : 500))
        return .preview
    }
}
