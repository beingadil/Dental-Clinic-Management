import React, { ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RotateCcw, Copy, Check } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

/**
 * ErrorBoundary with a "copy error details" button.
 *
 * The previous version showed the error message in a <pre> and offered
 * "Try Again" and "Reload". That is enough to recover, but not enough to
 * REPORT: an operator who hits a crash has no way to tell the developer what
 * happened, and the message alone ("Cannot read properties of undefined") is
 * usually not enough to find the cause. The component stack and the full stack
 * trace are the parts that matter, and they were being discarded.
 *
 * The "copy" button puts the whole thing on the clipboard in a format that
 * can be pasted into an issue or an email without further editing.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false
    };
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('ErrorBoundary handled error in component tree:', error?.message || error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
  };

  private handleClearData = () => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        Object.keys(localStorage).forEach((key) => {
          if (key && key.startsWith('dsw_')) {
            localStorage.removeItem(key);
          }
        });
      }
    } catch (e) {
      console.warn('Error clearing storage:', e);
    }
    window.location.reload();
  };

  private handleCopy = async () => {
    const { error, errorInfo } = this.state;
    if (!error) return;
    const text = [
      'Dental Solutions — error report',
      '================================',
      `Time: ${new Date().toISOString()}`,
      `URL: ${typeof window !== 'undefined' ? window.location.href : '(unknown)'}`,
      `User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : '(unknown)'}`,
      '',
      'Error:',
      error.name + ': ' + (error.message || String(error)),
      '',
      'Stack:',
      error.stack || '(no stack)',
      '',
      'Component stack:',
      errorInfo?.componentStack || '(no component stack)',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 2500);
    } catch {
      // Clipboard API unavailable (insecure context, or permission denied).
      // Fall back to a prompt so the text is still selectable.
      window.prompt('Copy the error details below:', text);
    }
  };

  public render() {
    if (this.state.hasError) {
      const { error, copied } = this.state;
      return (
        <div className="min-h-[400px] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-xl p-8 text-center">
            <div className="w-14 h-14 bg-rose-50 text-ink-danger rounded-2xl flex items-center justify-center mx-auto mb-4">
              <AlertOctagon className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">View Render Issue Encountered</h2>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              The workstation encountered an unexpected runtime condition in this module. Your data in storage is intact.
            </p>
            {error && (
              <pre className="text-left text-xs bg-slate-50 border border-slate-200 p-3 rounded-lg text-slate-700 overflow-x-auto mb-6 max-h-32">
                {error.message || String(error)}
              </pre>
            )}
            <div className="flex flex-wrap gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                className="px-4 py-2 text-sm font-semibold ds-glass-pill flex items-center gap-2 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Reload Application
              </button>
              <button
                onClick={this.handleCopy}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center gap-2 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy error details'}
              </button>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100">
              <button
                onClick={this.handleClearData}
                className="text-xs text-ink-muted hover:text-ink-danger font-medium transition-colors cursor-pointer"
              >
                Reset workstation local storage cache
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}