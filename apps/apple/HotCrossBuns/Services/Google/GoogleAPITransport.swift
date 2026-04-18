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
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)
        components?.queryItems = queryItems.isEmpty ? nil : queryItems

        guard let url = components?.url else {
            throw GoogleAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(try await tokenProvider.accessToken())", forHTTPHeaderField: "Authorization")

        let (data, response) = try await urlSession.data(for: request)
        try validate(response: response, data: data)
        return try decoder.decode(Response.self, from: data)
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
        case .httpStatus(let status, _):
            "Google API request failed with status \(status)."
        }
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
