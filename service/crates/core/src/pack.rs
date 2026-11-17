//! Nibble packing: decimal ASCII digits ⇄ 4-bit-per-digit binary.
//!
//! Encoding (documented in DECISIONS.md):
//! - Byte `b` holds digits `d0 d1` of successive positions as
//!   `b = (d0 << 4) | d1` — big nibble is the lower (even) position.
//! - Chunk digit counts are even, so every chunk is a whole number of bytes
//!   and no padding nibble exists.
//! - The stored sequence never contains the leading "3." — position 1 is the
//!   first digit after the decimal point.

/// Pack ASCII digits (b'0'..=b'9') into nibbles. Len must be even.
pub fn pack_digits(ascii: &[u8]) -> Vec<u8> {
    assert!(ascii.len() % 2 == 0, "digit count must be even");
    let mut out = Vec::with_capacity(ascii.len() / 2);
    for pair in ascii.chunks_exact(2) {
        debug_assert!(pair[0].is_ascii_digit() && pair[1].is_ascii_digit());
        out.push(((pair[0] - b'0') << 4) | (pair[1] - b'0'));
    }
    out
}

/// Unpack `count` digits starting at byte `offset` into ASCII bytes.
/// `offset` is a BYTE offset into `packed`; `count` must be even.
pub fn unpack_into(packed: &[u8], offset: u64, count: u64, out: &mut Vec<u8>) {
    assert!(count % 2 == 0, "count must be even");
    let bytes = (count / 2) as usize;
    out.reserve(bytes * 2);
    let mut i = offset as usize;
    let end = i + bytes;
    while i < end {
        let b = packed[i];
        out.push(b'0' + (b >> 4));
        out.push(b'0' + (b & 0x0f));
        i += 1;
    }
}

/// Unpack the whole packed slice to ASCII (diagnostics/tests).
pub fn unpack_all(packed: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(packed.len() * 2);
    unpack_into(packed, 0, (packed.len() * 2) as u64, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let ascii = b"141592653589793";
        let even = &ascii[..14];
        let packed = pack_digits(even);
        assert_eq!(packed.len(), 7);
        assert_eq!(packed[0], 0x14);
        assert_eq!(packed[1], 0x15);
        assert_eq!(packed[6], 0x79);
        let unpacked = unpack_all(&packed);
        assert_eq!(&unpacked[..], even);
    }

    #[test]
    fn offset_unpack() {
        let ascii = b"14159265358979323846"; // already "after point" digits
        let packed = pack_digits(ascii);
        let mut out = Vec::new();
        // byte offset 3 (6th digit) ⇒ unpack 6 digits: "653589"
        unpack_into(&packed, 3, 6, &mut out);
        assert_eq!(&out[..], b"653589");
    }
}
