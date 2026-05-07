import AppKit
import Foundation

@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var settings: AppSettings = .default
    @Published var loadError: String?
    @Published var saveError: String?
    @Published var isCorruptFallback = false
    @Published var backupStatus: String?
    @Published var backupInProgress = false

    private var cacheRoot = ""
    private var saveTask: Task<Void, Never>?

    deinit {
        saveTask?.cancel()
    }

    func load(cacheRoot: String) {
        self.cacheRoot = cacheRoot
        do {
            settings = try RuntimeBridge.loadSettings(cacheRoot: cacheRoot)
            isCorruptFallback = false
            loadError = nil
        } catch RuntimeBridgeError.decode {
            settings = .default
            isCorruptFallback = true
            loadError = "settings.json was corrupt - defaults loaded. Change a setting to overwrite it."
        } catch {
            settings = .default
            isCorruptFallback = false
            loadError = "\(error)"
        }
    }

    func update<V>(_ keyPath: WritableKeyPath<AppSettings, V>, _ value: V) {
        settings[keyPath: keyPath] = value
        scheduleSave()
    }

    func updateMac<V>(_ keyPath: WritableKeyPath<AppSettings.MacExtras, V>, _ value: V) {
        settings.mac[keyPath: keyPath] = value
        scheduleSave()
    }

    func refreshMacValue<V: Equatable>(
        _ keyPath: WritableKeyPath<AppSettings.MacExtras, V>,
        _ value: V
    ) {
        guard settings.mac[keyPath: keyPath] != value else { return }
        settings.mac[keyPath: keyPath] = value
    }

    func updateShortcut(
        _ keyPath: WritableKeyPath<AppSettings.Shortcuts, String>,
        _ value: String
    ) {
        settings.mac.shortcuts[keyPath: keyPath] = value
        scheduleSave()
    }

    func persistNow() {
        saveTask?.cancel()
        do {
            try RuntimeBridge.saveSettings(cacheRoot: cacheRoot, settings: settings)
            saveError = nil
            isCorruptFallback = false
        } catch {
            saveError = "\(error)"
        }
    }

    func resetSettingsFile() {
        saveTask?.cancel()
        let url = URL(fileURLWithPath: cacheRoot).appendingPathComponent("settings.json")
        do {
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
            settings = .default
            isCorruptFallback = false
            loadError = nil
            saveError = nil
        } catch {
            saveError = "\(error)"
        }
    }

    func runBackupNow() {
        guard !cacheRoot.isEmpty else {
            backupStatus = "Cache root is not available."
            return
        }
        backupInProgress = true
        backupStatus = nil
        let source = URL(fileURLWithPath: cacheRoot)
        Task.detached(priority: .utility) {
            let result = Self.createBackupZip(source: source)
            await MainActor.run {
                self.backupInProgress = false
                self.backupStatus = result
            }
        }
    }

    func openBackupFolder() {
        let folder = Self.backupFolder()
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        NSWorkspace.shared.activateFileViewerSelecting([folder])
    }

    private func scheduleSave() {
        saveTask?.cancel()
        let snapshot = settings
        let root = cacheRoot
        saveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            do {
                try RuntimeBridge.saveSettings(cacheRoot: root, settings: snapshot)
                await MainActor.run {
                    self?.saveError = nil
                    self?.isCorruptFallback = false
                }
            } catch {
                await MainActor.run {
                    self?.saveError = "\(error)"
                }
            }
        }
    }

    private nonisolated static func backupFolder() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MelonPan")
            .appendingPathComponent("Backups")
    }

    private nonisolated static func createBackupZip(source: URL) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withDashSeparatorInDate, .withColonSeparatorInTime]
        let stamp = formatter.string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
        let folder = backupFolder()
        let destination = folder.appendingPathComponent("melon-pan-cache-\(stamp).zip")
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            process.arguments = [
                "-c",
                "-k",
                "--sequesterRsrc",
                "--keepParent",
                source.path,
                destination.path
            ]
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                return "Backup failed: ditto exited with \(process.terminationStatus)."
            }
            let bytes = (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            let size = ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
            return "Backed up \(size) to \(destination.lastPathComponent)."
        } catch {
            return "Backup failed: \(error)"
        }
    }
}
