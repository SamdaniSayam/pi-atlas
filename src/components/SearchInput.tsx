/** Numeric search input with auto-sanitisation and inline explanation. */
import { useState } from "react";
import { Search } from "lucide-react";
import { sanitizeQuery, clampQuery } from "../engine/digitsSearch";

export default function SearchInput({
  onSubmit,
  initialQuery = "",
  placeholder = "Enter digits…",
  label = "Search digits",
  buttonLabel = "Search",
}: {
  onSubmit: (query: string) => void;
  initialQuery?: string;
  placeholder?: string;
  label?: string;
  buttonLabel?: string;
}) {
  const [raw, setRaw] = useState(initialQuery);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const { cleaned, removed } = sanitizeQuery(raw);
    if (removed) {
      setNotice(`Removed non-digit characters: ${removed.split("").join(" ")}`);
    } else {
      setNotice(null);
    }
    const q = clampQuery(cleaned);
    setRaw(q);
    if (q) onSubmit(q);
  };

  return (
    <form onSubmit={submit} role="search" aria-label={label} noValidate>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="digits-query">{label}</label>
        <input
          id="digits-query"
          className="field"
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setNotice(null);
          }}
          maxLength={40}
        />
        <button type="submit" className="btn btn-primary shrink-0" aria-label={buttonLabel}>
          <Search size={16} aria-hidden="true" />
          <span className="hidden sm:inline">{buttonLabel}</span>
        </button>
      </div>
      <p className="mb-0 mt-1.5 min-h-[1.1rem] text-xs" style={{ color: "var(--warning)" }} role="status">
        {notice}
      </p>
    </form>
  );
}
