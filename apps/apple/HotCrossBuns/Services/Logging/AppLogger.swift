import Foundation
import os

// Tiered local logger that writes to a rotating file plus bridges to
// os.Logger so entries show up in Console.app under the
// "com.gongahkia.hotcrossbuns.mac" subsystem.
//
// Usage:
//   AppLogger.debug("refreshNow start", category: .sync)
//   AppLogger.error("updateTask failed", category: .mutation, metadata: ["taskID": task.id, "status": "429"])
//
// Ring is capped at 3 rotated files of 1 MB each; older entries roll
// off. DiagnosticsView reads back the tail via recentEntries(limit:).
enum LogLevel: String, Sendable, Comparable, CaseIterable {
    case debug, info, warn, error

    var order: Int {
        switch self {
        case .debug: 0
        case .info: 1
        case .warn: 2
        case .error: 3
        }
    }

    static func < (lhs: LogLevel, rhs: LogLevel) -> Bool { lhs.order < rhs.order }

    var systemSymbol: String {
        switch self {
        case .debug: "ant"
        case .info: "info.circle"
        case .warn: "exclamationmark.triangle"
        case .error: "xmark.octagon"
        }
    }
}

enum LogCategory: String, Sendable, CaseIterable {
    case auth
    case sync
    case mutation
    case replay
    case notifications
    case cache
    case share
    case ui
    case misc
}

struct LogEntry: Identifiable, Hashable, Sendable {
    let timestamp: Date
    let level: LogLevel
    let category: LogCategory
    let message: String
    let metadata: [String: String]

    var id: String { "\(timestamp.timeIntervalSince1970)-\(message.hashValue)" }

    func formattedLine() -> String {
        let timeString = Self.formatter.string(from: timestamp)
        let metaString = metadata.isEmpty ? "" : " " + metadata
            .sorted { $0.key < $1.key }
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: " ")
        return "[\(timeString)] [\(level.rawValue.uppercased())] [\(category.rawValue)] \(message)\(metaString)"
    }

    static let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

// Serial actor so concurrent log calls from different tasks don't
// interleave partial lines or race on file rotation.
final class AppLogger: @unchecked Sendable {
    static let shared = AppLogger()

    private let queue = DispatchQueue(label: "com.gongahkia.hotcrossbuns.logger", qos: .utility)
    private let osLogger = Logger(subsystem: "com.gongahkia.hotcrossbuns.mac", category: "app")
    private let maxFileBytes: Int = 1_024 * 1_024 // 1 MB
    private let rotationKeep = 3
    private var inMemoryRing: [LogEntry] = []
    private let inMemoryCap = 500
    // Only entries at or above this level are persisted + surfaced.
    // Debug logs still write to os.Logger (Console.app) regardless.
    var persistentThreshold: LogLevel = .info

    private init() {}

    static func debug(_ message: String, category: LogCategory = .misc, metadata: [String: String] = [:]) {
        shared.log(level: .debug, message: message, category: category, metadata: metadata)
    }
    static func info(_ message: String, category: LogCategory = .misc, metadata: [String: String] = [:]) {
        shared.log(level: .info, message: message, category: category, metadata: metadata)
    }
    static func warn(_ message: String, category: LogCategory = .misc, metadata: [String: String] = [:]) {
        shared.log(level: .warn, message: message, category: category, metadata: metadata)
    }
    static func error(_ message: String, category: LogCategory = .misc, metadata: [String: String] = [:]) {
        shared.log(level: .error, message: message, category: category, metadata: metadata)
    }

    func log(level: LogLevel, message: String, category: LogCategory, metadata: [String: String]) {
        let entry = LogEntry(
            timestamp: Date(),
            level: level,
            category: category,
            message: message,
            metadata: metadata
        )
        bridgeToOSLogger(entry)
        queue.async { [weak self] in
            guard let self else { return }
            self.appendToRing(entry)
            guard level >= self.persistentThreshold else { return }
            self.appendToFile(entry)
        }
    }

    private func bridgeToOSLogger(_ entry: LogEntry) {
        switch entry.level {
        case .debug: osLogger.debug("\(entry.formattedLine(), privacy: .public)")
        case .info: osLogger.info("\(entry.formattedLine(), privacy: .public)")
        case .warn: osLogger.warning("\(entry.formattedLine(), privacy: .public)")
        case .error: osLogger.error("\(entry.formattedLine(), privacy: .public)")
        }
    }

    private func appendToRing(_ entry: LogEntry) {
        inMemoryRing.append(entry)
        if inMemoryRing.count > inMemoryCap {
            inMemoryRing.removeFirst(inMemoryRing.count - inMemoryCap)
        }
    }

    private func appendToFile(_ entry: LogEntry) {
        guard let url = Self.currentLogFileURL() else { return }
        let line = entry.formattedLine() + "\n"
        guard let data = line.data(using: .utf8) else { return }
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            if FileManager.default.fileExists(atPath: url.path) == false {
                try data.write(to: url)
            } else {
                let handle = try FileHandle(forWritingTo: url)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            }
            rotateIfNeeded(at: url)
        } catch {
            // Logger must not itself throw — fall back silently so we
            // don't take down the caller when the log dir is unavailable.
        }
    }

    private func rotateIfNeeded(at url: URL) {
        guard
            let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
            let size = attributes[.size] as? Int,
            size > maxFileBytes
        else { return }
        // Shift app.log.(rotationKeep-1) → delete; others shift up by 1.
        let directory = url.deletingLastPathComponent()
        let base = url.lastPathComponent
        for index in stride(from: rotationKeep - 1, through: 1, by: -1) {
            let src = directory.appending(path: "\(base).\(index)")
            let dst = directory.appending(path: "\(base).\(index + 1)")
            if index + 1 > rotationKeep {
                try? FileManager.default.removeItem(at: src)
                continue
            }
            if FileManager.default.fileExists(atPath: src.path) {
                try? FileManager.default.removeItem(at: dst)
                try? FileManager.default.moveItem(at: src, to: dst)
            }
        }
        let rotated = directory.appending(path: "\(base).1")
        try? FileManager.default.removeItem(at: rotated)
        try? FileManager.default.moveItem(at: url, to: rotated)
    }

    func recentEntries(limit: Int = 200, minimumLevel: LogLevel = .info) -> [LogEntry] {
        queue.sync {
            inMemoryRing
                .filter { $0.level >= minimumLevel }
                .suffix(limit)
        }
    }

    func loadPersistedLog() -> String {
        guard let url = Self.currentLogFileURL() else { return "" }
        return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }

    func currentLogFileURL() -> URL? {
        Self.currentLogFileURL()
    }

    static func currentLogFileURL() -> URL? {
        guard let support = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else { return nil }
        let bundle = Bundle.main.bundleIdentifier ?? "HotCrossBuns"
        return support
            .appending(path: bundle, directoryHint: .isDirectory)
            .appending(path: "logs", directoryHint: .isDirectory)
            .appending(path: "app.log")
    }
}
