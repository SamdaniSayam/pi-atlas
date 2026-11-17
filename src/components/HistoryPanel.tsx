/** Session search history (shared by the Explore page and the History screen). */
import { useNavigate } from "react-router-dom";
import { History, Trash2 } from "lucide-react";
import { useHistory } from "../state/useHistory";
import { useSearch, recordHistory } from "../state/useSearch";
import { formatInt } from "../engine/format";

export default function HistoryPanel() {
  const entries = useHistory((s) => s.entries);
  const clear = useHistory((s) => s.clear);
  const navigate = useNavigate();
  const runDigits = useSearch((s) => s.runDigits);

  if (entries.length === 0) {
    return (
      <section className="panel p-4" aria-label="Search history">
        <h3 className="m-0 flex items-center gap-2 text-base">
          <History size={15} aria-hidden="true" /> Session history
        </h3>
        <p className="mb-0 mt-2 text-sm" style={{ color: "var(--text-2)" }}>
          Your searches this session will appear here. History lives in memory only —
          it is never sent anywhere.
        </p>
      </section>
    );
  }

  return (
    <section className="panel p-4" aria-label="Search history">
      <div className="flex items-center justify-between">
        <h3 className="m-0 flex items-center gap-2 text-base">
          <History size={15} aria-hidden="true" /> Session history
        </h3>
        <button type="button" className="chip" onClick={clear}>
          <Trash2 size={12} aria-hidden="true" /> Clear
        </button>
      </div>
      <ul className="m-0 mt-2 list-none space-y-1 p-0">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              className="relative flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm no-underline"
              style={{ color: "var(--text)", minHeight: "var(--touch-secondary)" }}
              onClick={() => {
                if (e.mode === "digits") {
                  void runDigits(e.query).then((r) => {
                    navigate(`/explore/digits?q=${encodeURIComponent(e.query)}`);
                    if (r) recordHistory(useHistory.getState(), "digits", e.query, r.found, r.found ? r.positions[0] : null);
                  });
                } else {
                  navigate(`/explore/${e.mode}`);
                }
              }}
            >
              <span className="truncate mono">{e.query}</span>
              <span className="shrink-0 text-xs" style={{ color: e.status === "found" ? "var(--success)" : "var(--text-2)" }}>
                {e.status === "found" ? `pos ${formatInt(e.position ?? 0)}` : "absent"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}