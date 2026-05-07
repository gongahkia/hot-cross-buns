use crate::encoding::percent_decode;
use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug)]
pub struct LoopbackServer {
    pub listener: TcpListener,
    pub redirect_uri: String,
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthCallback {
    pub code: String,
    pub state: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OAuthCallbackError {
    Io(String),
    MalformedRequest,
    MissingCode,
    MissingState,
    StateMismatch,
    ProviderError(String),
}

pub fn bind_loopback_server() -> io::Result<LoopbackServer> {
    bind_loopback_server_on(0)
}

/// Binds the loopback server on a specific port. Useful for headless flows
/// where the port must be known in advance so an `ssh -L` forward can target
/// it. Pass `0` to ask the OS for an ephemeral port.
pub fn bind_loopback_server_on(port: u16) -> io::Result<LoopbackServer> {
    let listener = TcpListener::bind(format!("127.0.0.1:{port}"))?;
    let addr = listener.local_addr()?;
    let actual_port = addr.port();
    Ok(LoopbackServer {
        listener,
        redirect_uri: format!("http://127.0.0.1:{actual_port}/oauth/callback"),
        port: actual_port,
    })
}

pub fn wait_for_oauth_callback(
    listener: &TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> Result<OAuthCallback, OAuthCallbackError> {
    listener
        .set_nonblocking(true)
        .map_err(|error| OAuthCallbackError::Io(error.to_string()))?;
    let deadline = Instant::now() + timeout;
    let (mut stream, _) = loop {
        match listener.accept() {
            Ok(accepted) => break accepted,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(OAuthCallbackError::Io(
                        "timed out waiting for OAuth callback".to_string(),
                    ));
                }
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => return Err(OAuthCallbackError::Io(error.to_string())),
        }
    };

    let mut buffer = [0_u8; 8192];
    let len = stream
        .read(&mut buffer)
        .map_err(|error| OAuthCallbackError::Io(error.to_string()))?;
    let request =
        std::str::from_utf8(&buffer[..len]).map_err(|_| OAuthCallbackError::MalformedRequest)?;
    let result = parse_callback_request(request, expected_state);
    let response = match &result {
        Ok(_) => callback_response(200, success_callback_html()),
        Err(error) => callback_response(400, &error_callback_html(error)),
    };
    stream
        .write_all(response.as_bytes())
        .map_err(|error| OAuthCallbackError::Io(error.to_string()))?;
    result
}

fn success_callback_html() -> &'static str {
    concat!(
        "<!doctype html><html lang=\"en\"><head>",
        "<meta charset=\"utf-8\">",
        "<title>Melon Pan signed in</title>",
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
        "<style>",
        ":root{color-scheme:light dark;}",
        "html,body{margin:0;min-height:100%;}",
        "body{background:Canvas;color:CanvasText;font:16px/1.5 -apple-system,BlinkMacSystemFont,",
        "\"Segoe UI\",sans-serif;}",
        "main{box-sizing:border-box;max-width:680px;padding:96px 40px;margin:0 auto;}",
        "h1{margin:0 0 12px;font-size:28px;line-height:1.2;font-weight:650;}",
        "p{margin:0;color:color-mix(in srgb,CanvasText 62%,transparent);}",
        "</style></head><body><main>",
        "<h1>Signed in to Melon Pan</h1>",
        "<p>You can close this tab and return to the app.</p>",
        "</main></body></html>"
    )
}

pub fn parse_callback_request(
    request: &str,
    expected_state: &str,
) -> Result<OAuthCallback, OAuthCallbackError> {
    let request_line = request
        .lines()
        .next()
        .ok_or(OAuthCallbackError::MalformedRequest)?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().ok_or(OAuthCallbackError::MalformedRequest)?;
    let target = parts.next().ok_or(OAuthCallbackError::MalformedRequest)?;
    if method != "GET" || !target.starts_with("/oauth/callback") {
        return Err(OAuthCallbackError::MalformedRequest);
    }

    let query = target.split_once('?').map(|(_, query)| query).unwrap_or("");
    let params = parse_query(query);
    if let Some(error) = params.get("error") {
        return Err(OAuthCallbackError::ProviderError(error.clone()));
    }
    let state = params
        .get("state")
        .ok_or(OAuthCallbackError::MissingState)?
        .to_string();
    if state != expected_state {
        return Err(OAuthCallbackError::StateMismatch);
    }
    let code = params
        .get("code")
        .ok_or(OAuthCallbackError::MissingCode)?
        .to_string();

    Ok(OAuthCallback { code, state })
}

fn parse_query(query: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        out.insert(percent_decode(key), percent_decode(value));
    }
    out
}

fn callback_response(status: u16, body: &str) -> String {
    let reason = if status == 200 { "OK" } else { "Bad Request" };
    format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

fn error_callback_html(error: &OAuthCallbackError) -> String {
    let message = match error {
        OAuthCallbackError::Io(detail) => format!("io error: {detail}"),
        OAuthCallbackError::MalformedRequest => "malformed callback request".to_string(),
        OAuthCallbackError::MissingCode => "missing authorization code".to_string(),
        OAuthCallbackError::MissingState => "missing state parameter".to_string(),
        OAuthCallbackError::StateMismatch => {
            "state mismatch (possible CSRF or stale tab)".to_string()
        }
        OAuthCallbackError::ProviderError(detail) => format!("provider error: {detail}"),
    };
    format!(
        concat!(
            "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
            "<title>Melon Pan sign-in failed</title>",
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
            "<style>",
            "html,body{{margin:0;height:100%;}}",
            "body{{display:flex;align-items:center;justify-content:center;",
            "background:#0d1117;color:#e6edf3;font:16px/1.5 system-ui,sans-serif;}}",
            ".card{{background:#161b22;padding:36px 44px;border-radius:12px;",
            "border:1px solid #f85149;text-align:center;max-width:520px;}}",
            "h1{{margin:.5em 0 .25em;font-size:20px;font-weight:600;}}",
            "code{{display:block;margin-top:1em;color:#ffa198;background:#1f1416;",
            "padding:8px 12px;border-radius:6px;}}",
            "</style></head><body><div class=\"card\">",
            "<h1>Melon Pan sign-in failed</h1>",
            "<p>You can close this tab and try again from the app.</p>",
            "<code>{}</code></div></body></html>"
        ),
        html_escape(&message)
    )
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

impl From<io::Error> for OAuthCallbackError {
    fn from(value: io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::thread;

    #[test]
    fn parses_callback_request() {
        let parsed = parse_callback_request(
            "GET /oauth/callback?code=a%2Fb&state=state-123 HTTP/1.1\r\nHost: localhost\r\n\r\n",
            "state-123",
        )
        .unwrap();
        assert_eq!(parsed.code, "a/b");
        assert_eq!(parsed.state, "state-123");
    }

    #[test]
    #[ignore = "sandbox may block loopback TCP connects"]
    fn loopback_server_accepts_one_callback() {
        let server = bind_loopback_server().unwrap();
        let addr = SocketAddr::from(([127, 0, 0, 1], server.port));
        let handle = thread::spawn(move || {
            wait_for_oauth_callback(&server.listener, "state-123", Duration::from_secs(2)).unwrap()
        });

        let mut stream = TcpStream::connect(addr).unwrap();
        stream
            .write_all(b"GET /oauth/callback?code=code-123&state=state-123 HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.contains("200 OK"));

        let callback = handle.join().unwrap();
        assert_eq!(callback.code, "code-123");
    }
}
