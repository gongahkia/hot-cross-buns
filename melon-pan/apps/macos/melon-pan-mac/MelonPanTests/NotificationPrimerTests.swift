import UserNotifications
import XCTest
@testable import MelonPan

@MainActor
final class NotificationPrimerTests: XCTestCase {
    override func tearDown() {
        AppNotifications.resetAuthorizationHooksForTesting()
        super.tearDown()
    }

    func testPresenterNotCalledWhenAlreadyAuthorized() async throws {
        let cacheRoot = try makeTemporaryCacheRoot()
        defer { try? FileManager.default.removeItem(at: cacheRoot) }
        let presenter = MockNotificationPrimerPresenter(decision: .notNow)
        AppNotifications.setAuthorizationHooksForTesting {
            .authorized
        }

        let status = await AppNotifications.requestWithPrimer(
            presenter: presenter,
            cacheRoot: cacheRoot.path
        )

        XCTAssertEqual(status, .authorized)
        XCTAssertEqual(presenter.callCount, 0)
        XCTAssertEqual(PermissionPreferences.load(cacheRoot: cacheRoot.path).notificationsAskCount, 0)
    }

    func testPresenterNotCalledWhenDenied() async throws {
        let cacheRoot = try makeTemporaryCacheRoot()
        defer { try? FileManager.default.removeItem(at: cacheRoot) }
        let presenter = MockNotificationPrimerPresenter(decision: .notNow)
        AppNotifications.setAuthorizationHooksForTesting {
            .denied
        }

        let status = await AppNotifications.requestWithPrimer(
            presenter: presenter,
            cacheRoot: cacheRoot.path
        )

        XCTAssertEqual(status, .denied)
        XCTAssertEqual(presenter.callCount, 0)
    }

    func testPresenterNotCalledWhenAskCapReached() async throws {
        let cacheRoot = try makeTemporaryCacheRoot()
        defer { try? FileManager.default.removeItem(at: cacheRoot) }
        PermissionPreferences(
            notificationsAskCount: 3,
            notificationsDoNotAsk: false,
            lastAskedAt: nil
        ).save(cacheRoot: cacheRoot.path)
        let presenter = MockNotificationPrimerPresenter(decision: .notNow)
        AppNotifications.setAuthorizationHooksForTesting {
            .notDetermined
        }

        let status = await AppNotifications.requestWithPrimer(
            presenter: presenter,
            cacheRoot: cacheRoot.path
        )

        XCTAssertEqual(status, .notDetermined)
        XCTAssertEqual(presenter.callCount, 0)
        XCTAssertEqual(PermissionPreferences.load(cacheRoot: cacheRoot.path).notificationsAskCount, 3)
    }

    func testPresenterNotCalledWhenDoNotAskIsSet() async throws {
        let cacheRoot = try makeTemporaryCacheRoot()
        defer { try? FileManager.default.removeItem(at: cacheRoot) }
        PermissionPreferences(
            notificationsAskCount: 1,
            notificationsDoNotAsk: true,
            lastAskedAt: Date(timeIntervalSince1970: 1_776_000_000)
        ).save(cacheRoot: cacheRoot.path)
        let presenter = MockNotificationPrimerPresenter(decision: .notNow)
        AppNotifications.setAuthorizationHooksForTesting {
            .notDetermined
        }

        let status = await AppNotifications.requestWithPrimer(
            presenter: presenter,
            cacheRoot: cacheRoot.path
        )

        XCTAssertEqual(status, .notDetermined)
        XCTAssertEqual(presenter.callCount, 0)
        XCTAssertTrue(PermissionPreferences.load(cacheRoot: cacheRoot.path).notificationsDoNotAsk)
    }

