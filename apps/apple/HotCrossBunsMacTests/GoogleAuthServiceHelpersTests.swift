import AppKit
import GoogleSignIn
import XCTest
@testable import HotCrossBunsMac

@MainActor
final class GoogleAuthServiceHelpersTests: XCTestCase {
    func testMissingScopesReturnsOnlyRevokedScopes() {
        let missing = GoogleAuthService.missingScopes(
            requiredScopes: [GoogleScope.tasks, GoogleScope.calendar],
            grantedScopes: [GoogleScope.tasks]
        )

        XCTAssertEqual(missing, [GoogleScope.calendar])
    }

    func testBuildAccountRequiresEmailAndFallsBackDisplayName() throws {
        let account = try GoogleAuthService.buildAccount(
            userID: nil,
            email: "person@example.com",
            displayName: nil,
            grantedScopes: [GoogleScope.tasks]
        )

        XCTAssertEqual(account.id, "person@example.com")
        XCTAssertEqual(account.displayName, "person@example.com")
        XCTAssertEqual(account.grantedScopes, [GoogleScope.tasks])

        XCTAssertThrowsError(
            try GoogleAuthService.buildAccount(
                userID: "abc",
                email: nil,
                displayName: "No Email",
                grantedScopes: nil
            )
        ) { error in
            XCTAssertEqual(error as? GoogleAuthError, .missingProfile)
        }
    }

    func testResolvePresentationAnchorPrefersKeyThenMain() throws {
        let keyWindow = NSWindow()
        let mainWindow = NSWindow()

        XCTAssertTrue(
            try GoogleAuthService.resolvePresentationAnchor(
                keyWindow: keyWindow,
                mainWindow: mainWindow,
                windows: []
            ) === keyWindow
        )

        XCTAssertTrue(
            try GoogleAuthService.resolvePresentationAnchor(
                keyWindow: nil,
                mainWindow: mainWindow,
                windows: []
            ) === mainWindow
        )
    }

    func testResolvePresentationAnchorThrowsWhenNoWindowAvailable() {
        XCTAssertThrowsError(
            try GoogleAuthService.resolvePresentationAnchor(
                keyWindow: nil,
                mainWindow: nil,
                windows: []
            )
        ) { error in
            XCTAssertEqual(error as? GoogleAuthError, .noPresentationAnchor)
        }
    }

    func testRedactKeepsOnlyFirstTwoLocalPartCharacters() {
        XCTAssertEqual(GoogleAuthService.redact("person@example.com"), "pe***@example.com")
        XCTAssertEqual(GoogleAuthService.redact("x@y.z"), "x***@y.z")
        XCTAssertEqual(GoogleAuthService.redact("not-an-email"), "<redacted>")
    }

    func testErrorMetadataIncludesUnderlyingNSErrorChain() {
        let deepest = NSError(
            domain: "deep.domain",
            code: 42,
            userInfo: [NSLocalizedDescriptionKey: "very broken"]
        )
        let middle = NSError(
            domain: "middle.domain",
            code: 21,
            userInfo: [NSUnderlyingErrorKey: deepest]
        )
        let top = NSError(
            domain: "top.domain",
            code: 9,
            userInfo: [NSUnderlyingErrorKey: middle]
        )

        let metadata = GoogleAuthService.errorMetadata(top)
        XCTAssertEqual(metadata["domain"], "top.domain")
        XCTAssertEqual(metadata["code"], "9")
        XCTAssertEqual(metadata["underlying0.domain"], "middle.domain")
        XCTAssertEqual(metadata["underlying0.code"], "21")
        XCTAssertEqual(metadata["underlying1.domain"], "deep.domain")
        XCTAssertEqual(metadata["underlying1.code"], "42")
        XCTAssertEqual(metadata["underlying1.description"], "very broken")
    }

    func testIsUserCancellationDetectsGoogleCancelError() {
        let error = NSError(
            domain: kGIDSignInErrorDomain,
            code: GIDSignInError.canceled.rawValue
        )

        XCTAssertTrue(GoogleAuthService.isUserCancellation(error))
        XCTAssertFalse(GoogleAuthService.isUserCancellation(NSError(domain: "other", code: 1)))
    }
}
