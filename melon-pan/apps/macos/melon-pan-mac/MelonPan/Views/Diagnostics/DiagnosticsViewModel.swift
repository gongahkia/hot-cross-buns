import AppKit
import Combine
import Darwin
import Foundation
import Network
import SwiftUI
import UserNotifications

protocol RuntimeBridging: Sendable {
    func diagnosticSnapshot(cacheRoot: String) throws -> RuntimeBridge.DiagnosticSnapshot
    func auditStatus(cacheRoot: String, documentId: String) throws -> RuntimeBridge.AuditStatusReport
    func keychainProbe() throws -> RuntimeBridge.KeychainProbeReport
    func tokenMetadata(account: String) -> RuntimeBridge.TokenMetadata?
    func runtimeVersions() throws -> RuntimeBridge.RuntimeVersions
    func ensureFreshAccessToken(credentialsPath: String, account: String, leewaySeconds: UInt64) throws -> String
    func forceFullResync(cacheRoot: String, accessToken: String) throws
    func clearCachedDriveData(cacheRoot: String) throws
    func docPendingSummary(cacheRoot: String, documentId: String) throws -> RuntimeBridge.DocPendingSummary
}

struct LiveRuntimeBridge: RuntimeBridging {
    func diagnosticSnapshot(cacheRoot: String) throws -> RuntimeBridge.DiagnosticSnapshot {
        try RuntimeBridge.diagnosticSnapshot(cacheRoot: cacheRoot)
    }

    func auditStatus(cacheRoot: String, documentId: String) throws -> RuntimeBridge.AuditStatusReport {
        try RuntimeBridge.auditStatus(cacheRoot: cacheRoot, documentId: documentId)
    }

    func keychainProbe() throws -> RuntimeBridge.KeychainProbeReport {
        try RuntimeBridge.keychainProbe()
    }

    func tokenMetadata(account: String) -> RuntimeBridge.TokenMetadata? {
        RuntimeBridge.tokenMetadata(account: account)
    }

    func runtimeVersions() throws -> RuntimeBridge.RuntimeVersions {
        try RuntimeBridge.runtimeVersions()
    }

    func ensureFreshAccessToken(credentialsPath: String, account: String, leewaySeconds: UInt64) throws -> String {
        try RuntimeBridge.ensureFreshAccessToken(
            credentialsPath: credentialsPath,
            account: account,
            leewaySeconds: leewaySeconds
        )
    }

    func forceFullResync(cacheRoot: String, accessToken: String) throws {
        try RuntimeBridge.forceFullResync(cacheRoot: cacheRoot, accessToken: accessToken)
    }

    func clearCachedDriveData(cacheRoot: String) throws {
        try RuntimeBridge.clearCachedDriveData(cacheRoot: cacheRoot)
    }

    func docPendingSummary(cacheRoot: String, documentId: String) throws -> RuntimeBridge.DocPendingSummary {
        try RuntimeBridge.docPendingSummary(cacheRoot: cacheRoot, documentId: documentId)
    }
}

@MainActor
final class DiagnosticsViewModel: ObservableObject {
    @Published var account: AccountState = .loading
    @Published var cache: CacheState = .loading
    @Published var sync: [DocSyncState] = []
    @Published var audit: [DocAuditState] = []
    @Published var keychain: KeychainState = .loading
    @Published var build: BuildState = .loading
    @Published var environment: EnvironmentState = .loading
    @Published var network: NetworkState = .loading
    @Published var isWorking = false
    @Published var actionBanner: ActionBanner? = nil

    var bridge: any RuntimeBridging = LiveRuntimeBridge()

    enum AccountState {
        case loading
        case signedIn(account: String, scopes: [String], expiresAtUnix: UInt64?)
        case signedOut
        case error(String)
    }

    struct CacheState {
        let root: String
        let totalBytes: UInt64
        let docCount: Int
        let snapshotCount: Int
        let driveTreeMtime: Date?

