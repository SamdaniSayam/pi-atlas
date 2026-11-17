//! Input normalization and date encodings — faithful ports of the TS engines
//! (`src/engine/lettersSearch.ts`, `src/engine/dates.ts`) so the API accepts
//! exactly what the browser once processed locally.

/// Mirror of the TS `normalizeWord`: NFD-fold, uppercase, strip combining
/// marks, drop whitespace, collect other non-A–Z characters as "removed",
/// cap the word at 12 letters (cap applied after the full scan, like TS).
pub fn normalize_word(raw: &str) -> (String, String) {
    use unicode_normalization::UnicodeNormalization;
    let nfd: String = raw.nfd().collect::<String>().to_uppercase();
    let mut removed = String::new();
    let mut word = String::new();
    for ch in nfd.chars() {
        if ('A'..='Z').contains(&ch) {
            word.push(ch);
        } else if ch.is_whitespace() {
            // silent separator
        } else if !unicode_normalization::char::is_combining_mark(ch) {
            removed.push(ch);
        }
    }
    if word.chars().count() > 12 {
        word = word.chars().take(12).collect();
    }
    (word, removed)
}

pub struct DateFormatSpec {
    pub id: &'static str,
    pub label: &'static str,
}

pub const DATE_FORMATS: [DateFormatSpec; 6] = [
    DateFormatSpec { id: "DDMMYYYY", label: "DDMMYYYY" },
    DateFormatSpec { id: "MMDDYYYY", label: "MMDDYYYY" },
    DateFormatSpec { id: "YYYYMMDD", label: "YYYYMMDD" },
    DateFormatSpec { id: "DDMMYY", label: "DDMMYY" },
    DateFormatSpec { id: "MMDDYY", label: "MMDDYY" },
    DateFormatSpec { id: "YYMMDD", label: "YYMMDD" },
];

fn pad(n: u32, w: usize) -> String {
    let s = n.to_string();
    if s.len() >= w {
        s
    } else {
        format!("{}{}", "0".repeat(w - s.len()), s)
    }
}

fn is_leap(y: u32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// Mirror of the TS `isValidDate`.
pub fn is_valid_date(y: u32, m: u32, d: u32) -> bool {
    if y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 {
        return false;
    }
    let days_in_month = [
        31,
        if is_leap(y) { 29 } else { 28 },
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];
    d <= days_in_month[(m - 1) as usize]
}

/// Encode a date into all six digit sequences, in DATE_FORMATS order.
pub fn date_sequences(y: u32, m: u32, d: u32) -> Vec<(&'static str, &'static str, String)> {
    let yy = pad(y % 100, 2);
    let yyyy = pad(y, 4);
    let mm = pad(m, 2);
    let dd = pad(d, 2);
    DATE_FORMATS
        .iter()
        .map(|spec| {
            let seq = match spec.id {
                "DDMMYYYY" => format!("{dd}{mm}{yyyy}"),
                "MMDDYYYY" => format!("{mm}{dd}{yyyy}"),
                "YYYYMMDD" => format!("{yyyy}{mm}{dd}"),
                "DDMMYY" => format!("{dd}{mm}{yy}"),
                "MMDDYY" => format!("{mm}{dd}{yy}"),
                "YYMMDD" => format!("{yy}{mm}{dd}"),
                _ => unreachable!(),
            };
            (spec.id, spec.label, seq)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_word_matches_ts_semantics() {
        // NFD "É" decomposes to E + combining acute; mark stripped.
        let (w, removed) = normalize_word("  café Ünïcode! ");
        assert_eq!(w, "CAFEUNICODE");
        assert_eq!(removed, "!");
        let (w, removed) = normalize_word("a@b#c");
        assert_eq!(w, "ABC");
        assert_eq!(removed, "@#");
        // 12-letter cap.
        let (w, _) = normalize_word("ABCDEFGHIJKLMNOP");
        assert_eq!(w, "ABCDEFGHIJKL");
    }

    #[test]
    fn date_encoding_matches_ts() {
        assert!(!is_valid_date(2023, 2, 29));
        assert!(is_valid_date(2024, 2, 29));
        assert!(is_valid_date(2000, 2, 29));
        assert!(!is_valid_date(1900, 2, 29));
        let rows = date_sequences(2000, 1, 1);
        assert_eq!(rows[0].2, "01012000");
        assert_eq!(rows[1].2, "01012000"); // duplicate sequence
        assert_eq!(rows[2].2, "20000101");
        assert_eq!(rows[3].2, "010100");
        assert_eq!(rows[4].2, "010100");
        assert_eq!(rows[5].2, "000101");
    }
}
