import { Component, type ErrorInfo, type ReactNode } from 'react';
import { InternetErrorScreen } from './ErrorScreens';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary] Caught error in ${this.props.name || 'Component'}:`, error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    try {
      window.location.href = '/chat';
    } catch {
      window.location.reload();
    }
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errMsg = (this.state.error?.message || '').toLowerCase();
      const isNetworkIssue =
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        errMsg.includes('network') ||
        errMsg.includes('failed to fetch') ||
        errMsg.includes('timeout') ||
        errMsg.includes('offline');

      if (isNetworkIssue) {
        return <InternetErrorScreen onRetry={this.handleReload} />;
      }

      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: '#000000',
            color: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            zIndex: 99999,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              backgroundColor: '#1e1e1e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              fontSize: 26,
            }}
          >
            ⚠️
          </div>

          <h2 style={{ margin: '0 0 8px 0', fontSize: 20, fontWeight: 700 }}>
            Something went wrong
          </h2>
          <p
            style={{
              margin: '0 0 24px 0',
              fontSize: 14,
              color: '#aaaaaa',
              maxWidth: 320,
              lineHeight: 1.4,
            }}
          >
            An unexpected error occurred. Tap below to reload and continue chatting.
          </p>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                backgroundColor: '#ffffff',
                color: '#000000',
                border: 'none',
                borderRadius: 999,
                padding: '12px 24px',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Restart App
            </button>
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                backgroundColor: '#222222',
                color: '#ffffff',
                border: '1px solid #333333',
                borderRadius: 999,
                padding: '12px 20px',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          </div>

          {this.state.error && (
            <div
              style={{
                marginTop: 24,
                maxWidth: '90%',
                maxHeight: 120,
                overflowY: 'auto',
                backgroundColor: '#111111',
                padding: 12,
                borderRadius: 8,
                fontSize: 11,
                color: '#ff6b6b',
                textAlign: 'left',
                fontFamily: 'monospace',
                wordBreak: 'break-all',
              }}
            >
              {this.state.error.message}
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
