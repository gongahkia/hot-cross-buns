import Foundation

actor LocalCacheStore {
    private var cachedState: CachedAppState

    init(cachedState: CachedAppState = .preview) {
        self.cachedState = cachedState
    }

    func loadCachedState() -> CachedAppState {
        cachedState
    }

    func save(_ state: CachedAppState) {
        cachedState = state
    }
}
