import { useEffect, useCallback, useRef } from 'react';
import type { ErrorInfo } from 'react';
import {
  errorAnalysisService,
  type ErrorAnalysis,
} from '../services/errorAnalysisService';
import { type Task, type AgentSession } from '@/types';

interface UseErrorCaptureOptions {
  captureConsoleErrors?: boolean;
  captureUnhandledRejections?: boolean;
  captureNetworkErrors?: boolean;
  currentTask?: Task;
  currentAgent?: AgentSession;
  onError?: (error: ErrorAnalysis) => void;
}

export function useErrorCapture({
  captureConsoleErrors = true,
  captureUnhandledRejections = true,
  captureNetworkErrors = true,
  currentTask,
  currentAgent,
  onError,
}: UseErrorCaptureOptions = {}) {
  const originalConsoleError = useRef<typeof console.error>(console.error);
  const fetchInterceptorApplied = useRef(false);

  const captureError = useCallback(
    (
      message: string,
      context?: {
        stackTrace?: string;
        userAction?: string;
        systemState?: Record<string, unknown>;
      },
    ) => {
      const analysis = errorAnalysisService.analyzeError(message, {
        ...context,
        task: currentTask,
        agent: currentAgent,
      });

      onError?.(analysis);
      return analysis;
    },
    [currentTask, currentAgent, onError],
  );

  // Capture console errors
  useEffect(() => {
    if (!captureConsoleErrors) return;

    originalConsoleError.current = console.error;

    console.error = function (...args: unknown[]) {
      // Call original console.error
      originalConsoleError.current?.apply(console, args);

      // Capture the error
      const message = args
        .map((arg) => {
          if (arg instanceof Error) {
            return arg.message;
          }
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(' ');

      const error = args.find((arg) => arg instanceof Error);

      captureError(message, {
        stackTrace: error?.stack,
        userAction: 'Console error logged',
      });
    };

    return () => {
      if (originalConsoleError.current) {
        console.error = originalConsoleError.current;
      }
    };
  }, [captureConsoleErrors, captureError]);

  // Capture unhandled promise rejections
  useEffect(() => {
    if (!captureUnhandledRejections) return;

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason);

      captureError(`Unhandled Promise Rejection: ${message}`, {
        stackTrace:
          event.reason instanceof Error ? event.reason.stack : undefined,
        userAction: 'Promise rejection',
        systemState: { promise: event.promise },
      });
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener(
        'unhandledrejection',
        handleUnhandledRejection,
      );
    };
  }, [captureUnhandledRejections, captureError]);

  // Capture window errors
  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      captureError(event.message, {
        stackTrace: event.error?.stack,
        userAction: 'Window error',
        systemState: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    };

    window.addEventListener('error', handleWindowError);

    return () => {
      window.removeEventListener('error', handleWindowError);
    };
  }, [captureError]);

  // Capture network errors
  useEffect(() => {
    if (!captureNetworkErrors || fetchInterceptorApplied.current) return;

    const originalFetch = window.fetch;

    window.fetch = async function (...args: Parameters<typeof fetch>) {
      try {
        const response = await originalFetch.apply(window, args);

        if (!response.ok) {
          const url =
            typeof args[0] === 'string'
              ? args[0]
              : args[0] instanceof URL
                ? args[0].href
                : (args[0] as Request).url;
          captureError(
            `Network request failed: ${response.status} ${response.statusText}`,
            {
              userAction: 'Network request',
              systemState: {
                url,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
              },
            },
          );
        }

        return response;
      } catch (error) {
        const url =
          typeof args[0] === 'string'
            ? args[0]
            : args[0] instanceof URL
              ? args[0].href
              : (args[0] as Request).url;
        captureError(
          `Network request error: ${error instanceof Error ? error.message : String(error)}`,
          {
            stackTrace: error instanceof Error ? error.stack : undefined,
            userAction: 'Network request',
            systemState: { url },
          },
        );
        throw error;
      }
    };

    fetchInterceptorApplied.current = true;

    return () => {
      // Note: In a real app, we'd need a more sophisticated way to restore fetch
      // This is simplified for the example
    };
  }, [captureNetworkErrors, captureError]);

  // Capture React errors (if in a React Error Boundary)
  const captureReactError = useCallback(
    (error: Error, errorInfo: ErrorInfo) => {
      captureError(`React Error: ${error.message}`, {
        stackTrace: error.stack,
        userAction: 'React component error',
        systemState: {
          componentStack: errorInfo.componentStack,
        },
      });
    },
    [captureError],
  );

  // Manual error capture function
  const manualCaptureError = useCallback(
    (
      message: string,
      error?: Error,
      additionalContext?: Record<string, unknown>,
    ) => {
      return captureError(message, {
        stackTrace: error?.stack,
        systemState: additionalContext,
      });
    },
    [captureError],
  );

  return {
    captureReactError,
    manualCaptureError,
    analyzeError: errorAnalysisService.analyzeError.bind(errorAnalysisService),
    getErrorSummary:
      errorAnalysisService.getErrorSummary.bind(errorAnalysisService),
    clearErrorHistory:
      errorAnalysisService.clearErrorHistory.bind(errorAnalysisService),
    exportErrorLog:
      errorAnalysisService.exportErrorLog.bind(errorAnalysisService),
  };
}
