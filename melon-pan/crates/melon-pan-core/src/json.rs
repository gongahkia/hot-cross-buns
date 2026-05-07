use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum JsonValue {
    Null,
    Bool(bool),
    Number(String),
    String(String),
    Array(Vec<JsonValue>),
    Object(BTreeMap<String, JsonValue>),
}

impl JsonValue {
    pub fn get(&self, key: &str) -> Option<&JsonValue> {
        match self {
            JsonValue::Object(fields) => fields.get(key),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            JsonValue::String(value) => Some(value),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            JsonValue::Bool(value) => Some(*value),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[JsonValue]> {
        match self {
            JsonValue::Array(values) => Some(values),
            _ => None,
        }
    }

    pub fn path<'a>(&'a self, keys: &[&str]) -> Option<&'a JsonValue> {
        let mut current = self;
        for key in keys {
            current = current.get(key)?;
        }
        Some(current)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonError {
    pub offset: usize,
    pub message: String,
}

impl JsonError {
    fn new(offset: usize, message: impl Into<String>) -> Self {
        Self {
            offset,
            message: message.into(),
        }
    }
}

pub fn parse_json(input: &str) -> Result<JsonValue, JsonError> {
    let mut parser = Parser { input, offset: 0 };
    let value = parser.parse_value()?;
    parser.skip_ws();
    if parser.offset != input.len() {
        return Err(JsonError::new(
            parser.offset,
            "unexpected trailing characters",
        ));
    }
    Ok(value)
}

struct Parser<'a> {
    input: &'a str,
    offset: usize,
}

impl Parser<'_> {
    fn parse_value(&mut self) -> Result<JsonValue, JsonError> {
        self.skip_ws();
        match self.peek_byte() {
            Some(b'n') => self.parse_literal(b"null", JsonValue::Null),
            Some(b't') => self.parse_literal(b"true", JsonValue::Bool(true)),
            Some(b'f') => self.parse_literal(b"false", JsonValue::Bool(false)),
            Some(b'"') => self.parse_string().map(JsonValue::String),
            Some(b'[') => self.parse_array(),
            Some(b'{') => self.parse_object(),
            Some(b'-' | b'0'..=b'9') => self.parse_number(),
            Some(_) => Err(JsonError::new(self.offset, "unexpected JSON token")),
            None => Err(JsonError::new(self.offset, "unexpected end of input")),
        }
    }

    fn parse_literal(&mut self, literal: &[u8], value: JsonValue) -> Result<JsonValue, JsonError> {
        if self.input.as_bytes()[self.offset..].starts_with(literal) {
            self.offset += literal.len();
            Ok(value)
        } else {
            Err(JsonError::new(self.offset, "invalid literal"))
        }
    }

    fn parse_string(&mut self) -> Result<String, JsonError> {
        self.expect_byte(b'"')?;
        let mut out = String::new();
        while let Some(byte) = self.next_byte() {
            match byte {
                b'"' => return Ok(out),
                b'\\' => out.push(self.parse_escape()?),
                0x00..=0x1f => {
                    return Err(JsonError::new(self.offset, "control character in string"))
                }
                _ => {
                    let start = self.offset - 1;
                    let ch = self.input[start..]
                        .chars()
                        .next()
                        .ok_or_else(|| JsonError::new(self.offset, "invalid UTF-8 string"))?;
                    self.offset = start + ch.len_utf8();
                    out.push(ch);
                }
            }
        }
        Err(JsonError::new(self.offset, "unterminated string"))
    }

    fn parse_escape(&mut self) -> Result<char, JsonError> {
        match self.next_byte() {
            Some(b'"') => Ok('"'),
            Some(b'\\') => Ok('\\'),
            Some(b'/') => Ok('/'),
            Some(b'b') => Ok('\u{08}'),
            Some(b'f') => Ok('\u{0c}'),
            Some(b'n') => Ok('\n'),
            Some(b'r') => Ok('\r'),
            Some(b't') => Ok('\t'),
            Some(b'u') => self.parse_unicode_escape(),
            Some(_) => Err(JsonError::new(self.offset, "invalid string escape")),
            None => Err(JsonError::new(self.offset, "unterminated string escape")),
        }
    }

    fn parse_unicode_escape(&mut self) -> Result<char, JsonError> {
        let high = self.parse_hex_u16()?;
        if (0xd800..=0xdbff).contains(&high) {
            let checkpoint = self.offset;
            if self.next_byte() == Some(b'\\') && self.next_byte() == Some(b'u') {
                let low = self.parse_hex_u16()?;
                if (0xdc00..=0xdfff).contains(&low) {
                    let codepoint =
                        0x10000 + (((u32::from(high) - 0xd800) << 10) | (u32::from(low) - 0xdc00));
                    return char::from_u32(codepoint)
                        .ok_or_else(|| JsonError::new(self.offset, "invalid Unicode scalar"));
                }
            }
            self.offset = checkpoint;
            return Err(JsonError::new(
                self.offset,
                "invalid Unicode surrogate pair",
            ));
        }
        char::from_u32(u32::from(high))
            .ok_or_else(|| JsonError::new(self.offset, "invalid Unicode scalar"))
    }

