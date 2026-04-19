import Foundation

actor LocalCacheStore {
    private let fileURL: URL?
    private let fallbackState: CachedAppState
    private var cachedState: CachedAppState
    private(set) var lastLoadWarning: String?
    private let snapshotGenerations = 3

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
            // Even the primary cache is missing — try our rotated snapshots
            // before falling all the way back to empty state.
            if let snapshot = loadFromSnapshots() {
                lastLoadWarning = "Primary cache was missing; restored from most recent snapshot."
                cachedState = snapshot
                return snapshot
            }
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
            AppLogger.error("cache decode failed, trying snapshots", category: .cache, metadata: [
                "error": String(describing: error)
            ])
            // Try each rotated snapshot in newest-first order before
            // falling back to partial recovery of just the pending queue.
            if let fromSnapshot = loadFromSnapshots() {
                lastLoadWarning = "Primary cache was unreadable; restored from snapshot."
                AppLogger.info("cache snapshot recovered", category: .cache)
                cachedState = fromSnapshot
                return fromSnapshot
            }
            let salvagedMutations = recoverPendingMutations(from: fileURL)
            var recovered = fallbackState
            if salvagedMutations.isEmpty == false {
                recovered.pendingMutations = salvagedMutations
            }
            lastLoadWarning = salvagedMutations.isEmpty
                ? "Local cache could not be read (\(error.localizedDescription)); starting fresh."
                : "Local cache was rebuilt after a schema change. \(salvagedMutations.count) pending mutation\(salvagedMutations.count == 1 ? "" : "s") preserved."
            AppLogger.error("cache snapshots exhausted", category: .cache, metadata: [
                "salvagedMutations": String(salvagedMutations.count)
            ])
            cachedState = recovered
            return recovered
        }
    }

    private func loadFromSnapshots() -> CachedAppState? {
        guard let fileURL else { return nil }
        for index in 1...snapshotGenerations {
            let url = snapshotURL(at: index, basedOn: fileURL)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            guard let data = try? Data(contentsOf: url) else { continue }
            if let state = try? JSONDecoder.cachedAppState.decode(CachedAppState.self, from: data) {
                return state
            }
        }
        return nil
    }

    private func snapshotURL(at index: Int, basedOn fileURL: URL) -> URL {
        fileURL
            .deletingLastPathComponent()
            .appending(path: "\(fileURL.lastPathComponent).\(index)")
    }

    private func rotateSnapshotsBeforeWrite(fileURL: URL) {
        // Shift .1 → .2 → .3 → drop before writing a new primary. Must
        // run before the atomic write so if the write fails we still
        // have the previous generation intact at .1.
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        for index in stride(from: snapshotGenerations - 1, through: 1, by: -1) {
            let src = snapshotURL(at: index, basedOn: fileURL)
            let dst = snapshotURL(at: index + 1, basedOn: fileURL)
            guard FileManager.default.fileExists(atPath: src.path) else { continue }
            try? FileManager.default.removeItem(at: dst)
            try? FileManager.default.moveItem(at: src, to: dst)
        }
        let firstSnapshot = snapshotURL(at: 1, basedOn: fileURL)
        try? FileManager.default.removeItem(at: firstSnapshot)
        try? FileManager.default.copyItem(at: fileURL, to: firstSnapshot)
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
            rotateSnapshotsBeforeWrite(fileURL: fileURL)
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
