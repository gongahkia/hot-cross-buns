import Foundation

protocol AccessTokenProviding: Sendable {
    @MainActor
    func accessToken() async throws -> String
}

struct StaticAccessTokenProvider: AccessTokenProviding {
    var token: String

    @MainActor
    func accessToken() async throws -> String {
        token
    }
}

struct GoogleAPITransport: Sendable {
    var baseURL: URL
    var tokenProvider: AccessTokenProviding
    var urlSession: URLSession

    init(
        baseURL: URL,
        tokenProvider: AccessTokenProviding,
        urlSession: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.tokenProvider = tokenProvider
        self.urlSession = urlSession
    }

    func get<Response: Decodable & Sendable>(
        path: String,
        queryItems: [URLQueryItem] = [],
        decoder: JSONDecoder = .googleAPI
    ) async throws -> Response {
        try await request(path: path, queryItems: queryItems, decoder: decoder)
    }

    // §14 — GET variant that also returns the server's Date header. Used by
    // the Tasks client to derive an incremental-sync watermark from Google's
    // clock rather than the local one, eliminating the 300s drift slack.
    // Returns nil for `serverDate` when the header is missing or malformed
    // so callers can fall back safely.
    func getWithServerDate<Response: Decodable & Sendable>(
        path: String,
        queryItems: [URLQueryItem] = [],
        decoder: JSONDecoder = .googleAPI
    ) async throws -> (Response, Date?) {
        var request = try await makeRequest(method: "GET", path: path, queryItems: queryItems, ifMatch: nil)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await urlSession.data(for: request)
        try validate(response: response, data: data)
        let decoded = try decoder.decode(Response.self, from: data)
        let serverDate: Date? = {
            guard let http = response as? HTTPURLResponse,
                  let header = http.value(forHTTPHeaderField: "Date") else { return nil }
            return HTTPDateParser.parse(header)
        }()
        return (decoded, serverDate)
    }

    func request<Response: Decodable & Sendable, Body: Encodable & Sendable>(
        method: String = "GET",
        path: String,
        queryItems: [URLQueryItem] = [],
        body: Body? = nil,
        ifMatch: String? = nil,
        encoder: JSONEncoder = .googleAPI,
        decoder: JSONDecoder = .googleAPI
    ) async throws -> Response {
        var request = try await makeRequest(method: method, path: path, queryItems: queryItems, ifMatch: ifMatch)

        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await urlSession.data(for: request)
        try validate(response: response, data: data)
        return try decoder.decode(Response.self, from: data)
    }

    func send<Body: Encodable & Sendable>(
        method: String,
        path: String,
        queryItems: [URLQueryItem] = [],
        body: Body? = nil,
        ifMatch: String? = nil,
        encoder: JSONEncoder = .googleAPI
    ) async throws {
        var request = try await makeRequest(method: method, path: path, queryItems: queryItems, ifMatch: ifMatch)

        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await urlSession.data(for: request)
        try validate(response: response, data: data)
    }

    func send(
        method: String,
        path: String,
        queryItems: [URLQueryItem] = [],
        ifMatch: String? = nil
    ) async throws {
        let emptyBody: EmptyRequestBody? = nil
        try await send(method: method, path: path, queryItems: queryItems, body: emptyBody, ifMatch: ifMatch)
    }

    func request<Response: Decodable & Sendable>(
        method: String = "GET",
        path: String,
        queryItems: [URLQueryItem] = [],
        ifMatch: String? = nil,
        decoder: JSONDecoder = .googleAPI
    ) async throws -> Response {
        let emptyBody: EmptyRequestBody? = nil
        return try await request(
            method: method,
            path: path,
            queryItems: queryItems,
            body: emptyBody,
            ifMatch: ifMatch,
            decoder: decoder
        )
    }

    private func makeRequest(
        method: String,
        path: String,
        queryItems: [URLQueryItem],
        ifMatch: String? = nil
    ) async throws -> URLRequest {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)
        components?.queryItems = queryItems.isEmpty ? nil : queryItems

        guard let url = components?.url else {
            throw GoogleAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(try await tokenProvider.accessToken())", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let ifMatch, ifMatch.isEmpty == false {
            request.setValue(ifMatch, forHTTPHeaderField: "If-Match")
        }
        return request
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GoogleAPIError.invalidResponse
        }

        if httpResponse.statusCode == 412 {
            throw GoogleAPIError.preconditionFailed
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            throw GoogleAPIError.httpStatus(httpResponse.statusCode, String(data: data, encoding: .utf8))
        }
    }
}

private struct EmptyRequestBody: Encodable, Sendable {}

enum GoogleAPIError: LocalizedError, Equatable {
    case invalidURL
    case invalidResponse
    case preconditionFailed
    case httpStatus(Int, String?)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "Something went wrong building the Google request. Try again, or share a diagnostic bundle if it keeps happening."
        case .invalidResponse:
            "Google returned a response we couldn't read. Try Refresh."
        case .preconditionFailed:
            "Someone else (or another device) changed this item while you were editing. We'll refresh so you can try again with the latest version."
        case .httpStatus(let status, let body):
            statusMessage(status: status, body: body)
        }
    }

    private func statusMessage(status: Int, body: String?) -> String {
        let baseMessage = switch status {
        case 401:
            "Your Google session expired. Reconnect in Settings to keep syncing."
        case 403:
            "Google denied access. Reconnect in Settings so you can re-grant the Tasks + Calendar permissions."
        case 404:
            "That item isn't on Google anymore — it may have been deleted on another device. Refresh to get the latest state."
        case 410:
            "Google's sync window expired. Force Full Resync in Diagnostics to rebuild from scratch."
        case 429:
            "Google is rate-limiting Hot Cross Buns. It'll retry automatically in a minute or two."
        case 500...599:
            "Google Calendar is briefly having trouble. We'll retry automatically — check the sync indicator."
        default:
            "Google rejected the request (status \(status)). Try again or share a diagnostic bundle."
        }

        guard let body, body.isEmpty == false else {
            return baseMessage
        }

        return baseMessage + " " + body.prefix(180)
    }
}

extension JSONDecoder {
    static var googleAPI: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = GoogleDateParser.parse(value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid Google date string: \\(value)"
            )
        }
        return decoder
    }
}

extension JSONEncoder {
    static var googleAPI: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

// Parses the HTTP `Date` response header. RFC 7231 requires IMF-fixdate
// (RFC 1123), but some intermediaries still emit RFC 850 or asctime. We
// accept all three to stay robust; the result is a UTC Date.
enum HTTPDateParser {
    private static let rfc1123: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        return f
    }()

    private static let rfc850: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = "EEEE, dd-MMM-yy HH:mm:ss zzz"
        return f
    }()

    private static let asctime: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = "EEE MMM d HH:mm:ss yyyy"
        return f
    }()

    static func parse(_ s: String) -> Date? {
        rfc1123.date(from: s) ?? rfc850.date(from: s) ?? asctime.date(from: s)
    }
}

private enum GoogleDateParser {
    static let internetWithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static let internet: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static let dateOnly: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func parse(_ value: String) -> Date? {
        internetWithFractionalSeconds.date(from: value)
            ?? internet.date(from: value)
            ?? dateOnly.date(from: value)
    }
}
