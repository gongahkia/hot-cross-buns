import Foundation

enum GoogleDiagnostics {
    private static let rawSnippetLimit = 4_096
    private static let stateQueue = DispatchQueue(label: "com.gongahkia.hotcrossbuns.google-diagnostics")
    private static var rawPayloadLoggingEnabledStorage = false

    static var isRawPayloadLoggingEnabled: Bool {
        stateQueue.sync { rawPayloadLoggingEnabledStorage }
    }

    static func setRawPayloadLoggingEnabled(_ isEnabled: Bool) {
        stateQueue.sync {
            rawPayloadLoggingEnabledStorage = isEnabled
        }
    }

    static func requestID() -> String {
        String(UUID().uuidString.prefix(8))
    }

    static func baseMetadata(
        requestID: String,
        method: String,
        path: String,
        queryItems: [URLQueryItem],
        requestBody: Data?
    ) -> [String: String] {
        var metadata: [String: String] = [
            "requestID": requestID,
            "method": method,
            "endpoint": endpointFamily(for: path),
            "path": redactedPath(path),
            "queryNames": queryNames(queryItems),
            "queryCount": String(queryItems.count)
        ]
        metadata.merge(jsonSummary(requestBody, prefix: "request")) { _, new in new }
        return metadata
    }

    static func successMetadata(
        status: Int?,
        responseBody: Data,
        durationMilliseconds: String
    ) -> [String: String] {
        var metadata: [String: String] = [
            "durationMs": durationMilliseconds,
            "responseBytes": String(responseBody.count)
        ]
        if let status {
            metadata["status"] = String(status)
        }
        metadata.merge(jsonSummary(responseBody, prefix: "response")) { _, new in new }
        return metadata
    }

    static func failureMetadata(
        error: Error,
        status: Int?,
        responseBody: Data?,
        durationMilliseconds: String
    ) -> [String: String] {
        var metadata: [String: String] = [
            "durationMs": durationMilliseconds,
            "error": sanitizedErrorDescription(error)
        ]
        if let status {
            metadata["status"] = String(status)
        }
        if let responseBody {
            metadata["responseBytes"] = String(responseBody.count)
            metadata.merge(jsonSummary(responseBody, prefix: "response")) { _, new in new }
        }
        if let bytes = responseBodyBytes(error), metadata["responseBytes"] == nil {
            metadata["responseBytes"] = String(bytes)
        }
        return metadata
    }

    static func rawMetadata(requestBody: Data?, responseBody: Data?) -> [String: String] {
        guard isRawPayloadLoggingEnabled else { return [:] }
        var metadata: [String: String] = [:]
        if let requestBody {
            metadata.merge(snippetMetadata(requestBody, prefix: "requestBody")) { _, new in new }
        }
        if let responseBody {
            metadata.merge(snippetMetadata(responseBody, prefix: "responseBody")) { _, new in new }
        }
        return metadata
    }

    static func elapsedMilliseconds(since start: UInt64) -> String {
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
        return String(format: "%.1f", elapsed)
    }

    static func redactedIdentifier(_ value: String) -> String {
        let decoded = value.removingPercentEncoding ?? value
        if decoded == "primary" || decoded == "@me" {
            return decoded
        }
        if let at = decoded.firstIndex(of: "@") {
            let local = decoded[..<at]
            let domain = decoded[decoded.index(after: at)...]
            return "\(local.prefix(2))***@\(domain)"
        }
        guard decoded.count > 4 else { return "<redacted>" }
        return "\(decoded.prefix(4))...\(decoded.suffix(4))"
    }

    static func redactedPath(_ path: String) -> String {
        let parts = path
            .split(separator: "/", omittingEmptySubsequences: true)
            .map(String.init)
        guard parts.isEmpty == false else { return path }

        let redacted = parts.enumerated().map { index, part in
            let previous = index > 0 ? parts[index - 1] : ""
            if shouldRedactPathPart(part, previous: previous) {
                return "<\(resourceLabel(for: previous)):\(redactedIdentifier(part))>"
            }
            return part
        }
        return "/" + redacted.joined(separator: "/")
    }

    static func errorMetadata(_ error: Error, stage: String? = nil) -> [String: String] {
        var metadata: [String: String] = ["error": sanitizedErrorDescription(error)]
        if let stage {
            metadata["stage"] = stage
        }
        if let status = statusCode(error) {
            metadata["status"] = String(status)
        }
        if let bytes = responseBodyBytes(error) {
            metadata["responseBytes"] = String(bytes)
        }
        return metadata
    }

