import XCTest
@testable import HotCrossBunsMac

final class BackoffPolicyTests: XCTestCase {
    func testBaseDelayOnFirstAttempt() {
        let policy = BackoffPolicy(
            baseDelay: .seconds(90),
            maxDelay: .seconds(600),
            jitter: .seconds(0),
            maxAttempts: 4
        )
        XCTAssertEqual(policy.delay(forAttempt: 0, randomSource: { 0 }), .seconds(90))
    }

    func testDelayDoublesWithAttempt() {
        let policy = BackoffPolicy(
            baseDelay: .seconds(10),
            maxDelay: .seconds(1000),
            jitter: .seconds(0),
            maxAttempts: 6
        )
        XCTAssertEqual(policy.delay(forAttempt: 1, randomSource: { 0 }), .seconds(20))
        XCTAssertEqual(policy.delay(forAttempt: 2, randomSource: { 0 }), .seconds(40))
        XCTAssertEqual(policy.delay(forAttempt: 3, randomSource: { 0 }), .seconds(80))
    }

    func testDelayClampsToMax() {
        let policy = BackoffPolicy(
            baseDelay: .seconds(60),
            maxDelay: .seconds(120),
            jitter: .seconds(0),
            maxAttempts: 6
        )
        XCTAssertEqual(policy.delay(forAttempt: 5, randomSource: { 0 }), .seconds(120))
    }

    func testJitterAddsToDelay() {
        let policy = BackoffPolicy(
            baseDelay: .seconds(10),
            maxDelay: .seconds(60),
            jitter: .seconds(4),
            maxAttempts: 4
        )
        XCTAssertEqual(policy.delay(forAttempt: 0, randomSource: { 0.5 }), .seconds(12))
    }

    func testShouldBackoffOn429And5xx() {
        let policy = BackoffPolicy.nearRealtime
        XCTAssertTrue(policy.shouldBackoff(from: GoogleAPIError.httpStatus(429, nil)))
        XCTAssertTrue(policy.shouldBackoff(from: GoogleAPIError.httpStatus(500, nil)))
        XCTAssertTrue(policy.shouldBackoff(from: GoogleAPIError.httpStatus(503, nil)))
        XCTAssertFalse(policy.shouldBackoff(from: GoogleAPIError.httpStatus(401, nil)))
        XCTAssertFalse(policy.shouldBackoff(from: GoogleAPIError.httpStatus(404, nil)))
        XCTAssertFalse(policy.shouldBackoff(from: GoogleAPIError.invalidURL))
    }
}
