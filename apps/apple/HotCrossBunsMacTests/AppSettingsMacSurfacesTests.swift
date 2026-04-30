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
}