    fn parse_hex_u16(&mut self) -> Result<u16, JsonError> {
        let mut value = 0_u16;
        for _ in 0..4 {
            let Some(byte) = self.next_byte() else {
                return Err(JsonError::new(self.offset, "unterminated Unicode escape"));
            };
            let Some(digit) = (byte as char).to_digit(16) else {
                return Err(JsonError::new(self.offset, "invalid Unicode escape"));
            };
            value = (value << 4) | digit as u16;
        }
        Ok(value)
    }

    fn parse_array(&mut self) -> Result<JsonValue, JsonError> {
        self.expect_byte(b'[')?;
        let mut values = Vec::new();
        self.skip_ws();
        if self.peek_byte() == Some(b']') {
            self.offset += 1;
            return Ok(JsonValue::Array(values));
        }
        loop {
            values.push(self.parse_value()?);
            self.skip_ws();
            match self.next_byte() {
                Some(b',') => continue,
                Some(b']') => return Ok(JsonValue::Array(values)),
                _ => return Err(JsonError::new(self.offset, "expected ',' or ']'")),
            }
        }
    }

    fn parse_object(&mut self) -> Result<JsonValue, JsonError> {
        self.expect_byte(b'{')?;
        let mut fields = BTreeMap::new();
        self.skip_ws();
        if self.peek_byte() == Some(b'}') {
            self.offset += 1;
            return Ok(JsonValue::Object(fields));
        }
        loop {
            self.skip_ws();
            let key = self.parse_string()?;
            self.skip_ws();
            self.expect_byte(b':')?;
            let value = self.parse_value()?;
            fields.insert(key, value);
            self.skip_ws();
            match self.next_byte() {
                Some(b',') => continue,
                Some(b'}') => return Ok(JsonValue::Object(fields)),
                _ => return Err(JsonError::new(self.offset, "expected ',' or '}'")),
            }
        }
    }

    fn parse_number(&mut self) -> Result<JsonValue, JsonError> {
        let start = self.offset;
        if self.peek_byte() == Some(b'-') {
            self.offset += 1;
        }
        self.consume_digits();
        if self.peek_byte() == Some(b'.') {
            self.offset += 1;
            self.consume_digits();
        }
        if matches!(self.peek_byte(), Some(b'e' | b'E')) {
            self.offset += 1;
            if matches!(self.peek_byte(), Some(b'+' | b'-')) {
                self.offset += 1;
            }
            self.consume_digits();
        }
        if self.offset == start || self.input.as_bytes().get(start..self.offset) == Some(b"-") {
            return Err(JsonError::new(start, "invalid number"));
        }
        Ok(JsonValue::Number(
            self.input[start..self.offset].to_string(),
        ))
    }

    fn consume_digits(&mut self) {
        while matches!(self.peek_byte(), Some(b'0'..=b'9')) {
            self.offset += 1;
        }
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek_byte(), Some(b' ' | b'\n' | b'\r' | b'\t')) {
            self.offset += 1;
        }
    }

    fn expect_byte(&mut self, expected: u8) -> Result<(), JsonError> {
        match self.next_byte() {
            Some(byte) if byte == expected => Ok(()),
            _ => Err(JsonError::new(
                self.offset,
                format!("expected '{}'", expected as char),
            )),
        }
    }

    fn peek_byte(&self) -> Option<u8> {
        self.input.as_bytes().get(self.offset).copied()
    }

    fn next_byte(&mut self) -> Option<u8> {
        let byte = self.peek_byte()?;
        self.offset += 1;
        Some(byte)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested_json() {
        let parsed = parse_json(r#"{"a":[true,null,"x\ny"],"b":{"c":1}}"#).unwrap();
        assert_eq!(parsed.path(&["a"]).unwrap().as_array().unwrap().len(), 3);
        assert_eq!(
            parsed.path(&["a"]).unwrap().as_array().unwrap()[2].as_str(),
            Some("x\ny")
        );
    }

    #[test]
    fn parses_unicode_surrogate_pair() {
        let parsed = parse_json(r#""\ud83c\udf48""#).unwrap();
        let parsed_char = parsed.as_str().unwrap().chars().next().unwrap();
        assert_eq!(parsed_char as u32, 0x1f348);
    }
}
