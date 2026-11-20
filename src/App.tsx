import { useEffect, useState, lazy, Suspense } from "react";
import { HashRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import Header from "./components/Header";
import BottomNavigation from "./components/BottomNavigation";
import SettingsDrawer from "./components/SettingsDrawer";
import ThemeToggle from "./components/ThemeToggle";
import Toast from "./components/Toast";
import ErrorBoundary from "./components/ErrorBoundary";
import { LoadingState } from "./components/EmptyState";
import { useSettings, applySettingsToDocument } from "./state/useSettings";
import { usePiStore } from "./data/piStore";
import { stripSrc } from "./lib/sharedBanner";
import { APP_NAME } from "./constants";

const Home = lazy(() => import("./pages/Home"));
const Explore = lazy(() => import("./pages/Explore"));
const OddsLab = lazy(() => import("./pages/OddsLab"));
const About = lazy(() => import("./pages/About"));
const TourStage = lazy(() => import("./tour/TourStage"));
const History = lazy(() => import("./pages/History"));
const ShortcutsDialog = lazy(() => import("./components/ShortcutsDialog"));

/**
 * Dev-only gallery. The lazy component is created once at module scope: calling
 * lazy() during render would remount the route on every parent render.
 */
const DEV_ROUTES_ENABLED = import.meta.env.DEV || import.meta.env.VITE_E2E === "1";
const WishGallery = DEV_ROUTES_ENABLED
  ? lazy(() => import("./wishcard/dev/WishGallery"))
  : null;

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** `src=card` belongs only on Explorer URLs; drop it silently elsewhere. */
function StripSharedSrc() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (location.pathname.startsWith("/explore/")) return;
    const current = new URLSearchParams(location.search);
    if (!current.has("src")) return;
    const next = stripSrc(current);
    const search = next.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash },
      { replace: true },
    );
  }, [location.pathname, location.search, location.hash, navigate]);
  return null;
}

function AppRoutes() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname}>
      <Suspense fallback={<LoadingState label="Loading explorer…" progress={0.4} />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explore/:mode" element={<Explore />} />
          <Route path="/probability" element={<OddsLab />} />
          <Route path="/about" element={<About />} />
          <Route path="/tour" element={<TourStage />} />
          <Route path="/history" element={<History />} />
          {WishGallery && <Route path="/dev/wish" element={<WishGallery />} />}
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  const theme = useSettings((s) => s.theme);
  const reducedMotion = useSettings((s) => s.reducedMotion);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    applySettingsToDocument({ theme, reducedMotion });
  }, [theme, reducedMotion]);

  useEffect(() => {
    document.title = `${APP_NAME} · explore one billion digits of π`;
  }, []);

  // Load dataset after first paint so the landing page renders instantly.
  useEffect(() => {
    const id = window.setTimeout(() => {
      void usePiStore.getState().load();
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <HashRouter>
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          const main = document.getElementById("main");
          main?.focus();
          main?.scrollIntoView();
        }}
      >
        Skip to content
      </a>
      <ScrollToTop />
      <StripSharedSrc />
      <Header
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        themeToggle={<ThemeToggle />}
      />
      <main
        id="main"
        tabIndex={-1}
        className="
          mx-auto w-full max-w-[1440px] px-4
          pb-[calc(68px_+_var(--safe-bottom))]
          pt-4 outline-none
          md:pb-8"
      >
        <AppRoutes />
      </main>
      <BottomNavigation onOpenSettings={() => setSettingsOpen(true)} />
      <Toast />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {shortcutsOpen && (
        <Suspense fallback={null}>
          <ShortcutsDialog open onClose={() => setShortcutsOpen(false)} />
        </Suspense>
      )}
    </HashRouter>
  );
}
