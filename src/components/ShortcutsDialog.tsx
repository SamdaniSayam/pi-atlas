/** Small keyboard reference. The wish-card `w` shortcut lives here. */
import Dialog from "./Dialog";

const SHORTCUTS = [
  { keys: "w", description: "Open the wish card for the current result (ignored while typing)" },
  { keys: "Esc", description: "Close the open dialog" },
];

export default function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <dl className="m-0 grid gap-3">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="flex items-start gap-3">
            <dt><kbd className="panel-2 px-2 py-1 mono text-sm">{s.keys}</kbd></dt>
            <dd className="m-0 text-sm" style={{ color: "var(--text-2)" }}>{s.description}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
