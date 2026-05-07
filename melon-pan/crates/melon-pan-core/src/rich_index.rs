//! UTF-16 index mapping primitives.
//!
//! Google Docs API indexes are UTF-16 code-unit indexes — not Swift
//! `String.Index`, not Rust byte offsets, not Unicode scalar counts. This
//! module is the only place in the codebase that converts between
//! representations. Every other crate must call into here.
//!
//! Why this matters:
//!
//! - Rust `&str` byte offsets do not equal UTF-16 offsets for any
//!   non-ASCII character.
//! - macOS `NSAttributedString` and Swift `String.utf16` are UTF-16
//!   indexed; mismatches cause cell-boundary corruption inside tables.
//! - Emoji + ZWJ sequences and astral codepoints span multiple UTF-16
//!   code units (high+low surrogate). Off-by-one here silently splits
//!   characters across operations.

/// One UTF-16 code-unit position. Stored as u32 to match the Docs JSON
/// surface and to fit cleanly inside operation envelopes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, PartialOrd, Ord)]
pub struct Utf16Offset(pub u32);

impl Utf16Offset {
    pub const fn zero() -> Self {
        Utf16Offset(0)
    }

    pub fn as_u32(self) -> u32 {
        self.0
    }

    pub fn as_usize(self) -> usize {
        self.0 as usize
    }
}

/// Half-open UTF-16 range `[start, end)`. End may equal start (empty range).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Utf16Range {
    pub start: Utf16Offset,
    pub end: Utf16Offset,
}

impl Utf16Range {
    pub fn new(start: u32, end: u32) -> Self {
        debug_assert!(end >= start, "Utf16Range end must be >= start");
        Utf16Range {
            start: Utf16Offset(start),
            end: Utf16Offset(end),
        }
    }

    pub fn is_empty(self) -> bool {
        self.start == self.end
    }

    pub fn len(self) -> u32 {
        self.end.as_u32().saturating_sub(self.start.as_u32())
    }
}

/// Byte offset into a Rust `&str`. Distinct from `Utf16Offset` so the type
/// system catches accidental mixing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, PartialOrd, Ord)]
pub struct ByteOffset(pub usize);

impl ByteOffset {
    pub fn as_usize(self) -> usize {
        self.0
    }
}

/// Errors returned by the conversion helpers. Conversions are
/// best-effort; out-of-range or mid-codepoint inputs return errors rather
/// than silently truncating.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexError {
    /// UTF-16 offset points past the end of the string.
    Utf16OutOfRange { utf16_len: u32, requested: u32 },
    /// UTF-16 offset lands between a surrogate pair, splitting a character.
    Utf16InsideSurrogatePair { offset: u32 },
    /// Byte offset is past the end of the Rust string.
    ByteOutOfRange { byte_len: usize, requested: usize },
    /// Byte offset is not on a UTF-8 character boundary.
    ByteNotOnCharBoundary { offset: usize },
}

/// Total UTF-16 code-unit length of a Rust string.
///
/// Equivalent to `.encode_utf16().count()` but slightly cheaper because
/// we read the underlying chars exactly once.
pub fn utf16_len(text: &str) -> u32 {
    let mut total = 0_u32;
    for ch in text.chars() {
        total = total.saturating_add(ch.len_utf16() as u32);
    }
    total
}

/// Converts a Rust byte offset into the corresponding UTF-16 offset.
///
/// `byte_offset` must point to a UTF-8 character boundary; offsets between
/// continuation bytes are rejected. An offset equal to `text.len()` is
/// allowed and maps to the total UTF-16 length.
pub fn byte_to_utf16(text: &str, byte_offset: ByteOffset) -> Result<Utf16Offset, IndexError> {
    let target = byte_offset.as_usize();
    if target > text.len() {
        return Err(IndexError::ByteOutOfRange {
            byte_len: text.len(),
            requested: target,
        });
    }
    if !text.is_char_boundary(target) {
        return Err(IndexError::ByteNotOnCharBoundary { offset: target });
    }
    let mut utf16 = 0_u32;
    let mut byte = 0_usize;
    for ch in text.chars() {
        if byte == target {
            return Ok(Utf16Offset(utf16));
        }
        byte += ch.len_utf8();
        utf16 = utf16.saturating_add(ch.len_utf16() as u32);
    }
    // Falls through when target == text.len().
    Ok(Utf16Offset(utf16))
}