        static let loading = CacheState(
            root: "",
            totalBytes: 0,
            docCount: 0,
            snapshotCount: 0,
            driveTreeMtime: nil
        )
    }

    struct DocSyncState: Identifiable {
        let id: String
        let title: String
        let lastPull: Date?
        let lastPush: Date?
        let inFlight: Bool
        let queuedMutations: Int
        let snapshotCount: Int
        let hasFailure: Bool
    }

    struct DocAuditState: Identifiable {
        let id: String
        let title: String
        let mdHash: String
        let docsHash: String
        let mdFromDocsHash: String
        let docsFromMdHash: String
        let error: String?

        var mdMatchesDocs: Bool { error == nil && mdHash == mdFromDocsHash }
        var docsMatchesMd: Bool { error == nil && docsHash == docsFromMdHash }
    }

    enum KeychainState {
        case loading
        case ok(itemCount: Int, service: String)
        case locked
        case denied
        case missing
        case error(String)
    }

    struct BuildState {
        let appVersion: String
        let buildNumber: String
        let commitSHA: String
        let buildTimestamp: String
        let runtimeSharedVersion: String
        let coreVersion: String

        static let loading = BuildState(
            appVersion: "",
            buildNumber: "",
            commitSHA: "",
            buildTimestamp: "",
            runtimeSharedVersion: "",
            coreVersion: ""
        )
    }

    struct EnvironmentState {
        let osVersion: String
        let hardwareModel: String
        let cpuArch: String
        let locale: String
        let screenScale: Double
        let thermalState: String
        let lowPowerMode: Bool
        let notificationAuthorization: String

        static let loading = EnvironmentState(
            osVersion: "",
            hardwareModel: "",
            cpuArch: "",
            locale: "",
            screenScale: 0,
            thermalState: "",
            lowPowerMode: false,
            notificationAuthorization: ""
        )
    }

    enum NetworkState {
        case loading
        case reachable(via: String, lastSuccess: Date?, rateLimitHits: Int)
        case unreachable(reason: String)
    }

    struct ActionBanner: Equatable {
        let text: String
        let kind: Kind

        enum Kind {
            case ok, warn, error
        }
    }

    func refreshAll(session: AppSession) async {
        guard isWorking == false else { return }
        await refreshOverview(session: session)
        await refreshSync(session: session)
        await refreshEnvironment(session: session)
    }

    func refreshTab(_ tab: DiagnosticsPane.Tab, session: AppSession) async {
        guard isWorking == false else { return }
        switch tab {
        case .overview:
            await refreshOverview(session: session)
        case .sync:
            await refreshSync(session: session)
        case .environment:
            await refreshEnvironment(session: session)
        case .recovery:
            break
        }
    }

    func forceFullResync(session: AppSession) async {
        guard let account = session.activeAccount else {
            actionBanner = ActionBanner(text: "Sign in before forcing a full resync.", kind: .warn)
            return
        }
        let root = session.cacheRoot
        let credentials = session.credentialsPath
        let bridge = bridge
        await runRecoveryAction(successText: "Full resync complete.") {
            let token = try bridge.ensureFreshAccessToken(
                credentialsPath: credentials,
                account: account,
                leewaySeconds: 60
            )
            try bridge.forceFullResync(cacheRoot: root, accessToken: token)
        }
        await refreshAllAfterRecovery(session: session)
    }

    func clearCachedDriveData(session: AppSession) async {
        let root = session.cacheRoot
        let bridge = bridge
        await runRecoveryAction(successText: "Cached Drive data cleared.") {
            try bridge.clearCachedDriveData(cacheRoot: root)
        }
        if actionBanner?.kind == .ok {
            await SpotlightIndexer.shared.removeAll()
        }
        session.openDocuments.removeAll()
        session.activeDocumentId = nil
        session.persistWindowsState()
        await refreshAllAfterRecovery(session: session)
    }

    func reSignIn(session: AppSession) async {
        session.showSignInSheet = true
    }

