import { NavLink, useLocation } from "react-router-dom";
import { APP_NAME } from "../constants";

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/explore/digits", label: "Digits" },
  { to: "/explore/letters", label: "Letters" },
  { to: "/explore/colors", label: "Colours" },
  { to: "/explore/shapes", label: "Shapes" },
  { to: "/probability", label: "Probability" },
  { to: "/about", label: "About" },
];

const MODE_TITLES: Record<string, string> = {
  digits: "Digits Explorer",
  dates: "Date Explorer",
  letters: "Letters Explorer",
  colors: "Colours Explorer",
  shapes: "Shapes Explorer",
};

function getPageTitle(pathname: string): string {
  if (pathname === "/") return "Home";
  if (pathname.startsWith("/explore/")) {
    const mode = pathname.split("/")[2] ?? "digits";
    return MODE_TITLES[mode] ?? "Explorer";
  }
  if (pathname === "/probability") return "Probability Lab";
  if (pathname === "/about") return "About";
  if (pathname === "/tour") return "Guided tour";
  if (pathname === "/history") return "History";
  return "Explorer";
}

export default function Header({
  onOpenSettings,
  onOpenShortcuts,
  themeToggle,
}: {
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  themeToggle: React.ReactNode;
}) {
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);

  return (
    <header
      className="sticky top-0 z-40"
      style={{
        background: "color-mix(in srgb, var(--bg) 86%, transparent)",
        borderBottom: "1px solid var(--border)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-4">
        <NavLink to="/" className="mr-2 flex items-center gap-2 no-underline" aria-label={`π${APP_NAME} home`}>
          <span
            aria-hidden="true"
            className="grid h-8 w-8 place-items-center rounded-lg font-semibold"
            style={{
              background: "var(--accent)",
              color: "#08110d",
              fontFamily: "var(--font-display)",
              fontSize: "1.05rem",
            }}
          >
            π
          </span>
          <span
            className="hidden lg:inline"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: "1.1rem",
            }}
          >
            {APP_NAME}
          </span>
        </NavLink>

        <div className="min-w-0 flex-1">
          <span
            className="block truncate text-sm md:text-base"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            {pageTitle}
          </span>
        </div>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm no-underline transition-colors ${
                  isActive ? "" : "hover:text-[var(--text)]"
                }`
              }
              style={({ isActive }) => ({
                color: isActive ? "var(--accent)" : "var(--text-2)",
                background: isActive ? "var(--surface-2)" : "transparent",
                fontWeight: isActive ? 600 : 450,
              })}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          {themeToggle}
          <button
            type="button"
            className="btn btn-ghost icon-btn"
            onClick={onOpenShortcuts}
            aria-label="Keyboard shortcuts"
          >
            <span aria-hidden="true" className="text-base font-semibold">?</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost icon-btn"
            onClick={onOpenSettings}
            aria-label="Open settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span className="sr-only">Settings</span>
          </button>
        </div>
      </div>
    </header>
  );
}