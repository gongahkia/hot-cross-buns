import XCTest
@testable import MelonPan

@MainActor
final class ImportPaneTests: XCTestCase {
    func testEnqueueFiltersNonMarkdownExtensions() throws {
        let root = try makeTempDir()
        let markdown = root.appendingPathComponent("a.md")
        let text = root.appendingPathComponent("b.txt")
        FileManager.default.createFile(atPath: markdown.path, contents: Data("a".utf8))
        FileManager.default.createFile(atPath: text.path, contents: Data("b".utf8))

        let viewModel = ImportViewModel()
        viewModel.enqueue(urls: [markdown, text])

        XCTAssertEqual(viewModel.jobs.map(\.sourcePath), [markdown])
        try? FileManager.default.removeItem(at: root)
    }

    func testRunAllTransitionsPendingToSucceeded() async throws {
        let root = try makeTempDir()
        let markdown = root.appendingPathComponent("a.md")
        FileManager.default.createFile(atPath: markdown.path, contents: Data("a".utf8))

        let session = AppSession()
        session.cacheRoot = root.path
        session.credentialsPath = root.appendingPathComponent("credentials.json").path

        let viewModel = ImportViewModel()
        viewModel.session = session
        viewModel.bridge = MockImportBridge()
        viewModel.enqueue(urls: [markdown])
        await viewModel.runAll()

        guard case .succeeded(let draftId, let pushedDocumentId) = viewModel.jobs.first?.status else {
            XCTFail("Expected succeeded import")
            return
        }
        XCTAssertTrue(draftId.hasPrefix("draft-"))
        XCTAssertNil(pushedDocumentId)
        try? FileManager.default.removeItem(at: root)
    }

    func testImportOptionsDefaultsToSkipCollision() {
        XCTAssertEqual(ImportOptions().collision, .skip)
    }

    func testImportOptionsRoundTripsPushFlag() throws {
        let options = ImportOptions(pushToDrive: true, collision: .rename, maxFolderFiles: 12)
        let data = try JSONEncoder().encode(options)
        let decoded = try JSONDecoder().decode(ImportOptions.self, from: data)
        XCTAssertEqual(decoded, options)
    }

    private func makeTempDir() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("melon-pan-import-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}

private struct MockImportBridge: ImportRuntimeBridging {
    func importMarkdownFile(
        cacheRoot: String,
        sourcePath: String,
        targetDraftId: String,
        options: ImportOptions,
        accessToken: String?
    ) throws -> RuntimeBridge.ImportResult {
        RuntimeBridge.ImportResult(
            sourcePath: sourcePath,
            draftId: targetDraftId,
            pushedDocumentId: nil,
            status: "succeeded",
            error: nil,
            warnings: []
        )
    }

    func ensureFreshAccessToken(
        credentialsPath: String,
        account: String,
        leewaySeconds: UInt64
    ) throws -> String {
        "token"
    }
}
