'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import Button from '@/components/ui/button/Button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  XCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Search,
  Download,
  RefreshCw,
  ExternalLink,
  Zap,
  Clock,
  TrendingUp,
  TrendingDown,
  FlaskConical
} from 'lucide-react';
import {
  errorAnalysisService,
  ErrorAnalysis,
  ErrorCategory,
  ErrorSeverity,
  ErrorSummary
} from '../services/errorAnalysisService';
import { Task, AgentSession } from '@/types';

interface ErrorAnalysisPanelProps {
  currentTask?: Task;
  currentAgent?: AgentSession;
  onErrorSelect?: (error: ErrorAnalysis) => void;
}

const severityConfig = {
  [ErrorSeverity.CRITICAL]: {
    color: 'bg-red-500 dark:bg-red-600',
    icon: XCircle,
    label: 'Critical'
  },
  [ErrorSeverity.HIGH]: {
    color: 'bg-orange-500 dark:bg-orange-600',
    icon: AlertCircle,
    label: 'High'
  },
  [ErrorSeverity.MEDIUM]: {
    color: 'bg-yellow-500 dark:bg-yellow-600',
    icon: AlertTriangle,
    label: 'Medium'
  },
  [ErrorSeverity.LOW]: {
    color: 'bg-blue-500 dark:bg-blue-600',
    icon: Info,
    label: 'Low'
  },
  [ErrorSeverity.INFO]: {
    color: 'bg-gray-500 dark:bg-gray-600',
    icon: Info,
    label: 'Info'
  }
};

const categoryColors = {
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
  [ErrorCategory.UNKNOWN]: 'bg-gray-400'
};