    static func sanitizedErrorDescription(_ error: Error) -> String {
        guard let googleError = error as? GoogleAPIError else {
            return String(describing: error)
        }

        switch googleError {
        case .invalidURL:
            return "GoogleAPIError.invalidURL"
        case .invalidResponse:
            return "GoogleAPIError.invalidResponse"
        case .preconditionFailed:
            return "GoogleAPIError.preconditionFailed"
        case .invalidPayload(let body):
            return "GoogleAPIError.invalidPayload(responseBytes:\(body?.utf8.count ?? 0))"
        case .httpStatus(let status, let body):
            return "GoogleAPIError.httpStatus(\(status), responseBytes:\(body?.utf8.count ?? 0))"
        }
    }

    static func statusCode(_ error: Error) -> Int? {
        guard case let GoogleAPIError.httpStatus(status, _) = error else { return nil }
        return status
    }

    static func responseBodyBytes(_ error: Error) -> Int? {
        guard let body = (error as? GoogleAPIError)?.responseBody else { return nil }
        return body.utf8.count
    }

    private static func endpointFamily(for path: String) -> String {
        if path.hasPrefix("/tasks/v1/users/@me/lists") {
            return "tasks.taskLists"
        }
        if path.contains("/tasks/v1/lists/") {
            return "tasks.tasks"
        }
        if path.hasPrefix("/calendar/v3/users/me/calendarList") {
            return "calendar.calendarList"
        }
        if path.contains("/calendar/v3/calendars/") {
            return "calendar.events"
        }
        return "google"
    }

    private static func queryNames(_ queryItems: [URLQueryItem]) -> String {
        let names = Array(Set(queryItems.map(\.name))).sorted()
        return names.isEmpty ? "none" : names.joined(separator: ",")
    }

    private static func jsonSummary(_ data: Data?, prefix: String) -> [String: String] {
        guard let data, data.isEmpty == false else {
            return ["\(prefix)Bytes": "0", "\(prefix)JSON": "none"]
        }

        var metadata: [String: String] = ["\(prefix)Bytes": String(data.count)]
        guard let object = try? JSONSerialization.jsonObject(with: data) else {
            metadata["\(prefix)JSON"] = "non-json"
            return metadata
        }

        if let dictionary = object as? [String: Any] {
            metadata["\(prefix)JSON"] = "object"
            metadata["\(prefix)Fields"] = dictionary.keys.sorted().joined(separator: ",")
            if let items = dictionary["items"] as? [Any] {
                metadata["\(prefix)ItemCount"] = String(items.count)
            }
            if dictionary["nextPageToken"] != nil {
                metadata["\(prefix)HasNextPageToken"] = "true"
            }
            if dictionary["nextSyncToken"] != nil {
                metadata["\(prefix)HasNextSyncToken"] = "true"
            }
        } else if let array = object as? [Any] {
            metadata["\(prefix)JSON"] = "array"
            metadata["\(prefix)ItemCount"] = String(array.count)
        } else {
            metadata["\(prefix)JSON"] = "scalar"
        }
        return metadata
    }

    private static func snippetMetadata(_ data: Data, prefix: String) -> [String: String] {
        let raw = String(data: data, encoding: .utf8) ?? "<non-utf8 \(data.count) bytes>"
        let redacted = redactSecrets(raw)
        let truncated = redacted.count > rawSnippetLimit
        let snippet = String(redacted.prefix(rawSnippetLimit))
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\t", with: "\\t")
        return [
            "\(prefix)Snippet": snippet,
            "\(prefix)SnippetBytes": String(data.count),
            "\(prefix)SnippetTruncated": String(truncated)
        ]
    }

    private static func redactSecrets(_ raw: String) -> String {
        var output = raw
        output = redactPattern(#"ya29\.[A-Za-z0-9_\-]+"#, in: output, replacement: "ya29.<redacted>")
        output = redactPattern(#"Bearer [A-Za-z0-9._\-]+"#, in: output, replacement: "Bearer <redacted>")
        return output
    }

    private static func redactPattern(_ pattern: String, in text: String, replacement: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return text
        }
        let range = NSRange(location: 0, length: (text as NSString).length)
        return regex.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: replacement)
    }

    private static func shouldRedactPathPart(_ part: String, previous: String) -> Bool {
        switch previous {
        case "lists":
            return part != "@me"
        case "tasks":
            return part != "v1"
        case "calendars", "events":
            return true
        default:
            return false
        }
    }

    private static func resourceLabel(for previous: String) -> String {
        switch previous {
        case "lists":
            return "list"
        case "tasks":
            return "task"
        case "calendars":
            return "calendar"
        case "events":
            return "event"
        default:
            return "id"
        }
    }
}
