//! Credential detection and redaction for diagnostics and source declarations.

/// Redacts URL credentials, sensitive query values, and authentication headers.
#[must_use]
pub(crate) fn redact_sensitive_text(value: &str) -> String {
    let with_redacted_user_info = redact_user_info(value);
    let with_redacted_queries = redact_sensitive_query_values(&with_redacted_user_info);
    redact_sensitive_headers(&with_redacted_queries)
}

/// Returns whether a URL-like value contains a sensitive query parameter.
#[must_use]
pub(crate) fn has_sensitive_url_query(value: &str) -> bool {
    let mut cursor = 0;
    while let Some(offset) = value[cursor..].find('?') {
        let query_start = cursor + offset + 1;
        let query_end = query_end(value, query_start);
        if url::form_urlencoded::parse(&value.as_bytes()[query_start..query_end])
            .any(|(key, _)| is_sensitive_query_key(&key))
        {
            return true;
        }
        cursor = query_end;
    }
    false
}

/// Returns whether a decoded query key can carry credentials.
#[must_use]
pub(crate) fn is_sensitive_query_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("token")
        || key.contains("secret")
        || key.contains("password")
        || key.contains("credential")
        || key.contains("signature")
        || key.contains("session")
        || key.contains("cookie")
        || key.contains("auth")
        || key == "key"
        || key == "sig"
        || key.contains("api_key")
        || key.contains("apikey")
}

fn redact_user_info(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut emitted = 0;
    let mut search = 0;
    while let Some(offset) = value[search..].find("://") {
        let authority_start = search + offset + 3;
        let authority_end = value[authority_start..]
            .find(['/', '?', '#'])
            .map_or(value.len(), |offset| authority_start + offset);
        let authority = &value[authority_start..authority_end];
        if let Some(user_info_end) = authority.rfind('@') {
            output.push_str(&value[emitted..authority_start]);
            output.push_str("<redacted>@");
            output.push_str(&authority[user_info_end + 1..]);
            emitted = authority_end;
        }
        search = authority_end;
    }
    output.push_str(&value[emitted..]);
    output
}

fn redact_sensitive_query_values(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;
    while let Some(offset) = value[cursor..].find('?') {
        let query_start = cursor + offset;
        let query_content_start = query_start + 1;
        let query_end = query_end(value, query_content_start);
        output.push_str(&value[cursor..query_content_start]);

        for (index, parameter) in value[query_content_start..query_end].split('&').enumerate() {
            if index > 0 {
                output.push('&');
            }
            let raw_key = parameter.split_once('=').map_or(parameter, |(key, _)| key);
            if decoded_query_key(raw_key).is_some_and(|key| is_sensitive_query_key(&key)) {
                output.push_str(raw_key);
                output.push_str("=<redacted>");
            } else {
                output.push_str(parameter);
            }
        }
        cursor = query_end;
    }
    output.push_str(&value[cursor..]);
    output
}

fn query_end(value: &str, query_start: usize) -> usize {
    value[query_start..]
        .find(|character: char| character == '#' || character.is_whitespace())
        .map_or(value.len(), |offset| query_start + offset)
}

fn decoded_query_key(value: &str) -> Option<String> {
    url::form_urlencoded::parse(format!("{value}=").as_bytes())
        .next()
        .map(|(key, _)| key.into_owned())
}

fn redact_sensitive_headers(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;
    while cursor < value.len() {
        let line_end = value[cursor..]
            .find(['\r', '\n'])
            .map_or(value.len(), |offset| cursor + offset);
        let line = &value[cursor..line_end];
        if let Some(value_start) = sensitive_header_value_start(line) {
            output.push_str(&line[..value_start]);
            output.push_str(" <redacted>");
        } else {
            output.push_str(line);
        }
        cursor = line_end;
        while let Some(character) = value[cursor..].chars().next() {
            if !matches!(character, '\r' | '\n') {
                break;
            }
            output.push(character);
            cursor += character.len_utf8();
        }
    }
    output
}

fn sensitive_header_value_start(line: &str) -> Option<usize> {
    const HEADERS: &[&str] = &[
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "x-auth-token",
    ];
    let lower = line.to_ascii_lowercase();
    HEADERS
        .iter()
        .filter_map(|header| {
            let marker = format!("{header}:");
            lower.find(&marker).and_then(|offset| {
                let preceding = line[..offset].chars().next_back();
                if preceding.is_none_or(|character| character.is_whitespace() || character == '(') {
                    Some(offset + marker.len())
                } else {
                    None
                }
            })
        })
        .min()
}

#[cfg(test)]
mod tests {
    use super::{has_sensitive_url_query, redact_sensitive_text};

    #[test]
    fn invariant_redaction_removes_every_supported_credential_form() {
        let secret = "do-not-display";
        let input = format!(
            "https://user:{secret}@example.test/a?access%5Ftoken={secret}&signature={secret}\nAuthorization: Bearer {secret}\nCookie: session={secret}"
        );
        let redacted = redact_sensitive_text(&input);

        assert!(!redacted.contains(secret));
        assert!(redacted.contains("access%5Ftoken=<redacted>"));
        assert!(redacted.contains("signature=<redacted>"));
        assert!(redacted.contains("Authorization: <redacted>"));
        assert!(redacted.contains("Cookie: <redacted>"));
    }

    #[test]
    fn invariant_sensitive_query_keys_are_detected_after_percent_decoding() {
        assert!(has_sensitive_url_query(
            "https://example.test/addon.zip?access%5Ftoken=do-not-display"
        ));
        assert!(has_sensitive_url_query(
            "https://example.test/addon.zip?signature=do-not-display"
        ));
        assert!(!has_sensitive_url_query(
            "https://example.test/addon.zip?version=1.2.3"
        ));
    }
}
