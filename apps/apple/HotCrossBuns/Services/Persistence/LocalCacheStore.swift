import Foundation

actor LocalCacheStore {
    private let fileURL: URL?
    private let fallbackState: CachedAppState
    private var cachedState: CachedAppState
    private(set) var lastLoadWarning: String?

    init(
        fileURL: URL? = LocalCacheStore.defaultCacheFileURL,
        cachedState: CachedAppState = .empty
    ) {
        self.fileURL = fileURL
        self.fallbackState = cachedState
        self.cachedState = cachedState
    }

    func loadCachedState() -> CachedAppState {
        guard let fileURL, FileManager.default.fileExists(atPath: fileURL.path) else {
            return cachedState
        }

        do {
            let data = try Data(contentsOf: fileURL)
            let state = try JSONDecoder.cachedAppState.decode(CachedAppState.self, from: data)
            lastLoadWarning = nil
            cachedState = state
            return state
        } catch {
            // Full decode failed — likely a schema drift in a future release.
            let salvagedMutations = recoverPendingMutations(from: fileURL)
            var recovered = fallbackState
            if salvagedMutations.isEmpty == false {
                recovered.pendingMutations = salvagedMutations
            }
            lastLoadWarning = salvagedMutations.isEmpty
                ? "Local cache could not be read (\(error.localizedDescription)); starting fresh."
                : "Local cache was rebuilt after a schema change. \(salvagedMutations.count) pending mutation\(salvagedMutations.count == 1 ? "" : "s") preserved."
            AppLogger.error("cache decode failed", category: .cache, metadata: [
                "error": String(describing: error),
                "salvagedMutations": String(salvagedMutations.count)
            ])
            cachedState = recovered
            return recovered
        }
    }

    private func recoverPendingMutations(from fileURL: URL) -> [PendingMutation] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        struct PartialState: Decodable { var pendingMutations: [PendingMutation]? }
        if let partial = try? JSONDecoder.cachedAppState.decode(PartialState.self, from: data) {
            return partial.pendingMutations ?? []
        }
        return []
    }

    func save(_ state: CachedAppState) {
        cachedState = state

        guard let fileURL else {
            return
        }

        do {
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let data = try JSONEncoder.cachedAppState.encode(state)
            try data.write(to: fileURL, options: [.atomic])
        } catch {
            // Keep the in-memory cache usable even when the filesystem write fails.
            AppLogger.warn("cache write failed", category: .cache, metadata: ["error": String(describing: error)])
        }
    }

    func cacheFilePath() -> String? {
        fileURL?.path
    }
}

private extension LocalCacheStore {
    static var defaultCacheFileURL: URL? {
        guard let appSupportURL = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            return nil
        }

        let appDirectoryName = Bundle.main.bundleIdentifier ?? "HotCrossBuns"
        return appSupportURL
            .appending(path: appDirectoryName, directoryHint: .isDirectory)
            .appending(path: "cache-state.json")
    }
}

private extension JSONDecoder {
    static var cachedAppState: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private extension JSONEncoder {
    static var cachedAppState: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}