    func openCacheInFinder(session: AppSession) {
        NSWorkspace.shared.activateFileViewerSelecting([
            URL(fileURLWithPath: session.cacheRoot)
        ])
    }

    func copyDiagnosticSummary(session: AppSession) async {
        let report = await DiagnosticReport.capture(viewModel: self, session: session)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(report.toPlainText(), forType: .string)
        actionBanner = ActionBanner(text: "Diagnostic summary copied.", kind: .ok)
    }

    func exportSupportBundle(session: AppSession) async {
        do {
            let report = await DiagnosticReport.capture(viewModel: self, session: session)
            try await SupportBundleExporter.export(report: report, session: session)
            actionBanner = ActionBanner(text: "Support bundle exported.", kind: .ok)
        } catch is CancellationError {
            return
        } catch {
            actionBanner = ActionBanner(text: "Export failed: \(error)", kind: .error)
        }
    }

    private func refreshOverview(session: AppSession) async {
        await refreshAccount(activeAccount: session.activeAccount)
        await refreshCacheAndBuild(cacheRoot: session.cacheRoot)
    }

    private func refreshEnvironment(session: AppSession) async {
        await refreshEnvironmentState()
        await refreshNetworkState()
        await refreshKeychain()
    }

    private func refreshSync(session: AppSession) async {
        let root = session.cacheRoot
        let docs = session.openDocuments
        guard docs.isEmpty == false else {
            sync = []
            audit = []
            return
        }
        let bridge = bridge
        var syncRows: [DocSyncState] = []
        var auditRows: [DocAuditState] = []
        for doc in docs {
            let pending = try? await Task.detached(priority: .userInitiated) {
                try bridge.docPendingSummary(cacheRoot: root, documentId: doc.documentId)
            }.value
            let metadata = readMetadata(cacheRoot: root, documentId: doc.documentId)
            syncRows.append(DocSyncState(
                id: doc.documentId,
                title: doc.title,
                lastPull: parseDate(metadata?.lastPulledAt),
                lastPush: parseDate(metadata?.lastPushedAt),
                inFlight: doc.isLoading,
                queuedMutations: pending?.pendingMutations.count ?? 0,
                snapshotCount: pending?.prePushSnapshots.count ?? 0,
                hasFailure: doc.loadError != nil
            ))
            do {
                let report = try await Task.detached(priority: .userInitiated) {
                    try bridge.auditStatus(cacheRoot: root, documentId: doc.documentId)
                }.value
                auditRows.append(DocAuditState(
                    id: doc.documentId,
                    title: doc.title,
                    mdHash: report.mdHash,
                    docsHash: report.docsHash,
                    mdFromDocsHash: report.mdFromDocsHash,
                    docsFromMdHash: report.docsFromMdHash,
                    error: nil
                ))
            } catch {
                auditRows.append(DocAuditState(
                    id: doc.documentId,
                    title: doc.title,
                    mdHash: "",
                    docsHash: "",
                    mdFromDocsHash: "",
                    docsFromMdHash: "",
                    error: "\(error)"
                ))
            }
        }
        sync = syncRows
        audit = auditRows
    }

    private func refreshAccount(activeAccount: String?) async {
        guard let activeAccount else {
            account = .signedOut
            return
        }
        let bridge = bridge
        let metadata = await Task.detached(priority: .userInitiated) {
            bridge.tokenMetadata(account: activeAccount)
        }.value
        guard let metadata else {
            account = .error("No token metadata found for \(activeAccount)")
            return
        }
        let scopes = metadata.scope
            .split(separator: " ")
            .map(String.init)
        account = .signedIn(
            account: activeAccount,
            scopes: scopes,
            expiresAtUnix: metadata.expiresAtUnix
        )
    }

