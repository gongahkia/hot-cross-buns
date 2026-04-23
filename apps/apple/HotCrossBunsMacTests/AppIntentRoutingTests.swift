import AppIntents
import XCTest
@testable import HotCrossBunsMac

final class AppIntentRoutingTests: XCTestCase {
    override func setUp() {
        super.setUp()
        _ = AppIntentHandoff.consumeAll()
    }

    override func tearDown() {
        _ = AppIntentHandoff.consumeAll()
        super.tearDown()
    }

    func testHandoffQueuesRoutesInOrder() {
        AppIntentHandoff.save(.addTask)
        AppIntentHandoff.save(.calendar)
        AppIntentHandoff.save(.store)

        XCTAssertEqual(AppIntentHandoff.consumeAll(), [.addTask, .calendar, .store])
    }

    func testConsumePendingRoutePreservesRemainder() {
        AppIntentHandoff.save(.addEvent)
        AppIntentHandoff.save(.calendar)

        XCTAssertEqual(AppIntentHandoff.consumePendingRoute(), .addEvent)
        XCTAssertEqual(AppIntentHandoff.consumeAll(), [.calendar])
    }

    func testAppIntentsEnqueueExpectedRoutes() async throws {
        _ = try await AddGoogleTaskIntent().perform()
        XCTAssertEqual(AppIntentHandoff.consumeAll(), [.addTask])

        _ = try await AddGoogleCalendarEventIntent().perform()
        XCTAssertEqual(AppIntentHandoff.consumeAll(), [.addEvent])

        _ = try await OpenHotCrossBunsCalendarIntent().perform()
        XCTAssertEqual(AppIntentHandoff.consumeAll(), [.calendar])

        _ = try await OpenHotCrossBunsStoreIntent().perform()
        XCTAssertEqual(AppIntentHandoff.consumeAll(), [.store])
    }
}
