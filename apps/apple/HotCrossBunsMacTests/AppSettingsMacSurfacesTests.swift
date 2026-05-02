import Carbon.HIToolbox
import XCTest
@testable import HotCrossBunsMac

final class AppSettingsMacSurfacesTests: XCTestCase {
    func testNewFlagsDefaultToTrueOnLegacyCache() throws {
        let data = Data(
            """
            {
              "syncMode": "balanced",
              "selectedCalendarIDs": [],
              "selectedTaskListIDs": [],
              "enableLocalNotifications": false
            }
            """.utf8
        )

        let settings = try JSONDecoder().decode(AppSettings.self, from: data)

        XCTAssertTrue(settings.showMenuBarExtra, "legacy caches should opt into the menu bar extra by default")
        XCTAssertFalse(settings.showDetailedMenuBar, "legacy caches should default to compact menu bar panel")
        XCTAssertTrue(settings.showDockBadge, "legacy caches should opt into the dock badge by default")
        XCTAssertTrue(settings.restoreWindowStateEnabled, "legacy caches should restore prior window sessions by default")
        XCTAssertEqual(settings.globalHotkeyBinding, .defaultQuickAdd)
    }

    func testEncodedSettingsRoundTripPreservesMacSurfaceFlags() throws {
        let settings = AppSettings(
            syncMode: .manual,
            selectedCalendarIDs: ["primary"],
            selectedTaskListIDs: ["tasks"],
            enableLocalNotifications: true,
            showMenuBarExtra: false,
            showDetailedMenuBar: true,
            showDockBadge: false,
            restoreWindowStateEnabled: false,
            globalHotkeyBinding: GlobalHotkeyBinding(
                keyCode: UInt32(kVK_ANSI_K),
                key: .char("k"),
                modifiers: [.command, .shift]
            )
        )

        let data = try JSONEncoder().encode(settings)
        let decoded = try JSONDecoder().decode(AppSettings.self, from: data)

        XCTAssertFalse(decoded.showMenuBarExtra)
        XCTAssertTrue(decoded.showDetailedMenuBar)
        XCTAssertFalse(decoded.showDockBadge)
        XCTAssertFalse(decoded.restoreWindowStateEnabled)
        XCTAssertEqual(decoded.globalHotkeyBinding.displayLabel, "⇧⌘K")
    }

    func testDisconnectImpactWarnsWithoutClaimingGoogleDeletion() {
        let summary = DisconnectImpactSummary(
            accountName: "Ada Lovelace",
            cacheFootprint: "42 KB",
            pendingMutationCount: 2,
            conflictedMutationCount: 1,
            quarantinedMutationCount: 1,
            invalidPayloadMutationCount: 1
        )

        let message = summary.confirmationMessage

        XCTAssertTrue(message.contains("Ada Lovelace"))
        XCTAssertTrue(message.contains("removes the saved Google session from Keychain"))
        XCTAssertTrue(message.contains("Google Tasks and Calendar data in your Google account will not be deleted"))
        XCTAssertTrue(message.contains("Local cache retained on this Mac: 42 KB"))
        XCTAssertTrue(message.contains("Pending sync work: 2 queued local writes"))
        XCTAssertTrue(message.contains("Needs attention: 1 conflict, 1 quarantined, 1 invalid"))
        XCTAssertTrue(message.contains("cannot reach Google while disconnected"))
    }

    func testDisconnectImpactUsesSingularQueuedWriteCopy() {
        let summary = DisconnectImpactSummary(
            accountName: "this Google account",
            cacheFootprint: "No local cache file found",
            pendingMutationCount: 1,
            conflictedMutationCount: 0,
            quarantinedMutationCount: 0,
            invalidPayloadMutationCount: 0
        )

        XCTAssertTrue(summary.confirmationMessage.contains("Pending sync work: 1 queued local write"))
        XCTAssertFalse(summary.confirmationMessage.contains("Needs attention:"))
    }
}
