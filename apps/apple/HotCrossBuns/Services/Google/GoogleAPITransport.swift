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

    func request<Response: Decodable & Sendable, Body: Encodable & Sendable>(
        method: String = "GET",
        path: String,
        queryItems: [URLQueryItem] = [],
        body: Body? = nil,
        encoder: JSONEncoder = .googleAPI,
        decoder: JSONDecoder = .googleAPI
    ) async throws -> Response {
        var request = try await makeRequest(method: method, path: path, queryItems: queryItems)

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
        encoder: JSONEncoder = .googleAPI
    ) async throws {
        var request = try await makeRequest(method: method, path: path, queryItems: queryItems)

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
        queryItems: [URLQueryItem] = []
    ) async throws {
        let emptyBody: EmptyRequestBody? = nil
        try await send(method: method, path: path, queryItems: queryItems, body: emptyBody)
    }

    func request<Response: Decodable & Sendable>(
        method: String = "GET",
        path: String,
        queryItems: [URLQueryItem] = [],
        decoder: JSONDecoder = .googleAPI
    ) async throws -> Response {
        let emptyBody: EmptyRequestBody? = nil
        return try await request(
            method: method,
            path: path,
            queryItems: queryItems,
            body: emptyBody,
            decoder: decoder
        )
    }

    private func makeRequest(
        method: String,
        path: String,
        queryItems: [URLQueryItem]
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
        return request
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GoogleAPIError.invalidResponse
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
    case httpStatus(Int, String?)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "The Google API request URL could not be built."
        case .invalidResponse:
            "Google returned an invalid response."
        case .httpStatus(let status, let body):
            statusMessage(status: status, body: body)
        }
    }

    private func statusMessage(status: Int, body: String?) -> String {
        let baseMessage = switch status {
        case 401:
            "Google authorization expired. Reconnect your account."
        case 403:
            "Google denied access. Check granted Tasks and Calendar permissions."
        case 404:
            "Google could not find that task, calendar, or event. Refresh and try again."
        case 410:
            "Google sync state expired. A full refresh is required."
        case 429:
            "Google rate-limited the app. Wait briefly and retry."
        case 500...599:
            "Google is temporarily unavailable. Retry shortly."
        default:
            "Google API request failed with status \(status)."
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
