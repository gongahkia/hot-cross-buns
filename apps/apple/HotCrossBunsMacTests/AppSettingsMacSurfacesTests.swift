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
        XCTAssertEqual(settings.menuBarIcon, .buns, "legacy caches should keep the original menu bar icon")
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
            menuBarIcon: .sparkles,
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
        XCTAssertEqual(decoded.menuBarIcon, .sparkles)
        XCTAssertFalse(decoded.showDockBadge)
        XCTAssertFalse(decoded.restoreWindowStateEnabled)
        XCTAssertEqual(decoded.globalHotkeyBinding.displayLabel, "⇧⌘K")
    }

    func testMenuBarIconCatalogExposesUpToFiftyChoices() {
        XCTAssertEqual(AppSettings.MenuBarIcon.allCases.count, 50)
    }

    func testBackgroundOpacityPresetMapping() {
        XCTAssertEqual(BackgroundOpacityPreset.subtle.opacity, 0.45)
        XCTAssertEqual(BackgroundOpacityPreset.readable.opacity, 0.70)
        XCTAssertEqual(BackgroundOpacityPreset.strong.opacity, 0.90)
        XCTAssertEqual(BackgroundOpacityPreset(opacity: 0.45), .subtle)
        XCTAssertEqual(BackgroundOpacityPreset(opacity: 0.70), .readable)
        XCTAssertEqual(BackgroundOpacityPreset(opacity: 0.90), .strong)
        XCTAssertNil(BackgroundOpacityPreset(opacity: 0.55))
    }

    @MainActor
    func testShortcutConflictStateNamesConflictingCommands() {
        let proposed = HCBShortcutCommand.refresh.defaultBinding
        let conflicts = hcbConflictingCommands(
            proposed: proposed,
            for: .newTask,
            overrides: [:]
        )
        let state = HCBShortcutConflictState(
            proposedBinding: proposed,
            targetCommand: .newTask,
            conflictingCommands: conflicts
        )

        XCTAssertEqual(conflicts, [.refresh])
        XCTAssertTrue(state.message.contains("Refresh Sync"))
        XCTAssertTrue(state.message.contains(proposed.displayLabel))
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

    func testAccountDisconnectImpactResolverUsesInactiveWorkspaceCounts() {
        let active = GoogleAccount.preview
        let work = GoogleAccount(
            id: "work-account",
            email: "work@example.com",
            displayName: "Work",
            grantedScopes: [GoogleScope.tasks],
            authProvider: .customDesktopOAuth
        )
        let activeMutation = pendingMutation(id: "00000000-0000-0000-0000-000000000001", accountID: active.id)
        let workConflict = pendingMutation(
            id: "00000000-0000-0000-0000-000000000002",
            accountID: work.id,
            quarantinedAt: Date(timeIntervalSince1970: 10),
            conflictedAt: Date(timeIntervalSince1970: 10)
        )
        let workInvalid = pendingMutation(
            id: "00000000-0000-0000-0000-000000000003",
            accountID: work.id,
            lastErrorSummary: "Invalid payload - rejected by Google",
            quarantinedAt: Date(timeIntervalSince1970: 20)
        )
        let resolver = AccountDisconnectImpactResolver(
            activeAccountID: active.id,
            activePendingMutations: [activeMutation],
            accountWorkspaces: [
                AccountWorkspaceSnapshot(
                    accountID: work.id,
                    taskLists: [],
                    tasks: [],
                    calendars: [],
                    events: [],
                    settings: .default,
                    syncCheckpoints: [],
                    pendingMutations: [workConflict, workInvalid]
                )
            ]
        )

        let activeSummary = resolver.summary(for: active.id, accountName: "Personal", cacheFootprint: "1 KB")
        let inactiveSummary = resolver.summary(for: work.id, accountName: "Work", cacheFootprint: "1 KB")

        XCTAssertEqual(activeSummary.pendingMutationCount, 1)
        XCTAssertEqual(activeSummary.conflictedMutationCount, 0)
        XCTAssertEqual(inactiveSummary.pendingMutationCount, 2)
        XCTAssertEqual(inactiveSummary.conflictedMutationCount, 1)
        XCTAssertEqual(inactiveSummary.quarantinedMutationCount, 2)
        XCTAssertEqual(inactiveSummary.invalidPayloadMutationCount, 1)
        XCTAssertTrue(resolver.cacheInvalidationKey.contains("work-account:2:1:2:1"))
    }

    private func pendingMutation(
        id: String,
        accountID: GoogleAccount.ID,
        lastErrorSummary: String? = nil,
        quarantinedAt: Date? = nil,
        conflictedAt: Date? = nil
    ) -> PendingMutation {
        PendingMutation(
            id: UUID(uuidString: id)!,
            accountID: accountID,
            createdAt: Date(timeIntervalSince1970: 1),
            resourceType: .task,
            resourceID: id,
            action: .update,
            payload: Data(),
            lastErrorSummary: lastErrorSummary,
            quarantinedAt: quarantinedAt,
            conflictedAt: conflictedAt
        )
    }
}
