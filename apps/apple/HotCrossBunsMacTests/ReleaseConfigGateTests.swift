import Foundation
import XCTest
@testable import HotCrossBunsMac

@MainActor
final class ReleaseConfigGateTests: XCTestCase {
    func testUpdaterControllerRequiresFeedURLAndPublicKey() throws {
        XCTAssertFalse(UpdaterController(bundle: try makeBundle(info: [:])).isConfigured)
        XCTAssertFalse(UpdaterController(bundle: try makeBundle(info: [
            "SUFeedURL": "https://example.com/appcast.xml"
        ])).isConfigured)
        XCTAssertFalse(UpdaterController(bundle: try makeBundle(info: [
            "SUPublicEDKey": "public-key"
        ])).isConfigured)
        XCTAssertTrue(UpdaterController(bundle: try makeBundle(info: [
            "SUFeedURL": "https://example.com/appcast.xml",
            "SUPublicEDKey": "public-key"
        ])).isConfigured)
    }

    func testGoogleAuthServiceRequiresConcreteClientID() throws {
        XCTAssertFalse(GoogleAuthService(bundle: try makeBundle(info: [:])).isConfigured)
        XCTAssertFalse(GoogleAuthService(bundle: try makeBundle(info: [
            "GIDClientID": ""
        ])).isConfigured)
        XCTAssertFalse(GoogleAuthService(bundle: try makeBundle(info: [
            "GIDClientID": "your-macos-oauth-client-id.apps.googleusercontent.com"
        ])).isConfigured)
        XCTAssertFalse(GoogleAuthService(bundle: try makeBundle(info: [
            "GIDClientID": "$(GOOGLE_MACOS_CLIENT_ID)"
        ])).isConfigured)
        XCTAssertTrue(GoogleAuthService(bundle: try makeBundle(info: [
            "GIDClientID": "1234567890-abcdef.apps.googleusercontent.com"
        ])).isConfigured)
    }

    private func makeBundle(info: [String: Any]) throws -> Bundle {
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("bundle")
        let contentsURL = rootURL.appendingPathComponent("Contents", isDirectory: true)
        try FileManager.default.createDirectory(at: contentsURL, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: rootURL)
        }

        var plist = info
        plist["CFBundleIdentifier"] = plist["CFBundleIdentifier"] ?? "com.gongahkia.tests.\(UUID().uuidString)"
        plist["CFBundleName"] = plist["CFBundleName"] ?? "Fixture"
        plist["CFBundlePackageType"] = plist["CFBundlePackageType"] ?? "BNDL"
        plist["CFBundleVersion"] = plist["CFBundleVersion"] ?? "1"
        plist["CFBundleShortVersionString"] = plist["CFBundleShortVersionString"] ?? "1.0"

        let infoURL = contentsURL.appendingPathComponent("Info.plist")
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: infoURL)

        guard let bundle = Bundle(url: rootURL) else {
            XCTFail("Failed to create temporary fixture bundle at \(rootURL.path)")
            throw FixtureBundleError.failedToLoadBundle
        }
        return bundle
    }
}

private enum FixtureBundleError: Error {
    case failedToLoadBundle
}