    private func refreshCacheAndBuild(cacheRoot: String) async {
        let bridge = bridge
        do {
            let snapshot = try await Task.detached(priority: .userInitiated) {
                try bridge.diagnosticSnapshot(cacheRoot: cacheRoot)
            }.value
            cache = CacheState(
                root: snapshot.cacheRoot,
                totalBytes: snapshot.totalSnapshotBytes,
                docCount: snapshot.docCount,
                snapshotCount: snapshot.snapshotCount,
                driveTreeMtime: snapshot.driveTreeMtimeUnix.map { Date(timeIntervalSince1970: TimeInterval($0)) }
            )
            let versions = try await Task.detached(priority: .userInitiated) {
                try bridge.runtimeVersions()
            }.value
            let info = Bundle.main.infoDictionary ?? [:]
            build = BuildState(
                appVersion: info["CFBundleShortVersionString"] as? String ?? "unknown",
                buildNumber: info["CFBundleVersion"] as? String ?? "unknown",
                commitSHA: (info["MelonPanCommitSHA"] as? String) ?? versions.commitSHA,
                buildTimestamp: (info["MelonPanBuildTimestamp"] as? String) ?? versions.buildTimestamp,
                runtimeSharedVersion: versions.runtimeSharedVersion,
                coreVersion: versions.coreVersion
            )
        } catch {
            cache = CacheState(root: cacheRoot, totalBytes: 0, docCount: 0, snapshotCount: 0, driveTreeMtime: nil)
            build = .loading
            actionBanner = ActionBanner(text: "Diagnostics refresh failed: \(error)", kind: .error)
        }
    }

    private func refreshKeychain() async {
        let bridge = bridge
        do {
            let probe = try await Task.detached(priority: .userInitiated) {
                try bridge.keychainProbe()
            }.value
            switch probe.state {
            case "ok":
                keychain = .ok(itemCount: Int(probe.itemCount), service: probe.service)
            case "locked":
                keychain = .locked
            case "denied":
                keychain = .denied
            case "missing":
                keychain = .missing
            default:
                keychain = .error(probe.state)
            }
        } catch {
            keychain = .error("\(error)")
        }
    }

    private func refreshEnvironmentState() async {
        let os = ProcessInfo.processInfo.operatingSystemVersionString
        let notification = await notificationAuthorization()
        environment = EnvironmentState(
            osVersion: os,
            hardwareModel: hardwareModel(),
            cpuArch: cpuArchitecture(),
            locale: Locale.current.identifier,
            screenScale: Double(NSScreen.main?.backingScaleFactor ?? 0),
            thermalState: thermalState(ProcessInfo.processInfo.thermalState),
            lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled,
            notificationAuthorization: notification
        )
    }

    private func refreshNetworkState() async {
        network = await Self.networkSnapshot()
    }

    private func runRecoveryAction(
        successText: String,
        action: @escaping @Sendable () throws -> Void
    ) async {
        guard isWorking == false else { return }
        isWorking = true
        do {
            try await Task.detached(priority: .userInitiated) {
                try action()
            }.value
            actionBanner = ActionBanner(text: successText, kind: .ok)
        } catch {
            actionBanner = ActionBanner(text: "\(error)", kind: .error)
        }
        isWorking = false
    }

    private func refreshAllAfterRecovery(session: AppSession) async {
        let wasWorking = isWorking
        isWorking = false
        await refreshAll(session: session)
        isWorking = wasWorking && isWorking
    }

    private struct MetadataRecord: Decodable {
        let lastPulledAt: String
        let lastPushedAt: String?
    }