/// Converts a UTF-16 offset back into a Rust byte offset.
///
/// `utf16_offset` may equal the string's UTF-16 length. Offsets that fall
/// inside a surrogate pair (i.e. between the high and low surrogate of an
/// astral character) return `Utf16InsideSurrogatePair`.
pub fn utf16_to_byte(text: &str, utf16_offset: Utf16Offset) -> Result<ByteOffset, IndexError> {
    let target = utf16_offset.as_u32();
    let mut utf16 = 0_u32;
    let mut byte = 0_usize;
    for ch in text.chars() {
        if utf16 == target {
            return Ok(ByteOffset(byte));
        }
        let units = ch.len_utf16() as u32;
        let next_utf16 = utf16.saturating_add(units);
        if target < next_utf16 {
            // The only way `target` lands strictly inside `[utf16, utf16 +
            // units)` for a single char is when `units == 2`, i.e. the
            // character is a surrogate pair and the target sits between the
            // two halves. Rust's `&str` cannot index inside a single
            // codepoint, so we report it as an error and let the caller
            // decide how to handle (typically: snap to the nearest
            // boundary).
            return Err(IndexError::Utf16InsideSurrogatePair { offset: target });
        }
        utf16 = next_utf16;
        byte += ch.len_utf8();
    }
    if target == utf16 {
        Ok(ByteOffset(byte))
    } else {
        Err(IndexError::Utf16OutOfRange {
            utf16_len: utf16,
            requested: target,
        })
    }
}

/// Snap a UTF-16 offset that may sit inside a surrogate pair to the nearest
/// UTF-8 boundary. Useful for selection clamping where erroring out would
/// be hostile to the user.
///
/// Direction:
/// - `SnapDirection::Down` returns the boundary at or before the offset.
/// - `SnapDirection::Up` returns the boundary at or after the offset.
pub fn snap_utf16_to_boundary(
    text: &str,
    utf16_offset: Utf16Offset,
    direction: SnapDirection,
) -> Utf16Offset {
    let target = utf16_offset.as_u32();
    let mut utf16 = 0_u32;
    let mut last_boundary = 0_u32;
    for ch in text.chars() {
        if target == utf16 {
            return Utf16Offset(target);
        }
        let units = ch.len_utf16() as u32;
        let next = utf16.saturating_add(units);
        if target < next {
            return Utf16Offset(match direction {
                SnapDirection::Down => last_boundary.max(utf16),
                SnapDirection::Up => next,
            });
        }
        utf16 = next;
        last_boundary = utf16;
    }
    // Past end -> clamp.
    Utf16Offset(utf16.min(target))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapDirection {
    Down,
    Up,
}

/// `NSRange`-shaped pair: location + length, both UTF-16 code units. Kept
/// here so Swift FFI has a canonical Rust counterpart and so we don't grow
/// hand-rolled conversions in random files.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NsRangeLike {
    pub location: u32,
    pub length: u32,
}

impl NsRangeLike {
    pub fn from_range(range: Utf16Range) -> Self {
        NsRangeLike {
            location: range.start.as_u32(),
            length: range.len(),
        }
    }