    func testFreshNotDeterminedPreferencesCallPresenterAndBumpCount() async throws {
        let cacheRoot = try makeTemporaryCacheRoot()
        defer { try? FileManager.default.removeItem(at: cacheRoot) }
        let presenter = MockNotificationPrimerPresenter(decision: .notNow)
        var requestCallCount = 0
        AppNotifications.setAuthorizationHooksForTesting(
            statusProvider: {
                .notDetermined
            },
            requestAuthorization: {
                requestCallCount += 1
            }
        )

        let status = await AppNotifications.requestWithPrimer(
            presenter: presenter,
            cacheRoot: cacheRoot.path
        )

        let preferences = PermissionPreferences.load(cacheRoot: cacheRoot.path)
        XCTAssertEqual(status, .notDetermined)
        XCTAssertEqual(presenter.callCount, 1)
        XCTAssertEqual(requestCallCount, 0)
        XCTAssertEqual(preferences.notificationsAskCount, 1)
        XCTAssertFalse(preferences.notificationsDoNotAsk)
        XCTAssertNotNil(preferences.lastAskedAt)
    }

    func testDontAskAgainDecisionPersists() async throws {
        let cacheRoot = try makeTemporaryCacheRoot()
        defer { try? FileManager.default.removeItem(at: cacheRoot) }
        let presenter = MockNotificationPrimerPresenter(decision: .dontAskAgain)
        AppNotifications.setAuthorizationHooksForTesting {
            .notDetermined
        }

        _ = await AppNotifications.requestWithPrimer(
            presenter: presenter,
            cacheRoot: cacheRoot.path
        )

        let preferences = PermissionPreferences.load(cacheRoot: cacheRoot.path)
        XCTAssertEqual(presenter.callCount, 1)
        XCTAssertEqual(preferences.notificationsAskCount, 1)
        XCTAssertTrue(preferences.notificationsDoNotAsk)
    }

    func testEnableDecisionRequestsSystemAuthorization() async throws {
        let cacheRoot = try makeTemporaryCacheRoot()
        defer { try? FileManager.default.removeItem(at: cacheRoot) }
        let presenter = MockNotificationPrimerPresenter(decision: .enable)
        var requestCallCount = 0
        AppNotifications.setAuthorizationHooksForTesting(
            statusProvider: {
                .notDetermined
            },
            requestAuthorization: {
                requestCallCount += 1
            }
        )

        _ = await AppNotifications.requestWithPrimer(
            presenter: presenter,
            cacheRoot: cacheRoot.path
        )

        XCTAssertEqual(presenter.callCount, 1)
        XCTAssertEqual(requestCallCount, 1)
    }

    func testPermissionPreferencesRoundTripEquality() throws {
        let cacheRoot = try makeTemporaryCacheRoot()
        defer { try? FileManager.default.removeItem(at: cacheRoot) }
        let preferences = PermissionPreferences(
            notificationsAskCount: 1,
            notificationsDoNotAsk: false,
            lastAskedAt: Date(timeIntervalSince1970: 1_777_777_777)
        )

        preferences.save(cacheRoot: cacheRoot.path)

        XCTAssertEqual(PermissionPreferences.load(cacheRoot: cacheRoot.path), preferences)
    }

    func testCorruptedPreferencesFallBackToDefaults() throws {
        let cacheRoot = try makeTemporaryCacheRoot()
        defer { try? FileManager.default.removeItem(at: cacheRoot) }
        let url = PermissionPreferences.storeURL(cacheRoot: cacheRoot.path)
        try "{".data(using: .utf8)?.write(to: url, options: .atomic)

        XCTAssertEqual(PermissionPreferences.load(cacheRoot: cacheRoot.path), PermissionPreferences())
    }

    private func makeTemporaryCacheRoot() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("melon-pan-notification-primer-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}

private final class MockNotificationPrimerPresenter: NotificationPrimerPresenter {
    private let decision: PrimerDecision
    private(set) var callCount = 0

    init(decision: PrimerDecision) {
        self.decision = decision
    }

    @MainActor
    func presentPrimer() async -> PrimerDecision {
        callCount += 1
        return decision
    }
}