    private func readMetadata(cacheRoot: String, documentId: String) -> MetadataRecord? {
        let url = URL(fileURLWithPath: cacheRoot)
            .appendingPathComponent("docs")
            .appendingPathComponent(safePathSegment(documentId))
            .appendingPathComponent("meta.json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(MetadataRecord.self, from: data)
    }
}

func humanizeBytes(_ bytes: UInt64) -> String {
    let kb: UInt64 = 1024
    let mb = kb * 1024
    let gb = mb * 1024
    if bytes >= gb {
        return String(format: "%.2f GB", Double(bytes) / Double(gb))
    }
    if bytes >= mb {
        return String(format: "%.2f MB", Double(bytes) / Double(mb))
    }
    if bytes >= kb {
        return String(format: "%.2f KB", Double(bytes) / Double(kb))
    }
    return "\(bytes) B"
}

func formatDate(_ date: Date?) -> String {
    guard let date else { return "Not available" }
    return date.formatted(date: .abbreviated, time: .standard)
}

func parseDate(_ raw: String?) -> Date? {
    guard let raw else { return nil }
    if let date = ISO8601DateFormatter().date(from: raw) {
        return date
    }
    if let seconds = TimeInterval(raw) {
        return Date(timeIntervalSince1970: seconds)
    }
    return nil
}

func safePathSegment(_ value: String) -> String {
    String(value.map { char -> Character in
        switch char {
        case "/", "\\", ":", "*", "?", "\"", "<", ">", "|": return "_"
        default: return char
        }
    })
}

private func hardwareModel() -> String {
    var size = 0
    sysctlbyname("hw.model", nil, &size, nil, 0)
    var model = [CChar](repeating: 0, count: size)
    sysctlbyname("hw.model", &model, &size, nil, 0)
    return String(cString: model)
}

private func cpuArchitecture() -> String {
    #if arch(arm64)
    return "arm64"
    #elseif arch(x86_64)
    return "x86_64"
    #else
    return "unknown"
    #endif
}

private func thermalState(_ state: ProcessInfo.ThermalState) -> String {
    switch state {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
}

private func notificationAuthorization() async -> String {
    await withCheckedContinuation { continuation in
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .notDetermined: continuation.resume(returning: "not determined")
            case .denied: continuation.resume(returning: "denied")
            case .authorized: continuation.resume(returning: "authorized")
            case .provisional: continuation.resume(returning: "provisional")
            case .ephemeral: continuation.resume(returning: "ephemeral")
            @unknown default: continuation.resume(returning: "unknown")
            }
        }
    }
}

extension DiagnosticsViewModel {
    nonisolated private static func networkSnapshot() async -> NetworkState {
        await withCheckedContinuation { continuation in
            let monitor = NWPathMonitor()
            let queue = DispatchQueue(label: "com.gongahkia.MelonPan.DiagnosticsNetwork")
            let gate = ContinuationResumeGate()
            @Sendable func finish(_ state: NetworkState) {
                guard gate.claim() else { return }
                monitor.cancel()
                continuation.resume(returning: state)
            }
            monitor.pathUpdateHandler = { path in
                if path.status == .satisfied {
                    let via = path.usesInterfaceType(.wifi) ? "Wi-Fi" :
                        (path.usesInterfaceType(.wiredEthernet) ? "Ethernet" :
                            (path.usesInterfaceType(.cellular) ? "Cellular" : "available"))
                    finish(.reachable(via: via, lastSuccess: nil, rateLimitHits: 0))
                } else if path.status == .requiresConnection {
                    finish(.unreachable(reason: "requires connection"))
                } else {
                    finish(.unreachable(reason: "not reachable"))
                }
            }
            monitor.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 1) {
                finish(.unreachable(reason: "no network sample"))
            }
        }
    }
}

private final class ContinuationResumeGate: @unchecked Sendable {
    private let lock = NSLock()
    private var resumed = false

    func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !resumed else { return false }
        resumed = true
        return true
    }
}

struct SectionContainer<Content: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: systemImage)
                .font(.headline)
            VStack(alignment: .leading, spacing: 6) {
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct DiagnosticsActionBanner: View {
    let text: String
    let kind: DiagnosticsViewModel.ActionBanner.Kind

    var body: some View {
        Label(text, systemImage: image)
            .font(.callout)
            .foregroundStyle(color)
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.12))
    }

    private var image: String {
        switch kind {
        case .ok: return "checkmark.circle"
        case .warn: return "exclamationmark.triangle"
        case .error: return "xmark.octagon"
        }
    }

    private var color: Color {
        switch kind {
        case .ok: return .green
        case .warn: return .orange
        case .error: return .red
        }
    }
}
