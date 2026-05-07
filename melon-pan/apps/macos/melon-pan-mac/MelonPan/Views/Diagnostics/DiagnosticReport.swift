import Foundation

struct DiagnosticReport: Codable {
    let capturedAt: Date
    let appVersion: String
    let buildNumber: String
    let commitSHA: String
    let osVersion: String
    let cacheRoot: String
    let cacheBytes: UInt64
    let docCount: Int
    let snapshotCount: Int
    let account: AccountSnapshot?
    let docs: [DocSnapshot]
    let keychain: String
    let network: String
    let environment: EnvironmentSnapshot

    struct AccountSnapshot: Codable {
        let account: String
        let scopes: [String]
        let expiresAtUnix: UInt64?
    }

    struct DocSnapshot: Codable {
        let documentId: String
        let title: String
        let queuedMutations: Int
        let snapshotCount: Int
        let auditDriftMdDocs: Bool
        let auditDriftDocsMd: Bool
    }

    struct EnvironmentSnapshot: Codable {
        let hardwareModel: String
        let cpuArch: String
        let locale: String
        let screenScale: Double
        let thermalState: String
        let lowPowerMode: Bool
    }

    @MainActor
    static func capture(viewModel: DiagnosticsViewModel, session: AppSession) async -> DiagnosticReport {
        let accountSnapshot: AccountSnapshot?
        switch viewModel.account {
        case .signedIn(let account, let scopes, let expiresAtUnix):
            accountSnapshot = AccountSnapshot(
                account: account,
                scopes: scopes,
                expiresAtUnix: expiresAtUnix
            )
        default:
            accountSnapshot = nil
        }

        let docs = viewModel.sync.map { sync in
            let audit = viewModel.audit.first(where: { $0.id == sync.id })
            return DocSnapshot(
                documentId: sync.id,
                title: sync.title,
                queuedMutations: sync.queuedMutations,
                snapshotCount: sync.snapshotCount,
                auditDriftMdDocs: audit.map { !$0.mdMatchesDocs } ?? false,
                auditDriftDocsMd: audit.map { !$0.docsMatchesMd } ?? false
            )
        }

        return DiagnosticReport(
            capturedAt: Date(),
            appVersion: viewModel.build.appVersion,
            buildNumber: viewModel.build.buildNumber,
            commitSHA: viewModel.build.commitSHA,
            osVersion: viewModel.environment.osVersion,
            cacheRoot: session.cacheRoot,
            cacheBytes: viewModel.cache.totalBytes,
            docCount: viewModel.cache.docCount,
            snapshotCount: viewModel.cache.snapshotCount,
            account: accountSnapshot,
            docs: docs,
            keychain: keychainText(viewModel.keychain),
            network: networkText(viewModel.network),
            environment: EnvironmentSnapshot(
                hardwareModel: viewModel.environment.hardwareModel,
                cpuArch: viewModel.environment.cpuArch,
                locale: viewModel.environment.locale,
                screenScale: viewModel.environment.screenScale,
                thermalState: viewModel.environment.thermalState,
                lowPowerMode: viewModel.environment.lowPowerMode
            )
        )
    }

    func toPlainText() -> String {
        var lines: [String] = [
            "capturedAt: \(ISO8601DateFormatter().string(from: capturedAt))",
            "appVersion: \(appVersion)",
            "buildNumber: \(buildNumber)",
            "commitSHA: \(commitSHA)",
            "osVersion: \(osVersion)",
            "cacheRoot: \(cacheRoot)",
            "cacheBytes: \(cacheBytes)",
            "docCount: \(docCount)",
            "snapshotCount: \(snapshotCount)",
            "keychain: \(keychain)",
            "network: \(network)",
            "hardwareModel: \(environment.hardwareModel)",
            "cpuArch: \(environment.cpuArch)",
            "locale: \(environment.locale)",
            "screenScale: \(environment.screenScale)",
            "thermalState: \(environment.thermalState)",
            "lowPowerMode: \(environment.lowPowerMode)"
        ]
        if let account {
            lines.append("account: \(account.account)")
            lines.append("scopes: \(account.scopes.joined(separator: " "))")
            lines.append("expiresAtUnix: \(account.expiresAtUnix.map(String.init) ?? "none")")
        } else {
            lines.append("account: signed out")
        }
        for doc in docs.sorted(by: { $0.documentId < $1.documentId }) {
            lines.append("doc.\(doc.documentId).title: \(doc.title)")
            lines.append("doc.\(doc.documentId).queuedMutations: \(doc.queuedMutations)")
            lines.append("doc.\(doc.documentId).snapshotCount: \(doc.snapshotCount)")
            lines.append("doc.\(doc.documentId).auditDriftMdDocs: \(doc.auditDriftMdDocs)")
            lines.append("doc.\(doc.documentId).auditDriftDocsMd: \(doc.auditDriftDocsMd)")
        }
        return lines.joined(separator: "\n") + "\n"
    }

    func toJSONData() throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(self)
    }
}

private func keychainText(_ state: DiagnosticsViewModel.KeychainState) -> String {
    switch state {
    case .loading: return "loading"
    case .ok(let itemCount, let service): return "ok (\(itemCount) items, \(service))"
    case .locked: return "locked"
    case .denied: return "denied"
    case .missing: return "missing"
    case .error(let detail): return "error: \(detail)"
    }
}

private func networkText(_ state: DiagnosticsViewModel.NetworkState) -> String {
    switch state {
    case .loading: return "loading"
    case .reachable(let via, _, let rateLimitHits): return "reachable via \(via), rateLimitHits=\(rateLimitHits)"
    case .unreachable(let reason): return "unreachable: \(reason)"
    }
}
