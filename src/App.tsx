import React, { Suspense, lazy, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/common/Header';
import { AutoUpdatePanel } from './components/common/AutoUpdatePanel';
import { SyncStatusBanner } from './components/common/SyncStatusBanner';
import { SaveFailureBanner } from './components/common/SaveFailureBanner';
import { Sidebar } from './components/common/Sidebar';
import { LockScreen } from './components/common/LockScreen';
import { LoginPage } from './components/auth/LoginPage';
import { GlobalToast } from './components/common/GlobalToast';
import { ErrorBoundary } from './components/common/ErrorBoundary';

// View modules are code-split: each mounts only when its tab is opened. The
// app shell (auth, sidebar, header, toasts) stays in the eager chunk so first
// paint doesn't download every screen. Fallback is an empty block on purpose —
// chunks are local files and resolve in milliseconds; a spinner here would
// flash on every tab switch.
const DashboardView = lazy(() =>
  import('./components/dashboard/DashboardView').then((m) => ({ default: m.DashboardView }))
);
const CaseListView = lazy(() =>
  import('./components/cases/CaseListView').then((m) => ({ default: m.CaseListView }))
);
const CaseDetailModal = lazy(() =>
  import('./components/cases/CaseDetailModal').then((m) => ({ default: m.CaseDetailModal }))
);
const LabListView = lazy(() =>
  import('./components/labs/LabListView').then((m) => ({ default: m.LabListView }))
);
const BillingView = lazy(() =>
  import('./components/billing/BillingView').then((m) => ({ default: m.BillingView }))
);
const ReportsView = lazy(() =>
  import('./components/reports/ReportsView').then((m) => ({ default: m.ReportsView }))
);
const NotificationsView = lazy(() =>
  import('./components/notifications/NotificationsView').then((m) => ({ default: m.NotificationsView }))
);
const SettingsView = lazy(() =>
  import('./components/settings/SettingsView').then((m) => ({ default: m.SettingsView }))
);
const CatalogView = lazy(() =>
  import('./components/catalog/CatalogView').then((m) => ({ default: m.CatalogView }))
);

const MainAppContent: React.FC = () => {
  // The whole context object is kept (not just the fields the shell needs)
  // because the dev fixture handle below has to call the SAME setters the UI
  // calls. A ref is used rather than a dependency so the handle survives every
  // re-render and always sees the current state — `addCase` numbers cases from
  // the render closure it was created in, so a stale handle books duplicates.
  const app = useApp();
  const { user, currentView, selectedCaseForModal, setSelectedCaseForModal } = app;
  const [isNewCaseModalOpen, setIsNewCaseModalOpen] = useState(false);
  const appRef = React.useRef(app);
  appRef.current = app;

  React.useEffect(() => {
    // Dev-only demo fixtures. The guard is written POSITIVELY on purpose:
    // `import.meta.env.DEV` is substituted with `false` at build time, so the
    // whole `if` block — and therefore the only reference to
    // src/dev/demoFixtures — is removed before Rollup decides what to emit. The
    // negative form (`if (!DEV) return;` followed by the import) relies on
    // Rollup inferring unreachable code after an unconditional return, which is
    // a much weaker guarantee for the one thing this file must never do: ship.
    //
    // Do NOT hoist this into a module-level `lazy(() => import(...))` either —
    // that call is real, Rollup keeps it, and the fixture ships.
    // tests/dev/demoFixturesDevOnly.test.ts guards this arrangement.
    if (import.meta.env.DEV) {
      let uninstall: (() => void) | undefined;
      void import('./dev/demoFixtures').then((m) => {
        uninstall = m.installDemoFixtures(() => appRef.current);
      });
      return () => uninstall?.();
    }
  }, []);

  if (!user) {
    return (
      <>
        <LoginPage />
        <GlobalToast />
      </>
    );
  }

  return (
    <div className="app-atmos h-screen bg-ds-sunken flex font-sans text-ds-ink antialiased selection:bg-ds-accent selection:text-white overflow-hidden">
      <LockScreen />
      {/* Keyboard users land here first. Without it, reaching the dashboard
          means tabbing through the whole rail and then every header control on
          every page load — the rail comes first in DOM order because it is
          rendered first, so this link is the only way past it. `href` targets
          the <main> below, which is the first element that is actually content. */}
      <a href="#main-content" className="ds-skip-link">
        Skip to dashboard
      </a>

      {/* Responsive Left Sidebar */}
      <Sidebar />

      {/* Main Column: Top Header + View Content

          `relative` is load-bearing: it is the containing block for the
          full-page case viewer, which is `absolute inset-0`. Without a
          positioned ancestor that layer resolved against the viewport and
          covered the nav rail — which reads to the user as "the sidebar
          minimised when I opened a case job". Because this column is a plain
          flex sibling of <Sidebar />, confining the viewer here keeps the rail
          fully interactive and tracks its width whether expanded or collapsed,
          with no breakpoint arithmetic. */}
      <div className="relative flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Shown whenever the last SQLite collection sync failed — never silent */}
        <SyncStatusBanner />

        {/* Shown whenever the database could not be WRITTEN to storage — the
            difference between "your changes are in memory only" and losing
            them at close. Cleared by the next successful save. */}
        <SaveFailureBanner />

        {/* Connectivity + last-save status moved into the rail's version
            strip (Sidebar.tsx) — the sidebar is persistent on every view, so
            the status is still visible without scrolling, and the header
            becomes a clean floating pane. */}

        {/* Top Header */}
        <Header />

        {/* View Main Content Area wrapped in Error Boundary */}
        {/* pb-24 below lg: the mobile bottom bar is a fixed ~60px strip and the
            last card's own bottom padding is not enough to clear it, so the
            final row of every view sat underneath the navigation and could not
            be read or tapped. Axis utilities only (px/pt/pb, never p-*) so no
            shorthand can fight the bottom value at a breakpoint. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-3 pt-3 pb-24 sm:px-4 sm:pt-4 lg:px-5 lg:pt-5 lg:pb-5 overflow-x-clip overflow-y-auto dental-grid-bg focus-visible:outline-none contain-content"
        >
          <div className="w-full max-w-[1880px] 2xl:max-w-[2100px] mx-auto space-y-6">
            <ErrorBoundary>
              <Suspense fallback={null}>
                {currentView === 'dashboard' && (
                  <DashboardView onOpenNewCaseModal={() => setIsNewCaseModalOpen(true)} />
                )}

                {currentView === 'cases' && <CaseListView />}

                {currentView === 'labs' && <LabListView />}

                {currentView === 'billing' && <BillingView />}

                {currentView === 'catalog' && <CatalogView />}

                {currentView === 'analytics' && <ReportsView />}

                {currentView === 'notifications' && <NotificationsView />}

                {currentView === 'settings' && <SettingsView />}
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>

      {/* Quick Create Case Modal triggered from Top Header / Dashboard button */}
      {isNewCaseModalOpen && (
        <ErrorBoundary>
          <CaseDetailModal onClose={() => setIsNewCaseModalOpen(false)} />
        </ErrorBoundary>
      )}

      {/* Case Detail Modal triggered from Global Search or Notifications */}
      {selectedCaseForModal && (
        <ErrorBoundary>
          <CaseDetailModal
            initialCase={selectedCaseForModal}
            onClose={() => setSelectedCaseForModal(null)}
          />
        </ErrorBoundary>
      )}

      {/* Auto-installer: downloads and verifies updates on its own, then asks
          for a restart before the app is ever closed. The old "a newer
          installer is available" banner is gone — it could never update. */}
      <AutoUpdatePanel />

      {/* Global In-App Toast & Confirmation Modal */}
      <GlobalToast />
    </div>
  );
};

export function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <MainAppContent />
      </AppProvider>
    </ErrorBoundary>
  );
}

export default App;
