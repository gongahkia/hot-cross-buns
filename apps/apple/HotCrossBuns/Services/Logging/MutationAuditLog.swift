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
    // JSON encodings of the pre/post resource state. Optional for backwards
    // compatibility with entries written before the history expansion — old
    // entries decode with nil and simply can't offer snapshot-copy.
    let priorSnapshotJSON: String?
    let postSnapshotJSON: String?

    var id: String { "\(timestamp.timeIntervalSince1970)-\(resourceID)-\(kind)" }

    enum CodingKeys: String, CodingKey {
        case timestamp, kind, resourceID, summary, metadata, priorSnapshotJSON, postSnapshotJSON
    }

    init(
        timestamp: Date,
        kind: String,
        resourceID: String,
        summary: String,
        metadata: [String: String],
        priorSnapshotJSON: String? = nil,
        postSnapshotJSON: String? = nil
    ) {
        self.timestamp = timestamp
        self.kind = kind
        self.resourceID = resourceID
        self.summary = summary
        self.metadata = metadata
        self.priorSnapshotJSON = priorSnapshotJSON
        self.postSnapshotJSON = postSnapshotJSON
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        timestamp = try c.decode(Date.self, forKey: .timestamp)
        kind = try c.decode(String.self, forKey: .kind)
        resourceID = try c.decode(String.self, forKey: .resourceID)
        summary = try c.decode(String.self, forKey: .summary)
        metadata = try c.decode([String: String].self, forKey: .metadata)
        priorSnapshotJSON = try c.decodeIfPresent(String.self, forKey: .priorSnapshotJSON)
        postSnapshotJSON = try c.decodeIfPresent(String.self, forKey: .postSnapshotJSON)
    }
}

actor MutationAuditLog {
    static let shared = MutationAuditLog()
    // Absolute ceiling enforced regardless of user setting to keep file
    // size bounded. Settings slider caps out at this value.
    static let absoluteCeiling = 50000
    private var retentionLimit: Int = 5000
    private var buffer: [MutationAuditEntry] = []
    private var hasLoaded = false

    func setRetentionLimit(_ limit: Int) {
        retentionLimit = max(1, min(Self.absoluteCeiling, limit))
        if buffer.count > retentionLimit {
            buffer.removeFirst(buffer.count - retentionLimit)
            persist()
        }
    }

    func record(
        kind: String,
        resourceID: String,
        summary: String,
        metadata: [String: String] = [:],
        priorSnapshotJSON: String? = nil,
        postSnapshotJSON: String? = nil
    ) {
        ensureLoaded()
        let entry = MutationAuditEntry(
            timestamp: Date(),
            kind: kind,
            resourceID: resourceID,
            summary: summary,
            metadata: metadata,
            priorSnapshotJSON: priorSnapshotJSON,
            postSnapshotJSON: postSnapshotJSON
        )
        buffer.append(entry)
        if buffer.count > retentionLimit {
            buffer.removeFirst(buffer.count - retentionLimit)
        }
        persist()
    }

    func recentEntries(limit: Int = 100) -> [MutationAuditEntry] {
        ensureLoaded()
        return Array(buffer.suffix(limit).reversed())
    }

    func allEntries() -> [MutationAuditEntry] {
        ensureLoaded()
        return buffer.reversed()
    }

    func delete(id entryID: String) {
        ensureLoaded()
        buffer.removeAll { $0.id == entryID }
        persist()
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
