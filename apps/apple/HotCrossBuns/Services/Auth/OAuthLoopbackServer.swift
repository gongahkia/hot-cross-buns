import Foundation

struct OAuthLoopbackCallback: Sendable {
    var code: String?
    var state: String?
    var error: String?
}

final class OAuthLoopbackServer: @unchecked Sendable {
    private let lock = NSLock()
    private var socketFD: Int32 = -1
    private var continuation: CheckedContinuation<OAuthLoopbackCallback, Error>?
    private var pendingCallback: OAuthLoopbackCallback?
    private var pendingError: Error?

    func start() throws -> URL {
        let fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
        guard fd >= 0 else {
            throw CustomGoogleOAuthError.loopbackUnavailable
        }

        var reuse: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

        let bindStatus = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindStatus == 0, listen(fd, 1) == 0 else {
            close(fd)
            throw CustomGoogleOAuthError.loopbackUnavailable
        }

        var boundAddress = sockaddr_in()
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameStatus = withUnsafeMutablePointer(to: &boundAddress) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(fd, $0, &length)
            }
        }
        guard nameStatus == 0 else {
            close(fd)
            throw CustomGoogleOAuthError.loopbackUnavailable
        }

        lock.lock()
        socketFD = fd
        lock.unlock()

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.acceptOnce(fd: fd)
        }

        let port = UInt16(bigEndian: boundAddress.sin_port)
        return URL(string: "http://127.0.0.1:\(port)/")!
    }

    func waitForCallback() async throws -> OAuthLoopbackCallback {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            if let pendingCallback {
                self.pendingCallback = nil
                lock.unlock()
                continuation.resume(returning: pendingCallback)
                return
            }
            if let pendingError {
                self.pendingError = nil
                lock.unlock()
                continuation.resume(throwing: pendingError)
                return
            }
            self.continuation = continuation
            lock.unlock()
        }
    }

    func stop() {
        lock.lock()
        let fd = socketFD
        socketFD = -1
        lock.unlock()
        if fd >= 0 {
            shutdown(fd, SHUT_RDWR)
            close(fd)
        }
    }

    private func acceptOnce(fd: Int32) {
        var clientAddress = sockaddr()
        var length = socklen_t(MemoryLayout<sockaddr>.size)
        let clientFD = accept(fd, &clientAddress, &length)
        guard clientFD >= 0 else {
            resume(throwing: CustomGoogleOAuthError.loopbackUnavailable)
            return
        }
        defer {
            close(clientFD)
            stop()
        }

        var buffer = [UInt8](repeating: 0, count: 16_384)
        let count = recv(clientFD, &buffer, buffer.count - 1, 0)
        guard count > 0,
              let request = String(bytes: buffer.prefix(count), encoding: .utf8),
              let firstLine = request.components(separatedBy: "\r\n").first else {
            writeResponse(to: clientFD, status: "400 Bad Request", body: "Hot Cross Buns could not read the OAuth callback.")
            resume(throwing: CustomGoogleOAuthError.missingAuthorizationCode)
            return
        }

        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2,
              let url = URL(string: "http://127.0.0.1\(parts[1])"),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            writeResponse(to: clientFD, status: "400 Bad Request", body: "Hot Cross Buns could not parse the OAuth callback.")
            resume(throwing: CustomGoogleOAuthError.missingAuthorizationCode)
            return
        }

        let query = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value) })
        let callback = OAuthLoopbackCallback(
            code: query["code"] ?? nil,
            state: query["state"] ?? nil,
            error: query["error"] ?? nil
        )

        if let error = callback.error {
            writeResponse(to: clientFD, status: "400 Bad Request", body: "Google sign-in was cancelled or denied: \(error)")
        } else {
            writeResponse(to: clientFD, status: "200 OK", body: "Google sign-in finished. You can return to Hot Cross Buns.")
        }
        resume(returning: callback)
    }

    private func writeResponse(to fd: Int32, status: String, body: String) {
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><title>Hot Cross Buns</title></head><body><h1>\(body)</h1></body></html>
        """
        let response = """
        HTTP/1.1 \(status)\r
        Content-Type: text/html; charset=utf-8\r
        Content-Length: \(Data(html.utf8).count)\r
        Connection: close\r
        \r
        \(html)
        """
        _ = response.withCString { pointer in
            send(fd, pointer, strlen(pointer), 0)
        }
    }

    private func resume(returning callback: OAuthLoopbackCallback) {
        lock.lock()
        if let continuation {
            self.continuation = nil
            lock.unlock()
            continuation.resume(returning: callback)
        } else {
            pendingCallback = callback
            lock.unlock()
        }
    }

    private func resume(throwing error: Error) {
        lock.lock()
        if let continuation {
            self.continuation = nil
            lock.unlock()
            continuation.resume(throwing: error)
        } else {
            pendingError = error
            lock.unlock()
        }
    }
}
