import Foundation

actor LocalCacheStore {
    private var cachedState: CachedAppState

    init(cachedState: CachedAppState = .empty) {
        self.cachedState = cachedState
    }

    func loadCachedState() -> CachedAppState {
        cachedState
    }

    func save(_ state: CachedAppState) {
        cachedState = state
    }
}
