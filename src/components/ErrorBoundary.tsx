import { Component, type ReactNode } from 'react';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center h-screen w-screen bg-[var(--bg)] text-[var(--text)] p-6"
        >
          <h1 className="text-lg font-semibold mb-2">Something went wrong</h1>
          <p className="text-sm text-[var(--text-muted)] mb-4 max-w-md text-center break-words">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload Extension
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
