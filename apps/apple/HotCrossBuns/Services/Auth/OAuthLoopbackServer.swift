import Darwin
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
            writeResponse(
                to: clientFD,
                status: "400 Bad Request",
                page: .failure("Google sign-in was cancelled or denied: \(error)")
            )
        } else {
            writeResponse(to: clientFD, status: "200 OK", page: .success)
        }
        resume(returning: callback)
    }

    private func writeResponse(to fd: Int32, status: String, body: String) {
        let page: OAuthLoopbackPage = status.hasPrefix("2")
            ? .success
            : .failure(body)
        writeResponse(to: fd, status: status, page: page)
    }

    private func writeResponse(to fd: Int32, status: String, page: OAuthLoopbackPage) {
        let html = page.html
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

private enum OAuthLoopbackPage {
    case success
    case failure(String)

    var html: String {
        let isSuccess: Bool
        let eyebrow: String
        let title: String
        let message: String
        let symbol: String
        let accent: String

        switch self {
        case .success:
            isSuccess = true
            eyebrow = "Google account connected"
            title = "Sign-in finished"
            message = "You can close this tab and return to Hot Cross Buns. Sync will continue in the app."
            symbol = "OK"
            accent = "#e86f3d"
        case .failure(let body):
            isSuccess = false
            eyebrow = "Google sign-in did not finish"
            title = "Connection stopped"
            message = body
            symbol = "!"
            accent = "#d45858"
        }

        return """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Hot Cross Buns</title>
          <style>
            :root {
              color-scheme: light dark;
              --bg: #f6f1ea;
              --panel: rgba(255, 255, 255, 0.82);
              --ink: #272422;
              --muted: #716a63;
              --line: rgba(39, 36, 34, 0.12);
              --accent: \(accent);
            }
            @media (prefers-color-scheme: dark) {
              :root {
                --bg: #211f1c;
                --panel: rgba(52, 50, 45, 0.84);
                --ink: #f2eee8;
                --muted: #bbb2a8;
                --line: rgba(242, 238, 232, 0.12);
              }
            }
            * { box-sizing: border-box; }
            body {
              min-height: 100vh;
              margin: 0;
              display: grid;
              place-items: center;
              padding: 32px;
              background: var(--bg);
              color: var(--ink);
              font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
              line-height: 1.45;
            }
            main {
              width: min(560px, 100%);
              padding: 28px;
              border: 1px solid var(--line);
              border-radius: 8px;
              background: var(--panel);
              box-shadow: 0 24px 80px rgba(0, 0, 0, 0.16);
              backdrop-filter: blur(20px);
            }
            .mark {
              width: 48px;
              height: 48px;
              display: grid;
              place-items: center;
              border-radius: 8px;
              background: var(--accent);
              color: white;
              font-size: 18px;
              font-weight: 800;
              margin-bottom: 18px;
            }
            .eyebrow {
              margin: 0 0 6px;
              color: var(--accent);
              font-size: 13px;
              font-weight: 700;
              letter-spacing: 0;
              text-transform: uppercase;
            }
            h1 {
              margin: 0;
              font-size: clamp(30px, 6vw, 44px);
              line-height: 1.05;
              letter-spacing: 0;
            }
            p {
              margin: 14px 0 0;
              color: var(--muted);
              font-size: 17px;
            }
            .footer {
              margin-top: 24px;
              padding-top: 18px;
              border-top: 1px solid var(--line);
              font-size: 14px;
              color: var(--muted);
            }
            button {
              margin-top: 22px;
              border: 0;
              border-radius: 8px;
              padding: 10px 14px;
              background: var(--accent);
              color: white;
              font: inherit;
              font-weight: 700;
              cursor: pointer;
            }
          </style>
        </head>
        <body>
          <main>
            <div class="mark" aria-hidden="true">\(symbol)</div>
            <p class="eyebrow">\(Self.escape(eyebrow))</p>
            <h1>\(Self.escape(title))</h1>
            <p>\(Self.escape(message))</p>
            \(isSuccess ? #"<button onclick="window.close()">Close tab</button>"# : "")
            <div class="footer">Hot Cross Buns is listening only on this temporary local callback while sign-in completes.</div>
          </main>
        </body>
        </html>
        """
    }

    private static func escape(_ string: String) -> String {
        string
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }
}