export const ErrorAnalysisPanel: React.FC<ErrorAnalysisPanelProps> = ({
  currentTask,
  currentAgent,
  onErrorSelect
}) => {
  const [errors, setErrors] = useState<ErrorAnalysis[]>([]);
  const [summary, setSummary] = useState<ErrorSummary | null>(null);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ErrorCategory | 'all'>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<ErrorSeverity | 'all'>('all');
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);

  // Simulate error detection from console/logs
  useEffect(() => {
    if (!isAutoRefresh) return;

    const interval = setInterval(() => {
      // In a real implementation, this would capture actual console errors
      // For now, we'll simulate with the current task/agent context
      if (currentAgent?.status === 'failed') {
        const error = errorAnalysisService.analyzeError(
          currentAgent?.errorMessage || 'Unknown error occurred',
          {
            task: currentTask,
            agent: currentAgent
          }
        );
        setErrors(prev => [error, ...prev].slice(0, 100));
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [currentTask, currentAgent, isAutoRefresh]);

  const refreshSummary = useCallback(() => {
    const newSummary = errorAnalysisService.getErrorSummary();
    setSummary(newSummary);
  }, []);

  useEffect(() => {
    refreshSummary();
    const interval = setInterval(refreshSummary, 5000);
    return () => clearInterval(interval);
  }, [refreshSummary]);

  const toggleErrorExpansion = (errorId: string) => {
    setExpandedErrors(prev => {
      const newSet = new Set(prev);
      if (newSet.has(errorId)) {
        newSet.delete(errorId);
      } else {
        newSet.add(errorId);
      }
      return newSet;
    });
  };

  const filteredErrors = errors.filter(error => {
    const matchesSearch = searchQuery
      ? error.message.toLowerCase().includes(searchQuery.toLowerCase())
      : true;
    const matchesCategory = selectedCategory === 'all' || error.category === selectedCategory;
    const matchesSeverity = selectedSeverity === 'all' || error.severity === selectedSeverity;
    return matchesSearch && matchesCategory && matchesSeverity;
  });

  const exportErrorLog = () => {
    const logData = errorAnalysisService.exportErrorLog();
    const blob = new Blob([logData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `error-log-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!summary) return null;

  return (
    <div className="space-y-6">
      {/* Header with Demo Link */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">エラー解析ダッシュボード</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            リアルタイムでエラーを検出し、解決策を提案します
          </p>
        </div>
        <a
          href="/settings/developer-mode/error-demo"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
        >
          <FlaskConical className="h-4 w-4" />
          エラーデモを試す
        </a>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Errors</p>
              <p className="text-2xl font-bold">{summary.totalErrors}</p>
            </div>
            <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded-lg">
              <AlertCircle className="h-6 w-6 text-red-500" />
            </div>
          </div>
        </Card>

        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Critical Issues</p>
              <p className="text-2xl font-bold">
                {summary.errorsBySeverity[ErrorSeverity.CRITICAL] || 0}
              </p>
            </div>
            <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded-lg">
              <XCircle className="h-6 w-6 text-red-500" />
            </div>
          </div>
        </Card>

        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Error Rate</p>
              <div className="flex items-center space-x-1">
                <p className="text-2xl font-bold">
                  {summary.errorTrends[summary.errorTrends.length - 1]?.count || 0}
                </p>
                <span className="text-sm text-gray-500">/hr</span>
              </div>
            </div>
            <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
              <TrendingUp className="h-6 w-6 text-blue-500" />
            </div>
          </div>
        </Card>

        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Resolution Rate</p>
              <p className="text-2xl font-bold">87%</p>
            </div>
            <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
              <CheckCircle className="h-6 w-6 text-green-500" />
            </div>
          </div>
        </Card>
      </div>

      {/* Error Trends Chart */}
      <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-4">Error Trends (Last 24 Hours)</h3>
        <div className="h-32 flex items-end space-x-1">
          {summary.errorTrends.map((trend, index) => (
            <div
              key={index}
              className="flex-1 bg-blue-500 dark:bg-blue-600 rounded-t hover:bg-blue-600 dark:hover:bg-blue-700 transition-colors"
              style={{
                height: `${Math.max(5, (trend.count / Math.max(...summary.errorTrends.map(t => t.count))) * 100)}%`
              }}
              title={`${trend.timestamp.toLocaleTimeString()}: ${trend.count} errors`}
            />
          ))}
        </div>
      </Card>

      {/* Filters and Actions */}
      <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search errors..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              />
            </div>
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as ErrorCategory | 'all')}
            className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="all">All Categories</option>
            {Object.values(ErrorCategory).map(category => (
              <option key={category} value={category}>
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </option>
            ))}
          </select>

          <select
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value as ErrorSeverity | 'all')}
            className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="all">All Severities</option>
            {Object.values(ErrorSeverity).map(severity => (
              <option key={severity} value={severity}>
                {severity.charAt(0).toUpperCase() + severity.slice(1)}
              </option>
            ))}
          </select>

          <Button
            onClick={() => setIsAutoRefresh(!isAutoRefresh)}
            variant={isAutoRefresh ? 'primary' : 'secondary'}
            size="sm"
          >
            <RefreshCw className={`h-4 w-4 ${isAutoRefresh ? 'animate-spin' : ''}`} />
          </Button>

          <Button onClick={exportErrorLog} variant="secondary" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export Log
          </Button>
        </div>
      </Card>

      {/* Most Common Errors */}
      <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-4">Most Common Errors</h3>
        <div className="space-y-3">
          {summary.mostCommonErrors.map((error, index) => (
            <div key={index} className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Badge className={`${categoryColors[error.category]} text-white`}>
                  {error.category}
                </Badge>
                <span className="text-sm">{error.message}</span>
              </div>
              <span className="text-sm font-semibold">{error.count} times</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Error List */}
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <div className="p-4 border-b dark:border-gray-700">
          <h3 className="text-lg font-semibold">Recent Errors ({filteredErrors.length})</h3>
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          {filteredErrors.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <p>No errors found matching your criteria</p>
            </div>
          ) : (
            filteredErrors.map((error) => (
              <div
                key={error.id}
                className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div
                  className="p-4 cursor-pointer"
                  onClick={() => toggleErrorExpansion(error.id)}
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
                        {React.createElement(
                          severityConfig[error.severity].icon,
                          { className: `h-5 w-5 ${severityConfig[error.severity].color.replace('bg-', 'text-')}` }
                        )}
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
                            Affects: {error.affectedTasks.map(t => t.title).join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {expandedErrors.has(error.id) && (
                    <div className="mt-4 ml-7 space-y-4">
                      {/* Stack Trace */}
                      {error.stackTrace && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2">Stack Trace</h4>
                          <pre className="text-xs bg-gray-100 dark:bg-gray-900 p-3 rounded overflow-x-auto">
                            {error.stackTrace}
                          </pre>
                        </div>
                      )}

                      {/* Suggested Fixes */}
                      {error.suggestedFixes.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2">Suggested Solutions</h4>
                          <ul className="space-y-2">
                            {error.suggestedFixes.map((fix, index) => (
                              <li key={index} className="flex items-start space-x-2">
                                <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                                <span className="text-sm">{fix}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Documentation Links */}
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

                      {/* Related Errors */}
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

                      {/* Actions */}
                      <div className="flex items-center space-x-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onErrorSelect?.(error)}
                        >
                          Investigate
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
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
    </div>
  );
};