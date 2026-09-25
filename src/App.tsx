import React, { Suspense, lazy, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/common/Header';
import { UpdateBanner } from './components/common/UpdateBanner';
import { Sidebar } from './components/common/Sidebar';
import { LoginPage } from './components/auth/LoginPage';
import { GlobalToast } from './components/common/GlobalToast';
import { ConfirmationModal } from './components/common/ConfirmationModal';
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
const AnalyticsView = lazy(() =>
  import('./components/analytics/AnalyticsView').then((m) => ({ default: m.AnalyticsView }))
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
  const { user, currentView, selectedCaseForModal, setSelectedCaseForModal } = useApp();
  const [isNewCaseModalOpen, setIsNewCaseModalOpen] = useState(false);

  if (!user) {
    return (
      <>
        <LoginPage />
        <GlobalToast />
        <ConfirmationModal />
      </>
    );
  }

  return (
    <div className="h-screen bg-slate-50 flex font-sans text-slate-900 antialiased selection:bg-indigo-600 selection:text-white overflow-hidden">
      {/* Responsive Left Sidebar */}
      <Sidebar />

      {/* Main Column: Top Header + View Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* In-app auto-update banner (checks GitHub releases, silent offline) */}
        <UpdateBanner />

        {/* Top Header */}
        <Header onOpenNewCaseModal={() => setIsNewCaseModalOpen(true)} />

        {/* View Main Content Area wrapped in Error Boundary */}
        <main className="flex-1 p-3 sm:p-5 md:p-8 overflow-y-auto dental-grid-bg">
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

                {currentView === 'analytics' && <AnalyticsView />}

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

      {/* Global In-App Toast & Confirmation Modal */}
      <GlobalToast />
      <ConfirmationModal />
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
