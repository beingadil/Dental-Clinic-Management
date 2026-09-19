import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/common/Header';
import { Sidebar } from './components/common/Sidebar';
import { DashboardView } from './components/dashboard/DashboardView';
import { CaseListView } from './components/cases/CaseListView';
import { CaseDetailModal } from './components/cases/CaseDetailModal';
import { LabListView } from './components/labs/LabListView';
import { BillingView } from './components/billing/BillingView';
import { AnalyticsView } from './components/analytics/AnalyticsView';
import { NotificationsView } from './components/notifications/NotificationsView';
import { SettingsView } from './components/settings/SettingsView';
import { CatalogView } from './components/catalog/CatalogView';
import { PrintStudioView } from './components/print/PrintStudioView';
import { LoginPage } from './components/auth/LoginPage';
import { GlobalToast } from './components/common/GlobalToast';
import { ConfirmationModal } from './components/common/ConfirmationModal';
import { ErrorBoundary } from './components/common/ErrorBoundary';

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
        {/* Top Header */}
        <Header onOpenNewCaseModal={() => setIsNewCaseModalOpen(true)} />

        {/* View Main Content Area wrapped in Error Boundary */}
        <main className="flex-1 p-3 sm:p-5 md:p-8 overflow-y-auto dental-grid-bg">
          <div className="w-full max-w-[1880px] 2xl:max-w-[2100px] mx-auto space-y-6">
            <ErrorBoundary>
              {currentView === 'dashboard' && (
                <DashboardView onOpenNewCaseModal={() => setIsNewCaseModalOpen(true)} />
              )}

              {currentView === 'cases' && <CaseListView />}

              {currentView === 'labs' && <LabListView />}

              {currentView === 'billing' && <BillingView />}

              {currentView === 'catalog' && <CatalogView />}

              {currentView === 'print' && <PrintStudioView />}

              {currentView === 'analytics' && <AnalyticsView />}

              {currentView === 'notifications' && <NotificationsView />}

              {currentView === 'settings' && <SettingsView />}
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
