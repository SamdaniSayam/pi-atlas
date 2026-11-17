/** Standalone history screen — the same session list as the Explore sidebar. */
import { useEffect } from "react";
import HistoryPanel from "../components/HistoryPanel";
import { APP_NAME } from "../constants";

export default function History() {
  useEffect(() => {
    document.title = `History — ${APP_NAME}`;
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="m-0" style={{ fontSize: "clamp(28px, 4vw, 36px)" }}>Search history</h1>
      <p className="mt-2 text-[15px]" style={{ color: "var(--text-2)" }}>
        Every search you run this session, kept in memory on your device only. It is
        never sent to the server.
      </p>
      <div className="mt-4">
        <HistoryPanel />
      </div>
    </div>
  );
}