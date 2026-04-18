import Foundation

actor LocalCacheStore {
    private let fileURL: URL?
    private let fallbackState: CachedAppState
    private var cachedState: CachedAppState

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
            cachedState = state
            return state
        } catch {
            cachedState = fallbackState
            return fallbackState
        }
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
        }
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
