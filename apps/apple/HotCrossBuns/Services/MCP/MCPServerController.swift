import Foundation
import Network

enum MCPServerStatus: Equatable {
    case stopped
    case running(port: Int)
    case failed(String)

    var title: String {
        switch self {
        case .stopped:
            "Stopped"
        case .running(let port):
            "Running on 127.0.0.1:\(port)"
        case .failed:
            "Failed"
        }
    }

    var detail: String {
        switch self {
        case .stopped:
            "The local MCP server is disabled."
        case .running(let port):
            "MCP endpoint: http://127.0.0.1:\(port)/mcp"
        case .failed(let message):
            message
        }
    }
}

final class MCPServerController {
    private let toolService: HCBToolService
    private let tokenProvider: () throws -> String
    private let onStatus: @MainActor (MCPServerStatus) -> Void
    private let queue = DispatchQueue(label: "com.gongahkia.hotcrossbuns.mcp-server")
    private var listener: NWListener?
    private var activePort: Int?

    init(
        toolService: HCBToolService,
        tokenProvider: @escaping () throws -> String = HCBMCPTokenStore.loadOrCreateToken,
        onStatus: @escaping @MainActor (MCPServerStatus) -> Void
    ) {
        self.toolService = toolService
        self.tokenProvider = tokenProvider
        self.onStatus = onStatus
    }

