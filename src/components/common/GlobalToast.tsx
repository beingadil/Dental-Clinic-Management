import React from 'react';
import { useApp } from '../../context/AppContext';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export const GlobalToast: React.FC = () => {
  const { toast, hideToast } = useApp();

  if (!toast) return null;

  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />,
    error: <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />,
    warning: <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />,
    info: <Info className="w-5 h-5 text-indigo-600 flex-shrink-0" />
  };

  const bgStyles = {
    success: 'bg-emerald-50/95 border-emerald-200 text-emerald-950',
    error: 'bg-rose-50/95 border-rose-200 text-rose-950',
    warning: 'bg-amber-50/95 border-amber-200 text-amber-950',
    info: 'bg-indigo-50/95 border-indigo-200 text-indigo-950'
  };

  return (
    <aside aria-label="Notification" className="fixed bottom-5 right-5 z-[9999] max-w-md w-full animate-in fade-in slide-in-from-bottom-3 duration-200">
      <div
        id="global-toast-container"
        className={`flex items-start gap-3 p-4 rounded-xl border shadow-xl backdrop-blur-md ${bgStyles[toast.type || 'info']}`}
      >
        {icons[toast.type || 'info']}
        <div className="flex-1 text-sm font-medium leading-relaxed pr-2">
          {toast.message}
        </div>
        <button
          id="global-toast-close-btn"
          onClick={hideToast}
          className="p-1 -mr-1 -mt-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 transition-colors"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
