import XCTest
@testable import MelonPan

@MainActor
final class SettingsTests: XCTestCase {
    func testDefaultsRoundTrip() throws {
        let original = AppSettings.default
        let json = AppSettingsSerializer.encode(original)
        let decoded = try AppSettingsSerializer.decode(json)
        XCTAssertEqual(decoded, original)
    }

    func testDefaultUIFontValues() {
        XCTAssertEqual(AppSettings.default.mac.uiFontFamily, "")
        XCTAssertEqual(AppSettings.default.mac.uiFontSize, 13)
    }

    func testUIFontSettingsRoundTrip() throws {
        var original = AppSettings.default
        original.mac.uiFontFamily = "Avenir"
        original.mac.uiFontSize = 16

        let decoded = try AppSettingsSerializer.decode(AppSettingsSerializer.encode(original))

        XCTAssertEqual(decoded.mac.uiFontFamily, "Avenir")
        XCTAssertEqual(decoded.mac.uiFontSize, 16)
        XCTAssertEqual(decoded, original)
    }

    func testBaseFixtureRoundTripsSharedBlockByteIdentical() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent("base-settings.json")
        let json = try String(contentsOf: url, encoding: .utf8)
        let decoded = try AppSettingsSerializer.decode(json)
        XCTAssertEqual(decoded.mac.schemaVersion, 1)
        XCTAssertEqual(decoded.paletteKeybind, "Ctrl+P")
        XCTAssertEqual(AppSettingsSerializer.encodeSharedBlockOnly(decoded), json)
    }

    func testCorruptFileFallsBack() throws {
        let root = tempRoot("corrupt")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try "{not-json".write(
            to: root.appendingPathComponent("settings.json"),
            atomically: true,
            encoding: .utf8
        )

        let vm = SettingsViewModel()
        vm.load(cacheRoot: root.path)

        XCTAssertTrue(vm.isCorruptFallback)
        XCTAssertEqual(vm.settings, .default)
        try? FileManager.default.removeItem(at: root)
    }

    func testSchemaV0ToV1Migration() throws {
        let v0 = #"{"paletteKeybind":"Ctrl+P","mac":{}}"#
        let migrated = try AppSettingsSerializer.decode(v0)
        XCTAssertEqual(migrated.mac.schemaVersion, 1)
        XCTAssertEqual(migrated.mac.editorFontSize, 14)
        XCTAssertEqual(migrated.mac.uiFontFamily, "")
        XCTAssertEqual(migrated.mac.uiFontSize, 13)
    }

    func testOlderMacSettingsJSONMigratesUIFontFields() throws {
        let oldJSON = """
        {
          "paletteKeybind": "Ctrl+P",
          "mac": {
            "schemaVersion": 1,
            "editorFontSize": 17
          }
        }
        """

        let migrated = try AppSettingsSerializer.decode(oldJSON)

        XCTAssertEqual(migrated.mac.editorFontSize, 17)
        XCTAssertEqual(migrated.mac.uiFontFamily, "")
        XCTAssertEqual(migrated.mac.uiFontSize, 13)
    }

    func testMissingUIFontFallsBackWithoutDroppingPreference() {
        var settings = AppSettings.default
        settings.mac.uiFontFamily = "Definitely Missing Font Family"

        let resolved = AppUIFontResolver.resolvedFont(settings: settings)

        XCTAssertEqual(resolved.requestedFamily, "Definitely Missing Font Family")
        XCTAssertNil(resolved.resolvedFamily)
    }

    func testThemeRegistryKeepsExistingAndAddsCuratedPresets() {
        let expectedNames = [
            "Default",
            "Default Dark",
            "Solarized Light",
            "Solarized Dark",
            "Dracula",
            "Gruvbox Dark",
            "Nord",
            "Catppuccin Latte",
            "Catppuccin Mocha",
            "Tokyo Night",
            "One Dark",
            "GitHub Light",
            "GitHub Dark",
            "Ayu Light",
            "Ayu Mirage",
            "Rose Pine",
            "Everforest Dark",
            "High Contrast Light",
            "High Contrast Dark"
        ]

        for name in expectedNames {
            XCTAssertTrue(AppThemePresetRegistry.allNames.contains(name), "\(name) should be registered")
            XCTAssertEqual(AppThemePalette(name: name).name, name)
        }
    }

    func testSettingsPaneMapsSectionAliases() {
        let cases: [(String?, MelonPanSettingsPane)] = [
            (nil, .general),
            ("general", .general),
            ("account", .accounts),
            ("accounts", .accounts),
            ("oauth", .accounts),
            ("editor", .editor),
            ("appearance", .editor),
            ("workspace", .workspace),
            ("drive", .workspace),
            ("sidebar", .workspace),
            ("visibility", .workspace),
            ("sync", .sync),
            ("keys", .keys),
            ("keybindings", .keys),
            ("shortcuts", .keys),
            ("privacy", .privacy),
            ("security", .privacy),
            ("encryption", .privacy),
            ("history", .history),
            ("updates", .updates),
            ("about", .updates),
            ("advanced", .advanced),
            ("diagnostics", .advanced),
            ("unknown", .general)
        ]

        for (section, pane) in cases {
            XCTAssertEqual(MelonPanSettingsPane(section: section), pane, "\(section ?? "nil")")
        }
    }

    func testEditorChromeSnapshotDerivesStatusState() {
        var snapshot = EditorChromeSnapshot(
            title: "Doc",
            hasPendingOps: true,
            isOffline: true,
            vimEnabled: true,
            vimMode: .normal,
            editorMode: .suggesting,
            warningCount: 2
        )

        XCTAssertTrue(snapshot.canSave)
        XCTAssertEqual(snapshot.syncTitle, "Queued")
        XCTAssertEqual(snapshot.vimModeTitle, "NORMAL")
        XCTAssertEqual(
            snapshot.statusSegments,
            ["Queued", "Offline", "Vim NORMAL", "Suggesting", "2 warnings"]
        )

        snapshot.isSaving = true
        XCTAssertFalse(snapshot.canSave)
        XCTAssertEqual(snapshot.syncTitle, "Saving")

        snapshot.isSaving = false
        snapshot.hasPendingOps = false
        snapshot.suggestionCount = 1
        XCTAssertFalse(snapshot.canSave)
        XCTAssertEqual(snapshot.syncTitle, "Suggestions")
        XCTAssertTrue(snapshot.statusSegments.contains("1 suggestion"))
    }

    private func tempRoot(_ name: String) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("melon-pan-settings-\(name)-\(UUID().uuidString)")
    }
}
