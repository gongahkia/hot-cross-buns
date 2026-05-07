import XCTest
@testable import MelonPan

@MainActor
final class AppStatusCenterTests: XCTestCase {
    func testGoogleApiDisabledErrorsUseSetupCopy() {
        let raw = """
        ffi: refresh_drive_tree failed: drive HTTP error: HTTP 403: {
          "error": {
            "code": 403,
            "message": "Google Drive API has not been used in project 892818680813 before or it is disabled.",
            "status": "PERMISSION_DENIED",
            "details": [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                "reason": "SERVICE_DISABLED",
                "domain": "googleapis.com",
                "metadata": {
                  "service": "drive.googleapis.com"
                }
              }
            ]
          }
        }
        """

        XCTAssertEqual(
            UserFacingError.message(from: raw),
            "Google Drive API is disabled for this OAuth project. Enable it in Google Cloud Console, wait a few minutes, then refresh again."
        )
    }

    func testDedupeReplacesExistingBanner() {
        let center = AppStatusCenter()
        center.post(StatusBanner(
            dedupeKey: "sync",
            kind: .info,
            title: "Syncing",
            detail: "first",
            postedAt: Date(timeIntervalSince1970: 1)
        ))
        center.post(StatusBanner(
            dedupeKey: "sync",
            kind: .success,
            title: "Saved",
            detail: "second",
            postedAt: Date(timeIntervalSince1970: 2)
        ))

        XCTAssertEqual(center.banners.count, 1)
        XCTAssertEqual(center.banners.first?.dedupeKey, "sync")
        XCTAssertEqual(center.banners.first?.detail, "second")
        XCTAssertEqual(center.banners.first?.postedAt, Date(timeIntervalSince1970: 2))
    }

    func testCapEvictsOldestInfoAndTracksOverflow() {
        let center = AppStatusCenter()
        center.post(StatusBanner(
            dedupeKey: "info-old",
            kind: .info,
            title: "Old",
            postedAt: Date(timeIntervalSince1970: 1)
        ))
        center.post(StatusBanner(
            dedupeKey: "error",
            kind: .error,
            title: "Error",
            postedAt: Date(timeIntervalSince1970: 2)
        ))
        center.post(StatusBanner(
            dedupeKey: "warning",
            kind: .warning,
            title: "Warning",
            postedAt: Date(timeIntervalSince1970: 3)
        ))
        center.post(StatusBanner(
            dedupeKey: "success",
            kind: .success,
            title: "Success",
            postedAt: Date(timeIntervalSince1970: 4)
        ))
        center.post(StatusBanner(
            dedupeKey: "info-new",
            kind: .info,
            title: "New",
            postedAt: Date(timeIntervalSince1970: 5)
        ))

        XCTAssertEqual(center.banners.count, 4)
        XCTAssertEqual(center.overflowCount, 1)
        XCTAssertFalse(center.banners.contains { $0.dedupeKey == "info-old" })
        XCTAssertTrue(center.banners.contains { $0.dedupeKey == "error" })
    }

    func testInfoAutoDismisses() async throws {
        let center = AppStatusCenter()
        center.post(StatusBanner(
            dedupeKey: "info",
            kind: .info,
            title: "Info",
            autoDismissAfter: 0.05
        ))

        XCTAssertEqual(center.banners.count, 1)
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertTrue(center.banners.isEmpty)
    }
}
