/**
 * ErrorList
 *
 * Scrollable list of filtered ErrorAnalysis entries. Each row is expandable to show
 * stack trace, suggested fixes, documentation links, related errors, and action buttons.
 */

'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import Button from '@/components/ui/button/Button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  XCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Zap,
  Clock,
} from 'lucide-react';
import {
  ErrorAnalysis,
  ErrorCategory,
  ErrorSeverity,
} from '../../services/errorAnalysisService';

const severityConfig = {
  [ErrorSeverity.CRITICAL]: {
    color: 'bg-red-500 dark:bg-red-600',
    icon: XCircle,
    label: 'Critical',
  },
  [ErrorSeverity.HIGH]: {
    color: 'bg-orange-500 dark:bg-orange-600',
    icon: AlertCircle,
    label: 'High',
  },
  [ErrorSeverity.MEDIUM]: {
    color: 'bg-yellow-500 dark:bg-yellow-600',
    icon: AlertTriangle,
    label: 'Medium',
  },
  [ErrorSeverity.LOW]: {
    color: 'bg-blue-500 dark:bg-blue-600',
    icon: Info,
    label: 'Low',
  },
  [ErrorSeverity.INFO]: {
    color: 'bg-gray-500 dark:bg-gray-600',
    icon: Info,
    label: 'Info',
  },
};

const categoryColors: Record<ErrorCategory, string> = {
  [ErrorCategory.SYNTAX]: 'bg-purple-500',
  [ErrorCategory.RUNTIME]: 'bg-red-500',
  [ErrorCategory.NETWORK]: 'bg-blue-500',
  [ErrorCategory.PERMISSION]: 'bg-orange-500',
  [ErrorCategory.CONFIGURATION]: 'bg-green-500',
  [ErrorCategory.DEPENDENCY]: 'bg-indigo-500',
  [ErrorCategory.DATABASE]: 'bg-pink-500',
  [ErrorCategory.API]: 'bg-cyan-500',
  [ErrorCategory.VALIDATION]: 'bg-yellow-500',
  [ErrorCategory.TIMEOUT]: 'bg-gray-500',
  [ErrorCategory.UNKNOWN]: 'bg-gray-400',
};

type ErrorListProps = {
  /** Filtered list of errors to render. */
  errors: ErrorAnalysis[];
  /** Set of error IDs whose detail view is currently expanded. */
  expandedErrors: Set<string>;
  onToggleExpansion: (errorId: string) => void;
  onErrorSelect?: (error: ErrorAnalysis) => void;
};

/**
 * Renders the expandable list of recent errors.
 *
 * @param props - See ErrorListProps
 * @returns Card with a max-height scrollable error list.
 */
export function ErrorList({
  errors,
  expandedErrors,
  onToggleExpansion,
  onErrorSelect,
}: ErrorListProps) {
  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <div className="p-4 border-b dark:border-gray-700">
        <h3 className="text-lg font-semibold">Recent Errors ({errors.length})</h3>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        {errors.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <p>No errors found matching your criteria</p>
          </div>
        ) : (
          errors.map((error) => (
            <div
              key={error.id}
              className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <div
                className="p-4 cursor-pointer"
                onClick={() => onToggleExpansion(error.id)}
              >
                <div className="flex items-start space-x-3">
                  <button className="mt-1">
                    {expandedErrors.has(error.id) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>

                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      {React.createElement(severityConfig[error.severity].icon, {
                        className: `h-5 w-5 ${severityConfig[error.severity].color.replace('bg-', 'text-')}`,
                      })}
                      <Badge className={`${categoryColors[error.category]} text-white`}>
                        {error.category}
                      </Badge>
                      <Badge variant="default" className="text-xs">
                        {severityConfig[error.severity].label}
                      </Badge>
                      <span className="text-xs text-gray-500">
                        {error.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{error.message}</p>
                    {error.affectedTasks.length > 0 && (
                      <div className="flex items-center space-x-2 mt-2">
                        <Zap className="h-3 w-3 text-orange-500" />
                        <span className="text-xs text-gray-500">
                          Affects: {error.affectedTasks.map((t) => t.title).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {expandedErrors.has(error.id) && (
                  <div className="mt-4 ml-7 space-y-4">
                    {error.stackTrace && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Stack Trace</h4>
                        <pre className="text-xs bg-gray-100 dark:bg-gray-900 p-3 rounded overflow-x-auto">
                          {error.stackTrace}
                        </pre>
                      </div>
                    )}

                    {error.suggestedFixes.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Suggested Solutions</h4>
                        <ul className="space-y-2">
                          {error.suggestedFixes.map((fix, index) => (
                            <li key={index} className="flex items-start space-x-2">
                              <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                              <span className="text-sm">{fix}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {error.documentationLinks.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Documentation</h4>
                        <div className="space-y-1">
                          {error.documentationLinks.map((link, index) => (
                            <a
                              key={index}
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center space-x-2 text-sm text-blue-500 hover:text-blue-600"
                            >
                              <ExternalLink className="h-3 w-3" />
                              <span>{link}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {error.relatedErrors.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Related Errors</h4>
                        <div className="space-y-2">
                          {error.relatedErrors.slice(0, 3).map((relatedError) => (
                            <div
                              key={relatedError.id}
                              className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400"
                            >
                              <Clock className="h-3 w-3" />
                              <span>{relatedError.timestamp.toLocaleTimeString()}</span>
                              <span className="truncate">{relatedError.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center space-x-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClickAction={() => onErrorSelect?.(error)}
                      >
                        Investigate
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClickAction={() => {
                          navigator.clipboard.writeText(JSON.stringify(error, null, 2));
                        }}
                      >
                        Copy Details
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