    pub fn to_range(self) -> Utf16Range {
        Utf16Range::new(self.location, self.location.saturating_add(self.length))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_roundtrips_one_to_one() {
        let text = "hello";
        assert_eq!(utf16_len(text), 5);
        for byte in 0..=text.len() {
            let utf16 = byte_to_utf16(text, ByteOffset(byte)).unwrap();
            assert_eq!(utf16, Utf16Offset(byte as u32));
            let back = utf16_to_byte(text, utf16).unwrap();
            assert_eq!(back, ByteOffset(byte));
        }
    }

    #[test]
    fn cjk_chars_are_one_utf16_code_unit_each() {
        let text = "中文字"; // 3 chars, BMP
        assert_eq!(utf16_len(text), 3);
        // Each char is 3 bytes UTF-8, 1 code unit UTF-16.
        let after_first_char = byte_to_utf16(text, ByteOffset(3)).unwrap();
        assert_eq!(after_first_char, Utf16Offset(1));
        let back = utf16_to_byte(text, Utf16Offset(2)).unwrap();
        assert_eq!(back, ByteOffset(6));
    }

    #[test]
    fn astral_emoji_is_surrogate_pair() {
        let text = "a🍎b"; // 'a' + U+1F34E (astral) + 'b'
                           // 1 + 2 + 1 = 4 code units.
        assert_eq!(utf16_len(text), 4);
        // Byte offset right before the apple is 1, right after is 5.
        let before = byte_to_utf16(text, ByteOffset(1)).unwrap();
        assert_eq!(before, Utf16Offset(1));
        let after = byte_to_utf16(text, ByteOffset(5)).unwrap();
        assert_eq!(after, Utf16Offset(3));
        // Round trip through the boundary.
        assert_eq!(utf16_to_byte(text, Utf16Offset(3)).unwrap(), ByteOffset(5));
    }

    #[test]
    fn utf16_offset_inside_surrogate_pair_is_rejected() {
        let text = "a🍎b";
        let err = utf16_to_byte(text, Utf16Offset(2)).unwrap_err();
        assert!(matches!(
            err,
            IndexError::Utf16InsideSurrogatePair { offset: 2 }
        ));
    }

    #[test]
    fn snap_picks_correct_side() {
        let text = "a🍎b";
        // Inside surrogate pair at utf16 offset 2.
        assert_eq!(
            snap_utf16_to_boundary(text, Utf16Offset(2), SnapDirection::Down),
            Utf16Offset(1)
        );
        assert_eq!(
            snap_utf16_to_boundary(text, Utf16Offset(2), SnapDirection::Up),
            Utf16Offset(3)
        );
    }

    #[test]
    fn zwj_emoji_sequence_counts_each_code_unit() {
        // Family emoji: 👨‍👩‍👧 = man + ZWJ + woman + ZWJ + girl.
        // Each pictograph is astral (2 UTF-16 units), each ZWJ is 1.
        let text = "👨\u{200D}👩\u{200D}👧";
        // 2 + 1 + 2 + 1 + 2 = 8 UTF-16 units.
        assert_eq!(utf16_len(text), 8);
    }

    #[test]
    fn rtl_text_indexes_by_logical_order() {
        let text = "abcשלום"; // Hebrew word "shalom" after ASCII prefix.
                              // 3 ASCII + 4 BMP Hebrew = 7 code units.
        assert_eq!(utf16_len(text), 7);
        // Byte offset 3 sits between ASCII and Hebrew (ASCII 1B, Hebrew 2B/char).
        let between = byte_to_utf16(text, ByteOffset(3)).unwrap();
        assert_eq!(between, Utf16Offset(3));
    }

    #[test]
    fn newline_handling_is_one_code_unit() {
        let text = "a\nb\r\nc";
        assert_eq!(utf16_len(text), 6);
    }

    #[test]
    fn byte_offset_past_end_errors() {
        let text = "abc";
        let err = byte_to_utf16(text, ByteOffset(99)).unwrap_err();
        assert!(matches!(
            err,
            IndexError::ByteOutOfRange {
                byte_len: 3,
                requested: 99
            }
        ));
    }

    #[test]
    fn byte_offset_mid_codepoint_errors() {
        let text = "🍎"; // 4 bytes UTF-8.
        let err = byte_to_utf16(text, ByteOffset(2)).unwrap_err();
        assert!(matches!(
            err,
            IndexError::ByteNotOnCharBoundary { offset: 2 }
        ));
    }

    #[test]
    fn ns_range_round_trips_through_utf16_range() {
        let range = Utf16Range::new(3, 9);
        let ns = NsRangeLike::from_range(range);
        assert_eq!(ns.location, 3);
        assert_eq!(ns.length, 6);
        assert_eq!(ns.to_range(), range);
    }

    #[test]
    fn empty_string_lengths_are_zero() {
        assert_eq!(utf16_len(""), 0);
        assert_eq!(byte_to_utf16("", ByteOffset(0)).unwrap(), Utf16Offset(0));
        assert_eq!(utf16_to_byte("", Utf16Offset(0)).unwrap(), ByteOffset(0));
    }
}
