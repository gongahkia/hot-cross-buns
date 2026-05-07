import AppKit
import SwiftUI
import XCTest
@testable import MelonPan

@MainActor
final class DiagnosticsTests: XCTestCase {
    func testRefreshAllWorksWithoutSignedInAccount() async {
        let session = AppSession()
        session.cacheRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("melon-pan-diagnostics-test-\(UUID().uuidString)")
            .path
        session.credentialsPath = FileManager.default.temporaryDirectory
            .appendingPathComponent("credentials.json")
            .path
        session.activeAccount = nil

        let viewModel = DiagnosticsViewModel()
        viewModel.bridge = MockRuntimeBridge()
        await viewModel.refreshAll(session: session)

        if case .signedOut = viewModel.account {
        } else {
            XCTFail("Expected signedOut account")
        }
        XCTAssertEqual(viewModel.cache.docCount, 2)
        XCTAssertEqual(viewModel.cache.snapshotCount, 3)
    }

    func testDiagnosticReportPlainTextDoesNotEmitTokens() async {
        let session = AppSession()
        session.cacheRoot = "/tmp/melon-pan"
        let viewModel = DiagnosticsViewModel()
        viewModel.account = .signedIn(
            account: "user@example.com",
            scopes: ["drive.file"],
            expiresAtUnix: 1_800_000_000
        )
        viewModel.cache = .init(
            root: "/tmp/melon-pan",
            totalBytes: 128,
            docCount: 1,
            snapshotCount: 1,
            driveTreeMtime: nil
        )
        viewModel.sync = [
            .init(
                id: "doc-1",
                title: "Doc",
                lastPull: nil,
                lastPush: nil,
                inFlight: false,
                queuedMutations: 0,
                snapshotCount: 1,
                hasFailure: false
            )
        ]
        viewModel.audit = [
            .init(
                id: "doc-1",
                title: "Doc",
                mdHash: "h1",
                docsHash: "h2",
                mdFromDocsHash: "h1",
                docsFromMdHash: "h2",
                error: nil
            )
        ]
        viewModel.build = .init(
            appVersion: "0.1.0",
            buildNumber: "1",
            commitSHA: "unknown",
            buildTimestamp: "unknown",
            runtimeSharedVersion: "0.1.0",
            coreVersion: "0.1.0"
        )
        viewModel.environment = .init(
            osVersion: "macOS",
            hardwareModel: "Mac",
            cpuArch: "arm64",
            locale: "en_US",
            screenScale: 2,
            thermalState: "nominal",
            lowPowerMode: false,
            notificationAuthorization: "authorized"
        )

        let report = await DiagnosticReport.capture(viewModel: viewModel, session: session)
        let text = report.toPlainText()

        XCTAssertTrue(text.contains("user@example.com"))
        XCTAssertFalse(text.localizedCaseInsensitiveContains("access_token"))
        XCTAssertFalse(text.localizedCaseInsensitiveContains("refresh_token"))
    }

    func testSectionsInstantiateForPrimaryStates() {
        let viewModel = DiagnosticsViewModel()
        _ = NSHostingView(rootView: AccountSection(viewModel: viewModel))
        _ = NSHostingView(rootView: CacheSection(viewModel: viewModel))
        _ = NSHostingView(rootView: SyncSection(viewModel: viewModel))
        _ = NSHostingView(rootView: AuditSection(viewModel: viewModel))
        _ = NSHostingView(rootView: KeychainSection(viewModel: viewModel))
        _ = NSHostingView(rootView: BuildSection(viewModel: viewModel))
        _ = NSHostingView(rootView: EnvironmentSection(viewModel: viewModel))
        _ = NSHostingView(rootView: NetworkSection(viewModel: viewModel))
    }
}

private struct MockRuntimeBridge: RuntimeBridging {
    func diagnosticSnapshot(cacheRoot: String) throws -> RuntimeBridge.DiagnosticSnapshot {
        RuntimeBridge.DiagnosticSnapshot(
            cacheRoot: cacheRoot,
            totalSnapshotBytes: 512,
            docCount: 2,
            snapshotCount: 3,
            driveTreeMtimeUnix: nil,
            runtimeSharedVersion: "0.1.0",
            coreVersion: "0.1.0"
        )
    }

    func auditStatus(cacheRoot: String, documentId: String) throws -> RuntimeBridge.AuditStatusReport {
        RuntimeBridge.AuditStatusReport(
            mdHash: "h1",
            docsHash: "h2",
            mdFromDocsHash: "h1",
            docsFromMdHash: "h2"
        )
    }

    func keychainProbe() throws -> RuntimeBridge.KeychainProbeReport {
        RuntimeBridge.KeychainProbeReport(
            state: "ok",
            itemCount: 1,
            service: "com.gongahkia.MelonPan"
        )
    }

    func tokenMetadata(account: String) -> RuntimeBridge.TokenMetadata? {
        RuntimeBridge.TokenMetadata(
            scope: "drive.file",
            expiresAtUnix: 1_800_000_000,
            hasRefreshToken: true
        )
    }

    func runtimeVersions() throws -> RuntimeBridge.RuntimeVersions {
        RuntimeBridge.RuntimeVersions(
            coreVersion: "0.1.0",
            runtimeSharedVersion: "0.1.0",
            commitSHA: "unknown",
            buildTimestamp: "unknown"
        )
    }

    func ensureFreshAccessToken(credentialsPath: String, account: String, leewaySeconds: UInt64) throws -> String {
        "redacted-test-token"
    }

    func forceFullResync(cacheRoot: String, accessToken: String) throws {}

    func clearCachedDriveData(cacheRoot: String) throws {}

    func docPendingSummary(cacheRoot: String, documentId: String) throws -> RuntimeBridge.DocPendingSummary {
        RuntimeBridge.DocPendingSummary(
            documentId: documentId,
            pendingMutations: [],
            prePushSnapshots: []
        )
    }
}
