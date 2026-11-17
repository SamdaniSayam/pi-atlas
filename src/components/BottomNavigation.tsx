import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Home,
  Hash,
  Type,
  Grid2x2,
  Ellipsis,
  Palette,
  Shapes,
  Sigma,
  History as HistoryIcon,
  Settings as SettingsIcon,
  Info,
  type LucideIcon,
} from "lucide-react";
import Dialog from "./Dialog";

interface BottomNavigationProps {
  onOpenSettings: () => void;
}

const PRIMARY = [
  { to: "/", label: "Home", Icon: Home, exact: true },
  { to: "/explore/digits", label: "Digits", Icon: Hash },
  { to: "/explore/letters", label: "Letters", Icon: Type },
];

interface SheetOptionProps {
  to: string;
  Icon: LucideIcon;
  title: string;
  description: string;
  onNavigate: () => void;
}

function SheetOption({ to, Icon, title, description, onNavigate }: SheetOptionProps) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className="flex w-full items-center gap-3 rounded-lg p-3 no-underline"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        color: "var(--text)",
        minHeight: "var(--touch-primary)",
      }}
    >
      <Icon size={22} aria-hidden="true" style={{ color: "var(--accent)", flexShrink: 0 }} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs" style={{ color: "var(--text-2)" }}>
          {description}
        </span>
      </span>
    </NavLink>
  );
}

/** Mobile bottom navigation: Home, Digits, Letters, Patterns (sheet), More (sheet). */
export default function BottomNavigation({ onOpenSettings }: BottomNavigationProps) {
  const { pathname } = useLocation();
  const [patternsOpen, setPatternsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const patternsActive =
    pathname.startsWith("/explore/colors") || pathname.startsWith("/explore/shapes");
  const moreActive =
    pathname === "/probability" ||
    pathname === "/about" ||
    pathname === "/history";

  const navButton = (
    key: string,
    label: string,
    Icon: LucideIcon,
    active: boolean,
    onClick: () => void,
    expanded: boolean,
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-current={active ? "page" : undefined}
      className="flex flex-1 flex-col items-center justify-center gap-0.5 border-0 bg-transparent py-2 no-underline"
      style={{
        color: active ? "var(--accent)" : "var(--text-2)",
        minHeight: "56px",
        cursor: "pointer",
      }}
    >
      <Icon size={20} aria-hidden="true" />
      <span className="text-[0.68rem] font-medium">{label}</span>
    </button>
  );

  return (
    <>
      <nav
        aria-label="Explorer sections"
        className="fixed inset-x-0 bottom-0 z-40 flex md:hidden"
        style={{
          background: "color-mix(in srgb, var(--bg) 92%, transparent)",
          borderTop: "1px solid var(--border)",
          backdropFilter: "blur(10px)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {PRIMARY.map(({ to, label, Icon, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 no-underline"
            style={({ isActive }) => ({
              color: isActive ? "var(--accent)" : "var(--text-2)",
              minHeight: "56px",
            })}
          >
            <Icon size={20} aria-hidden="true" />
            <span className="text-[0.68rem] font-medium">{label}</span>
          </NavLink>
        ))}
        {navButton(
          "patterns",
          "Patterns",
          Grid2x2,
          patternsActive,
          () => setPatternsOpen(true),
          patternsOpen,
        )}
        {navButton(
          "more",
          "More",
          Ellipsis,
          moreActive,
          () => setMoreOpen(true),
          moreOpen,
        )}
      </nav>

      <Dialog open={patternsOpen} onClose={() => setPatternsOpen(false)} title="Patterns">
        <div className="flex flex-col gap-3">
          <SheetOption
            to="/explore/colors"
            Icon={Palette}
            title="Colour patterns"
            description="Paint a grid of digit colours and scan π for it"
            onNavigate={() => setPatternsOpen(false)}
          />
          <SheetOption
            to="/explore/shapes"
            Icon={Shapes}
            title="Shape patterns"
            description="Draw black & white shapes in the digit stream"
            onNavigate={() => setPatternsOpen(false)}
          />
        </div>
      </Dialog>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="flex flex-col gap-3">
          <SheetOption
            to="/probability"
            Icon={Sigma}
            title="Probability Lab"
            description="Odds, expected depths and difficulty maths"
            onNavigate={() => setMoreOpen(false)}
          />
          <SheetOption
            to="/history"
            Icon={HistoryIcon}
            title="History"
            description="Searches from this session"
            onNavigate={() => setMoreOpen(false)}
          />
          <SheetOption
            to="/about"
            Icon={Info}
            title="About"
            description="Dataset, method and privacy notes"
            onNavigate={() => setMoreOpen(false)}
          />
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              onOpenSettings();
            }}
            className="flex w-full items-center gap-3 rounded-lg p-3 text-left"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              minHeight: "var(--touch-primary)",
              cursor: "pointer",
            }}
          >
            <SettingsIcon
              size={22}
              aria-hidden="true"
              style={{ color: "var(--accent)", flexShrink: 0 }}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">Settings</span>
              <span className="block truncate text-xs" style={{ color: "var(--text-2)" }}>
                Theme, density, field width and motion
              </span>
            </span>
          </button>
        </div>
      </Dialog>
    </>
  );
}