    func start(port: Int) {
        let port = max(1, min(65535, port))
        if activePort == port, listener != nil {
            publish(.running(port: port))
            return
        }
        stop()

        do {
            _ = try tokenProvider()
            let parameters = NWParameters.tcp
            parameters.allowLocalEndpointReuse = true
            guard let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
                publish(.failed("Invalid MCP port \(port)."))
                return
            }
            parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: nwPort)
            let listener = try NWListener(using: parameters)
            listener.service = nil
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    self.publish(.running(port: port))
                case .failed(let error):
                    self.publish(.failed("MCP server failed: \(error.localizedDescription)"))
                    self.stop()
                case .cancelled:
                    self.publish(.stopped)
                default:
                    break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                self?.handle(connection)
            }
            self.listener = listener
            self.activePort = port
            listener.start(queue: queue)
        } catch {
            publish(.failed("Could not start MCP server: \(error.localizedDescription)"))
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
        activePort = nil
        publish(.stopped)
    }

    func handleHTTPRequest(data: Data, remoteIsLocal: Bool, now: Date = Date()) async -> HTTPResponse {
        guard remoteIsLocal else {
            return .plain(status: 403, body: "Forbidden")
        }
        guard let request = HTTPRequest(data: data) else {
            return .plain(status: 400, body: "Bad Request")
        }
        guard request.path == "/mcp" else {
            return .plain(status: 404, body: "Not Found")
        }
        guard request.method == "POST" else {
            return .plain(status: 405, body: "MCP Streamable HTTP GET/SSE is not implemented in Hot Cross Buns v1.")
        }
        guard originIsAllowed(request.headers["origin"]) else {
            return .plain(status: 403, body: "Forbidden origin")
        }
        do {
            let token = try tokenProvider()
            guard request.headers["authorization"] == "Bearer \(token)" else {
                return .plain(status: 401, body: "Unauthorized", headers: ["WWW-Authenticate": "Bearer"])
            }
        } catch {
            return .plain(status: 500, body: "MCP token unavailable")
        }
        return await handleJSONRPCBody(request.body, now: now)
    }

    func handleJSONRPCBody(_ body: Data, now: Date = Date()) async -> HTTPResponse {
        guard
            let object = try? JSONSerialization.jsonObject(with: body),
            let request = object as? [String: Any],
            request["jsonrpc"] as? String == "2.0",
            let method = request["method"] as? String
        else {
            return jsonRPCError(id: nil, code: -32700, message: "Parse error", status: 400)
        }

        let id = request["id"]
        if id == nil {
            if method == "notifications/initialized" {
                return .empty(status: 202)
            }
            return .empty(status: 202)
        }

        do {
            let result = try await handle(method: method, params: request["params"] as? [String: Any] ?? [:])
            return jsonRPCResult(id: id, result: result)
        } catch let error as HCBToolError {
            return jsonRPCError(
                id: id,
                code: errorCode(for: error),
                message: error.localizedDescription,
                data: error.confirmationId.map { ["confirmationId": $0] },
                status: 200
            )
        } catch {
            return jsonRPCError(id: id, code: -32603, message: error.localizedDescription, status: 200)
        }
    }

    private func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        switch method {
        case "initialize":
            return [
                "protocolVersion": "2025-06-18",
                "capabilities": [
                    "tools": [
                        "listChanged": false
                    ]
                ],
                "serverInfo": [
                    "name": "Hot Cross Buns",
                    "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
                ],
                "instructions": "Hot Cross Buns exposes local tasks, notes, and calendar events. Writes obey the user's MCP permission mode."
            ]

        case "tools/list":
            return [
                "tools": HCBToolService.toolDefinitions.map { tool in
                    [
                        "name": tool.name,
                        "description": tool.description,
                        "inputSchema": tool.inputSchema
                    ]
                }
            ]

        case "tools/call":
            guard let name = params["name"] as? String else {
                throw HCBToolError.invalidArguments("tools/call requires a tool name.")
            }
            let arguments = params["arguments"] as? [String: Any] ?? [:]
            let structured = try await toolService.callTool(name: name, arguments: arguments)
            let text = Self.jsonString(structured)
            return [
                "content": [
                    [
                        "type": "text",
                        "text": text
                    ]
                ],
                "structuredContent": structured,
                "isError": false
            ]

        default:
            throw HCBToolError.unknownTool(method)
        }
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(on: connection, buffer: Data())
    }

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var next = buffer
            if let data {
                next.append(data)
            }
            if let error {
                AppLogger.warn("mcp connection receive failed", category: .misc, metadata: ["error": error.localizedDescription])
                connection.cancel()
                return
            }
            if let request = HTTPRequest(data: next), next.count >= request.totalLength {
                let remoteIsLocal = Self.endpointIsLocal(connection.endpoint)
                Task {
                    let response = await self.handleHTTPRequest(data: next, remoteIsLocal: remoteIsLocal)
                    connection.send(content: response.data, completion: .contentProcessed { _ in
                        connection.cancel()
                    })
                }
                return
            }
            if isComplete {
                connection.cancel()
                return
            }
            self.receive(on: connection, buffer: next)
        }
    }

    private func publish(_ status: MCPServerStatus) {
        Task { @MainActor in
            onStatus(status)
        }
    }

    private func originIsAllowed(_ origin: String?) -> Bool {
        guard let origin, origin.isEmpty == false else { return true }
        guard let url = URL(string: origin), let host = url.host?.lowercased() else { return false }
        return host == "127.0.0.1" || host == "localhost" || host == "::1"
    }

    private func jsonRPCResult(id: Any?, result: [String: Any]) -> HTTPResponse {
        .json(status: 200, object: [
            "jsonrpc": "2.0",
            "id": id ?? NSNull(),
            "result": result
        ])
    }

    private func jsonRPCError(
        id: Any?,
        code: Int,
        message: String,
        data: [String: Any]? = nil,
        status: Int
    ) -> HTTPResponse {
        var error: [String: Any] = [
            "code": code,
            "message": message
        ]
        if let data {
            error["data"] = data
        }
        return .json(status: status, object: [
            "jsonrpc": "2.0",
            "id": id ?? NSNull(),
            "error": error
        ])
    }

    private func errorCode(for error: HCBToolError) -> Int {
        switch error {
        case .unknownTool:
            -32601
        case .invalidArguments, .notFound, .confirmationMismatch:
            -32602
        case .permissionDenied, .confirmationRequired:
            -32001
        case .mutationFailed:
            -32002
        }
    }

    private static func endpointIsLocal(_ endpoint: NWEndpoint) -> Bool {
        guard case .hostPort(let host, _) = endpoint else { return true }
        switch host {
        case .ipv4(let address):
            return address == IPv4Address.loopback
        case .ipv6(let address):
            return address == IPv6Address.loopback
        case .name(let name, _):
            let lowered = name.lowercased()
            return lowered == "localhost" || lowered == "127.0.0.1" || lowered == "::1"
        default:
            return false
        }
    }

    static func jsonString(_ object: Any) -> String {
        let compatible = HCBMCPJSONCompatibility.convert(object)
        guard JSONSerialization.isValidJSONObject(compatible),
              let data = try? JSONSerialization.data(withJSONObject: compatible, options: [.sortedKeys]),
              let string = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return string
    }
}

