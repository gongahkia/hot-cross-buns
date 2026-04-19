import Foundation

// Append-only ledger of user-originated mutations. Separate from
// AppLogger (which captures general debug info) because this is the
// "I need to answer 'when did I mark that done?' six months from now"
// record. Kept to a generous cap so even a year of active use fits
// in a single file.
struct MutationAuditEntry: Codable, Hashable, Sendable, Identifiable {
    let timestamp: Date
    let kind: String
    let resourceID: String
    let summary: String
    let metadata: [String: String]

    var id: String { "\(timestamp.timeIntervalSince1970)-\(resourceID)-\(kind)" }
}

actor MutationAuditLog {
    static let shared = MutationAuditLog()
    private static let retentionLimit = 5000
    private var buffer: [MutationAuditEntry] = []
    private var hasLoaded = false

    func record(kind: String, resourceID: String, summary: String, metadata: [String: String] = [:]) {
        ensureLoaded()
        let entry = MutationAuditEntry(
            timestamp: Date(),
            kind: kind,
            resourceID: resourceID,
            summary: summary,
            metadata: metadata
        )
        buffer.append(entry)
        if buffer.count > Self.retentionLimit {
            buffer.removeFirst(buffer.count - Self.retentionLimit)
        }
        persist()
    }

    func recentEntries(limit: Int = 100) -> [MutationAuditEntry] {
        ensureLoaded()
        return Array(buffer.suffix(limit).reversed())
    }

    func clear() {
        buffer = []
        persist()
    }

    private func ensureLoaded() {
        if hasLoaded { return }
        hasLoaded = true
        guard
            let url = Self.fileURL(),
            FileManager.default.fileExists(atPath: url.path),
            let data = try? Data(contentsOf: url),
            let decoded = try? JSONDecoder().decode([MutationAuditEntry].self, from: data)
        else { return }
        buffer = decoded
    }

    private func persist() {
        guard let url = Self.fileURL() else { return }
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let data = try JSONEncoder().encode(buffer)
            try data.write(to: url, options: [.atomic])
        } catch {
            AppLogger.warn("audit log write failed", category: .cache, metadata: ["error": String(describing: error)])
        }
    }

    static func fileURL() -> URL? {
        guard let support = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else { return nil }
        let bundle = Bundle.main.bundleIdentifier ?? "HotCrossBuns"
        return support
            .appending(path: bundle, directoryHint: .isDirectory)
            .appending(path: "audit.log")
    }
}
