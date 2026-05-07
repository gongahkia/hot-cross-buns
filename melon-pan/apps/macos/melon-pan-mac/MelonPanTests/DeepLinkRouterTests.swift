import XCTest
@testable import MelonPan

@MainActor
final class DeepLinkRouterTests: XCTestCase {
    override func setUp() {
        super.setUp()
        DeepLinkRouter.resetRateLimiterForTesting()
        AppStatusCenter.shared.clearAll()
    }

    func testGoldenURLsParse() throws {
        let longId = String(repeating: "a", count: DeepLinkRouter.maxIdLength)
        let longQuery = String(repeating: "q", count: DeepLinkRouter.maxParamLength)
        let cases: [(String, DeepLink)] = [
            ("melonpan://document/doc-1", .openDocument(id: "doc-1", revision: nil)),
            ("melonpan://document/doc-1?revision=rev-1", .openDocument(id: "doc-1", revision: "rev-1")),
            ("melonpan://document/doc-1?revision=", .openDocument(id: "doc-1", revision: nil)),
            ("melonpan://drive/folder-1", .openDrive(folderId: "folder-1")),
            ("melonpan://drive", .openDrive(folderId: nil)),
            ("melonpan://pane/diagnostics", .switchPane(.diagnostics)),
            ("melonpan://palette", .openPalette(query: nil)),
            ("melonpan://palette?q=push", .openPalette(query: "push")),
            ("melonpan://command/push", .runCommand(id: "push")),
            ("melonpan://new?title=Draft&body=Body", .newDraft(title: "Draft", body: "Body")),
            ("melonpan://history", .openHistory),
            ("melonpan://settings/editor", .openSettings(section: "editor")),
            ("melonpan://onboarding", .openOnboarding),
            ("melonpan://open", .openApp),
            ("melonpan://home", .openApp),
            ("melonpan://document/\(longId)", .openDocument(id: longId, revision: nil)),
            ("melonpan://palette?q=\(longQuery)", .openPalette(query: longQuery)),
            ("MELONPAN://PANE/HOME", .switchPane(.home))
        ]

        for (raw, expected) in cases {
            try assertParse(raw, equals: expected)
        }
    }

    func testInvalidURLsFail() {
        let tooLongId = String(repeating: "a", count: DeepLinkRouter.maxIdLength + 1)
        let tooLongQuery = String(repeating: "q", count: DeepLinkRouter.maxParamLength + 1)
        let cases = [
            "melonpan://",
            "melonpan://document",
            "melonpan://pane/unknown",
            "melonpan://command/rm-rf",
            "melonpan://document/\(tooLongId)",
            "melonpan://palette?q=\(tooLongQuery)",
            "melonpan://document/a/b/c/d/e",
            "https://example.com/"
        ]

        for raw in cases {
            guard let url = URL(string: raw) else {
                XCTFail("Invalid test URL: \(raw)")
                continue
            }
            if case .success(let link) = DeepLinkRouter.parse(url) {
                XCTFail("Expected failure for \(raw), got \(link)")
            }
        }
    }

    func testBuilderRoundTrips() throws {
        let cases: [(URL, DeepLink)] = [
            (DeepLinkBuilder.documentURL(id: "doc-1", revision: "rev-1"), .openDocument(id: "doc-1", revision: "rev-1")),
            (DeepLinkBuilder.driveURL(folderId: "folder-1"), .openDrive(folderId: "folder-1")),
            (DeepLinkBuilder.driveURL(), .openDrive(folderId: nil)),
            (DeepLinkBuilder.paneURL(.history), .switchPane(.history)),
            (DeepLinkBuilder.paletteURL(query: "push"), .openPalette(query: "push")),
            (DeepLinkBuilder.paletteURL(), .openPalette(query: nil)),
            (DeepLinkBuilder.commandURL("push"), .runCommand(id: "push")),
            (DeepLinkBuilder.newDraftURL(title: "Draft", body: "Body"), .newDraft(title: "Draft", body: "Body")),
            (DeepLinkBuilder.settingsURL(section: "updates"), .openSettings(section: "updates")),
            (DeepLinkBuilder.settingsURL(), .openSettings(section: nil))
        ]

        for (url, expected) in cases {
            if case .success(let actual) = DeepLinkRouter.parse(url) {
                XCTAssertEqual(actual, expected, "\(url)")
            } else {
                XCTFail("Expected success for \(url)")
            }
        }
    }

    func testPercentEncodedDocumentIdRoundTrips() throws {
        let url = DeepLinkBuilder.documentURL(id: "a/b#c")
        try assertParse(url.absoluteString, equals: .openDocument(id: "a/b#c", revision: nil))
    }

    func testTokenBucketCapsBurst() {
        let bucket = TokenBucket(capacity: 8, refillPerSecond: 4, now: Date(timeIntervalSince1970: 10))
        let now = Date(timeIntervalSince1970: 10)
        let allowed = (0..<20).filter { _ in bucket.allow(now: now) }.count
        XCTAssertEqual(allowed, 8)
    }

    func testHandleSmokeRoutes() throws {
        let session = AppSession()

        DeepLinkRouter.handle(try XCTUnwrap(URL(string: "melonpan://pane/diagnostics")), session: session)
        XCTAssertEqual(session.activePane, .diagnostics)

        DeepLinkRouter.handle(try XCTUnwrap(URL(string: "melonpan://palette?q=push")), session: session)
        XCTAssertEqual(session.pendingPalettePrefill, "push")
        XCTAssertTrue(session.paletteVisible)

        DeepLinkRouter.handle(try XCTUnwrap(URL(string: "melonpan://new?title=Draft&body=Body")), session: session)
        XCTAssertEqual(session.activePane, .home)
        XCTAssertEqual(session.activeDocument?.title, "Draft")
        XCTAssertEqual(session.activeDocument?.plainText, "Body")
    }

    func testHandleBadURLSurfacesBanner() throws {
        let session = AppSession()
        DeepLinkRouter.handle(try XCTUnwrap(URL(string: "melonpan://command/rm-rf")), session: session)
        XCTAssertEqual(session.statusBanner, "Bad link: Unknown command.")
    }

    func testAsyncFetchNeedsBridgeSeam() throws {
        throw XCTSkip("needs bridge seam")
    }

    private func assertParse(_ raw: String, equals expected: DeepLink, file: StaticString = #filePath, line: UInt = #line) throws {
        let url = try XCTUnwrap(URL(string: raw), file: file, line: line)
        switch DeepLinkRouter.parse(url) {
        case .success(let actual):
            XCTAssertEqual(actual, expected, file: file, line: line)
        case .failure(let error):
            XCTFail("Expected success for \(raw), got \(error.message)", file: file, line: line)
        }
    }
}
