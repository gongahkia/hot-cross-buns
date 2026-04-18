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
    }

    func testEncodedSettingsRoundTripPreservesMacSurfaceFlags() throws {
        let settings = AppSettings(
            syncMode: .manual,
            selectedCalendarIDs: ["primary"],
            selectedTaskListIDs: ["tasks"],
            enableLocalNotifications: true,
            showMenuBarExtra: false,
            showDetailedMenuBar: true,
            showDockBadge: false
        )

        let data = try JSONEncoder().encode(settings)
        let decoded = try JSONDecoder().decode(AppSettings.self, from: data)

        XCTAssertFalse(decoded.showMenuBarExtra)
        XCTAssertTrue(decoded.showDetailedMenuBar)
        XCTAssertFalse(decoded.showDockBadge)
    }
}
