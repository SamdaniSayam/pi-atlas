import { useEffect, useState, lazy, Suspense } from "react";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import Header from "./components/Header";
import BottomNavigation from "./components/BottomNavigation";
import SettingsDrawer from "./components/SettingsDrawer";
import ThemeToggle from "./components/ThemeToggle";
import Toast from "./components/Toast";
import { LoadingState } from "./components/EmptyState";
import { useSettings, applySettingsToDocument } from "./state/useSettings";
import { usePiStore } from "./data/piStore";
import { APP_NAME } from "./constants";

const Home = lazy(() => import("./pages/Home"));
const Explore = lazy(() => import("./pages/Explore"));
const OddsLab = lazy(() => import("./pages/OddsLab"));
const About = lazy(() => import("./pages/About"));
const TourStage = lazy(() => import("./tour/TourStage"));
const History = lazy(() => import("./pages/History"));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  const settings = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    applySettingsToDocument(settings);
  }, [settings]);

  useEffect(() => {
    document.title = `${APP_NAME} — explore one billion digits of π`;
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
      <Header
        onOpenSettings={() => setSettingsOpen(true)}
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
        <Suspense fallback={<LoadingState label="Loading explorer…" progress={0.4} />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/explore/:mode" element={<Explore />} />
            <Route path="/probability" element={<OddsLab />} />
            <Route path="/about" element={<About />} />
            <Route path="/tour" element={<TourStage />} />
            <Route path="/history" element={<History />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
      </main>
      <BottomNavigation onOpenSettings={() => setSettingsOpen(true)} />
      <Toast />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </HashRouter>
  );
}