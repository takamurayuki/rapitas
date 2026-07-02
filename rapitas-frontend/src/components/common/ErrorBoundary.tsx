'use client';

import { Component, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  section?: string;
}

// NOTE: ErrorBoundaryInner is a class component (required for
// getDerivedStateFromError / componentDidCatch), so it cannot call the
// useTranslations hook itself. The functional ErrorBoundary wrapper below
// resolves the translated strings and passes them down as props.
interface ErrorBoundaryInnerProps extends ErrorBoundaryProps {
  errorTitle: string;
  unexpectedErrorText: string;
  retryText: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundaryInner extends Component<ErrorBoundaryInnerProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryInnerProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(
      `[ErrorBoundary${this.props.section ? `:${this.props.section}` : ''}]`,
      error,
      errorInfo,
    );
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
          <p className="mb-2 text-sm font-medium text-red-800 dark:text-red-300">
            {this.props.errorTitle}
          </p>
          <p className="mb-3 text-xs text-red-600 dark:text-red-400">
            {this.state.error?.message || this.props.unexpectedErrorText}
          </p>
          <button
            onClick={this.handleReset}
            className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
          >
            {this.props.retryText}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export function ErrorBoundary(props: ErrorBoundaryProps) {
  const t = useTranslations('common');
  const errorTitle = props.section
    ? t('errorBoundary.sectionError', { section: props.section })
    : t('errorBoundary.genericError');

  return (
    <ErrorBoundaryInner
      {...props}
      errorTitle={errorTitle}
      unexpectedErrorText={t('errorBoundary.unexpectedError')}
      retryText={t('retry')}
    />
  );
}
