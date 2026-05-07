import Foundation

protocol ImportRuntimeBridging: Sendable {
    func importMarkdownFile(
        cacheRoot: String,
        sourcePath: String,
        targetDraftId: String,
        options: ImportOptions,
        accessToken: String?
    ) throws -> RuntimeBridge.ImportResult

    func ensureFreshAccessToken(
        credentialsPath: String,
        account: String,
        leewaySeconds: UInt64
    ) throws -> String
}

struct LiveImportRuntimeBridge: ImportRuntimeBridging {
    func importMarkdownFile(
        cacheRoot: String,
        sourcePath: String,
        targetDraftId: String,
        options: ImportOptions,
        accessToken: String?
    ) throws -> RuntimeBridge.ImportResult {
        try RuntimeBridge.importMarkdownFile(
            cacheRoot: cacheRoot,
            sourcePath: sourcePath,
            targetDraftId: targetDraftId,
            options: options,
            accessToken: accessToken
        )
    }

    func ensureFreshAccessToken(
        credentialsPath: String,
        account: String,
        leewaySeconds: UInt64
    ) throws -> String {
        try RuntimeBridge.ensureFreshAccessToken(
            credentialsPath: credentialsPath,
            account: account,
            leewaySeconds: leewaySeconds
        )
    }
}

@MainActor
final class ImportViewModel: ObservableObject {
    struct PendingConfirmation: Identifiable, Equatable {
        enum Kind: Equatable {
            case folderLimit(found: Int)
            case largeFiles
        }

        let id = UUID()
        let kind: Kind
        let files: [URL]
    }

    @Published private(set) var jobs: [ImportJob] = []
    @Published var options = ImportOptions()
    @Published private(set) var inFlight = false
    @Published var lastError: String? = nil
    @Published var pendingConfirmation: PendingConfirmation? = nil

    weak var session: AppSession?
    var bridge: any ImportRuntimeBridging = LiveImportRuntimeBridge()

    func enqueue(urls: [URL]) {
        let files = collectImportableFiles(from: urls)
        if pendingConfirmation != nil {
            return
        }
        guard !files.isEmpty else {
            lastError = "No Markdown files found."
            return
        }
        let largeFiles = files.filter { byteSize(for: $0) > 10 * 1024 * 1024 }
        if !largeFiles.isEmpty {
            pendingConfirmation = PendingConfirmation(kind: .largeFiles, files: files)
            return
        }
        appendJobs(files)
    }

    func confirmPendingImport() {
        guard let pendingConfirmation else { return }
        self.pendingConfirmation = nil
        appendJobs(pendingConfirmation.files)
    }

    func cancelPendingImport() {
        pendingConfirmation = nil
    }

    func runAll() async {
        guard !inFlight else { return }
        guard let session else {
            lastError = "Import session is not ready."
            return
        }
        inFlight = true
        defer { inFlight = false }

        let cacheRoot = session.cacheRoot
        let credentialsPath = session.credentialsPath
        let account = session.activeAccount
        let selectedOptions = options
        var accessToken: String? = nil
        if selectedOptions.pushToDrive {
            guard let account else {
                lastError = "Sign in to push on import."
                return
            }
            do {
                let bridge = bridge
                accessToken = try await Task.detached(priority: .userInitiated) {
                    try bridge.ensureFreshAccessToken(
                        credentialsPath: credentialsPath,
                        account: account,
                        leewaySeconds: 60
                    )
                }.value
            } catch {
                lastError = "Access token refresh failed: \(error)"
                return
            }
        }

        for index in jobs.indices {
            guard case .pending = jobs[index].status else { continue }
            jobs[index].status = .running
            let job = jobs[index]
            let source = job.sourcePath
            let scoped = source.startAccessingSecurityScopedResource()
            do {
                let bridge = bridge
                let result = try await Task.detached(priority: .userInitiated) {
                    try bridge.importMarkdownFile(
                        cacheRoot: cacheRoot,
                        sourcePath: source.path,
                        targetDraftId: job.targetDraftId,
                        options: selectedOptions,
                        accessToken: accessToken
                    )
                }.value
                if scoped {
                    source.stopAccessingSecurityScopedResource()
                }
                jobs[index].targetDraftId = result.draftId
                switch result.status {
                case "succeeded":
                    jobs[index].status = .succeeded(
                        draftId: result.draftId,
                        pushedDocumentId: result.pushedDocumentId
                    )
                case "skipped":
                    jobs[index].status = .skipped(reason: result.error ?? "Already imported.")
                default:
                    jobs[index].status = .failed(reason: result.error ?? "Import failed.")
                }
            } catch {
                if scoped {
                    source.stopAccessingSecurityScopedResource()
                }
                jobs[index].status = .failed(reason: "\(error)")
            }
        }
    }

    func clear() {
        jobs = []
        lastError = nil
    }

    private func collectImportableFiles(from urls: [URL]) -> [URL] {
        var files: [URL] = []
        for url in urls {
            if isDirectory(url) {
                let found = markdownFiles(in: url)
                if found.count > options.maxFolderFiles {
                    pendingConfirmation = PendingConfirmation(
                        kind: .folderLimit(found: found.count),
                        files: found
                    )
                    continue
                }
                files.append(contentsOf: found)
            } else if isMarkdownFile(url) {
                files.append(url)
            }
        }
        return Array(Set(files)).sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
    }

    private func appendJobs(_ files: [URL]) {
        let existing = Set(jobs.map(\.sourcePath))
        for file in files where !existing.contains(file) {
            jobs.append(ImportJob(
                sourcePath: file,
                targetDraftId: Self.makeDraftId(),
                byteSize: byteSize(for: file)
            ))
        }
    }

    private func markdownFiles(in dir: URL) -> [URL] {
        guard let enumerator = FileManager.default.enumerator(
            at: dir,
            includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }
        return enumerator.compactMap { entry in
            guard let url = entry as? URL, !isDirectory(url), isMarkdownFile(url) else {
                return nil
            }
            return url
        }
    }

    private func isDirectory(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
    }

    private func isMarkdownFile(_ url: URL) -> Bool {
        ["md", "markdown"].contains(url.pathExtension.lowercased())
    }

    private func byteSize(for url: URL) -> Int64 {
        Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    }

    private static func makeDraftId() -> String {
        let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
        var value = UInt64(Date().timeIntervalSince1970 * 1000)
        var chars = Array(repeating: Character("0"), count: 13)
        for index in stride(from: chars.count - 1, through: 0, by: -1) {
            chars[index] = alphabet[Int(value & 31)]
            value >>= 5
        }
        var randomValue = UInt64.random(in: 0...UInt64.max)
        var randomChars = Array(repeating: Character("0"), count: 13)
        for index in stride(from: randomChars.count - 1, through: 0, by: -1) {
            randomChars[index] = alphabet[Int(randomValue & 31)]
            randomValue >>= 5
        }
        return "draft-\(String(chars))\(String(randomChars))"
    }
}