struct HTTPResponse {
    var status: Int
    var headers: [String: String]
    var body: Data

    var data: Data {
        var lines = [
            "HTTP/1.1 \(status) \(Self.reason(status))",
            "Content-Length: \(body.count)",
            "Connection: close"
        ]
        for (key, value) in headers {
            lines.append("\(key): \(value)")
        }
        lines.append("")
        lines.append("")
        var data = Data(lines.joined(separator: "\r\n").utf8)
        data.append(body)
        return data
    }

    static func json(status: Int, object: [String: Any]) -> HTTPResponse {
        let compatible = HCBMCPJSONCompatibility.convert(object)
        let data = (try? JSONSerialization.data(withJSONObject: compatible, options: [.sortedKeys])) ?? Data("{}".utf8)
        return HTTPResponse(status: status, headers: ["Content-Type": "application/json"], body: data)
    }

    static func plain(status: Int, body: String, headers: [String: String] = [:]) -> HTTPResponse {
        var headers = headers
        headers["Content-Type"] = "text/plain; charset=utf-8"
        return HTTPResponse(status: status, headers: headers, body: Data(body.utf8))
    }

    static func empty(status: Int) -> HTTPResponse {
        HTTPResponse(status: status, headers: [:], body: Data())
    }

    private static func reason(_ status: Int) -> String {
        switch status {
        case 200: "OK"
        case 202: "Accepted"
        case 400: "Bad Request"
        case 401: "Unauthorized"
        case 403: "Forbidden"
        case 404: "Not Found"
        case 405: "Method Not Allowed"
        case 500: "Internal Server Error"
        default: "HTTP"
        }
    }
}

private struct HTTPRequest {
    var method: String
    var path: String
    var headers: [String: String]
    var body: Data
    var totalLength: Int

    init?(data: Data) {
        guard let headerEnd = data.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let headerData = data[..<headerEnd.lowerBound]
        guard let headerText = String(data: headerData, encoding: .utf8) else { return nil }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }
        let parts = requestLine.split(separator: " ", maxSplits: 2).map(String.init)
        guard parts.count >= 2 else { return nil }
        method = parts[0].uppercased()
        path = parts[1]
        var parsedHeaders: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
            parsedHeaders[name] = value
        }
        headers = parsedHeaders
        let bodyStart = headerEnd.upperBound
        let length = Int(headers["content-length"] ?? "0") ?? 0
        totalLength = bodyStart + length
        guard data.count >= totalLength else { return nil }
        body = data[bodyStart..<totalLength]
    }
}

enum HCBMCPJSONCompatibility {
    static func convert(_ value: Any) -> Any {
        switch value {
        case let dict as [String: Any]:
            var out: [String: Any] = [:]
            for (key, value) in dict {
                out[key] = convert(value)
            }
            return out
        case let array as [Any]:
            return array.map(convert)
        case let date as Date:
            return ISO8601DateFormatter().string(from: date)
        case let url as URL:
            return url.absoluteString
        case Optional<Any>.none:
            return NSNull()
        default:
            return value
        }
    }
}
