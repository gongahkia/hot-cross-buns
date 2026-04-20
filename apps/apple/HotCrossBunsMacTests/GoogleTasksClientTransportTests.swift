import XCTest
@testable import HotCrossBunsMac

// Verifies that GoogleTasksClient assembles the exact HTTP request that
// Google expects: method, path, query items, JSON body shape, and
// If-Match headers for conditional writes. MockURLProtocol captures the
// real URLRequest that would be sent to the network.
final class GoogleTasksClientTransportTests: XCTestCase {
    private var client: GoogleTasksClient!

    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
        let transport = GoogleAPITransport(
            baseURL: URL(string: "https://www.googleapis.com")!,
            tokenProvider: StaticAccessTokenProvider(token: "test-token"),
            urlSession: MockURLProtocol.testSession()
        )
        client = GoogleTasksClient(transport: transport)
    }

    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    func testInsertTaskPostsJSONBodyWithAuthHeader() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            let body = #"{"id":"srv-1","title":"Task","status":"needsAction","etag":"etag-1"}"#
            return (response, body.data(using: .utf8)!)
        }

        let task = try await client.insertTask(
            taskListID: "list-xyz",
            title: "Task",
            notes: "Body",
            dueDate: nil
        )
        XCTAssertEqual(task.id, "srv-1")
        XCTAssertEqual(task.etag, "etag-1")

        let captured = try XCTUnwrap(MockURLProtocol.capturedRequests.first)
        XCTAssertEqual(captured.httpMethod, "POST")
        XCTAssertEqual(captured.url?.path, "/tasks/v1/lists/list-xyz/tasks")
        XCTAssertEqual(captured.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertEqual(captured.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertNil(captured.value(forHTTPHeaderField: "If-Match"))
    }

    func testUpdateTaskSendsIfMatchHeader() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            )!
            let body = #"{"id":"task-1","title":"Renamed","status":"needsAction","etag":"etag-2"}"#
            return (response, body.data(using: .utf8)!)
        }

        _ = try await client.updateTask(
            taskListID: "list-1",
            taskID: "task-1",
            title: "Renamed",
            notes: "New",
            dueDate: nil,
            ifMatch: "etag-prior"
        )

        let captured = try XCTUnwrap(MockURLProtocol.capturedRequests.first)
        XCTAssertEqual(captured.httpMethod, "PATCH")
        XCTAssertEqual(captured.url?.path, "/tasks/v1/lists/list-1/tasks/task-1")
        XCTAssertEqual(captured.value(forHTTPHeaderField: "If-Match"), "etag-prior")
    }

    func testDeleteTaskSendsIfMatchHeader() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil)!
            return (response, Data())
        }

        try await client.deleteTask(taskListID: "list-1", taskID: "task-1", ifMatch: "etag-delete")

        let captured = try XCTUnwrap(MockURLProtocol.capturedRequests.first)
        XCTAssertEqual(captured.httpMethod, "DELETE")
        XCTAssertEqual(captured.url?.path, "/tasks/v1/lists/list-1/tasks/task-1")
        XCTAssertEqual(captured.value(forHTTPHeaderField: "If-Match"), "etag-delete")
    }

    func testPreconditionFailedBubblesAsSpecificError() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 412, httpVersion: nil, headerFields: nil)!
            return (response, Data())
        }

        do {
            _ = try await client.updateTask(
                taskListID: "l", taskID: "t",
                title: "x", notes: "", dueDate: nil, ifMatch: "stale-etag"
            )
            XCTFail("Expected preconditionFailed")
        } catch let error as GoogleAPIError {
            XCTAssertEqual(error, .preconditionFailed)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testClearCompletedTasksPostsToClearEndpoint() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil)!
            return (response, Data())
        }

        try await client.clearCompletedTasks(taskListID: "list-1")

        let captured = try XCTUnwrap(MockURLProtocol.capturedRequests.first)
        XCTAssertEqual(captured.httpMethod, "POST")
        XCTAssertEqual(captured.url?.path, "/tasks/v1/lists/list-1/clear")
    }

    // §14 — listTasks should carry the first-page Date header back to
    // SyncScheduler so the incremental-sync watermark is derived from
    // Google's clock rather than the local one. Missing header → nil.
    func testListTasksCapturesServerDateHeader() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": "application/json",
                    "Date": "Sun, 19 Apr 2026 23:59:12 GMT"
                ]
            )!
            let body = #"{"items":[]}"#
            return (response, body.data(using: .utf8)!)
        }

        let page = try await client.listTasks(taskListID: "list-1", updatedMin: nil)
        XCTAssertEqual(page.tasks.count, 0)
        let serverDate = try XCTUnwrap(page.serverDate)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        let comps = cal.dateComponents([.year, .month, .day, .hour, .minute, .second], from: serverDate)
        XCTAssertEqual(comps.year, 2026)
        XCTAssertEqual(comps.month, 4)
        XCTAssertEqual(comps.day, 19)
        XCTAssertEqual(comps.hour, 23)
        XCTAssertEqual(comps.minute, 59)
        XCTAssertEqual(comps.second, 12)
    }

    func testListTasksReturnsNilServerDateWhenHeaderMissing() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, #"{"items":[]}"#.data(using: .utf8)!)
        }

        let page = try await client.listTasks(taskListID: "list-1", updatedMin: nil)
        XCTAssertNil(page.serverDate)
    }

    func testTaskDueDateSerializedAsLocalDateString() async throws {
        var captured: Data?
        MockURLProtocol.requestHandler = { request in
            if let stream = request.httpBodyStream {
                var data = Data()
                stream.open()
                let bufferSize = 1024
                let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
                while stream.hasBytesAvailable {
                    let read = stream.read(buffer, maxLength: bufferSize)
                    if read <= 0 { break }
                    data.append(buffer, count: read)
                }
                buffer.deallocate()
                stream.close()
                captured = data
            } else {
                captured = request.httpBody
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let body = #"{"id":"srv-1","title":"T","status":"needsAction"}"#
            return (response, body.data(using: .utf8)!)
        }

        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 8 * 3600)!
        var comps = DateComponents()
        comps.year = 2026; comps.month = 4; comps.day = 19
        let localMidnight = cal.date(from: comps)!

        _ = try await client.insertTask(
            taskListID: "l",
            title: "T",
            notes: "",
            dueDate: localMidnight
        )

        let data = try XCTUnwrap(captured)
        let string = String(data: data, encoding: .utf8) ?? ""
        XCTAssertTrue(
            string.contains("\"due\":\"2026-04-"),
            "Body should encode due as a date-only yyyy-MM-dd string; got \(string)"
        )
    }
}
