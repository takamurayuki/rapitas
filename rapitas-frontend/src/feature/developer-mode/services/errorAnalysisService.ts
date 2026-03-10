import { type Task, type AgentSession } from '@/types';

export interface ErrorPattern {
  pattern: RegExp;
  category: ErrorCategory;
  severity: ErrorSeverity;
  commonCauses: string[];
  suggestedFixes: string[];
  documentationLinks?: string[];
}

export enum ErrorCategory {
  SYNTAX = 'syntax',
  RUNTIME = 'runtime',
  NETWORK = 'network',
  PERMISSION = 'permission',
  CONFIGURATION = 'configuration',
  DEPENDENCY = 'dependency',
  DATABASE = 'database',
  API = 'api',
  VALIDATION = 'validation',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown',
}

export enum ErrorSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info',
}

export interface ErrorAnalysis {
  id: string;
  timestamp: Date;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  stackTrace?: string;
  affectedTasks: Task[];
  affectedAgents: AgentSession[];
  suggestedFixes: string[];
  documentationLinks: string[];
  relatedErrors: ErrorAnalysis[];
  context: {
    environment?: string;
    userAction?: string;
    systemState?: Record<string, unknown>;
  };
}

export interface ErrorSummary {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  errorTrends: {
    timestamp: Date;
    count: number;
  }[];
  mostCommonErrors: {
    message: string;
    count: number;
    category: ErrorCategory;
  }[];
}

class ErrorAnalysisService {
  private errorPatterns: ErrorPattern[] = [
    // JavaScript/TypeScript Syntax Errors
    {
      pattern: /SyntaxError: Unexpected token/i,
      category: ErrorCategory.SYNTAX,
      severity: ErrorSeverity.HIGH,
      commonCauses: [
        'Missing semicolon',
        'Unclosed bracket or parenthesis',
        'Invalid JSON',
      ],
      suggestedFixes: [
        'Check for missing semicolons',
        'Verify all brackets and parentheses are properly closed',
        'Validate JSON syntax using a JSON validator',
        'Look for trailing commas in objects or arrays',
      ],
      documentationLinks: [
        'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Unexpected_token',
      ],
    },
    {
      pattern: /TypeError: Cannot read prop/i,
      category: ErrorCategory.RUNTIME,
      severity: ErrorSeverity.HIGH,
      commonCauses: [
        'Accessing property of undefined/null',
        'Async data not loaded',
      ],
      suggestedFixes: [
        'Add null/undefined checks before accessing properties',
        'Use optional chaining (?.) operator',
        'Ensure async data is loaded before access',
        'Initialize variables with default values',
      ],
      documentationLinks: [
        'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Cant_access_property',
      ],
    },

    // Network Errors
    {
      pattern: /Failed to fetch|NetworkError|ERR_NETWORK/i,
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.HIGH,
      commonCauses: [
        'Server is down',
        'CORS issues',
        'No internet connection',
        'Firewall blocking',
      ],
      suggestedFixes: [
        'Check if the backend server is running',
        'Verify CORS configuration on the server',
        'Check internet connectivity',
        'Verify API endpoint URLs are correct',
        'Check for proxy or firewall issues',
      ],
      documentationLinks: [
        'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#checking_that_the_fetch_was_successful',
      ],
    },
    {
      pattern: /CORS|Cross-Origin Request Blocked/i,
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.HIGH,
      commonCauses: [
        'Missing CORS headers',
        'Different origin requests',
        'Credentials not included',
      ],
      suggestedFixes: [
        'Configure CORS headers on the backend',
        'Add Access-Control-Allow-Origin header',
        'Include credentials in fetch options if needed',
        'Use a proxy for development',
      ],
      documentationLinks: [
        'https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS',
      ],
    },

    // Database Errors
    {
      pattern: /P\d{4}|Prisma.*Error/i,
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.HIGH,
      commonCauses: [
        'Database connection issues',
        'Invalid schema',
        'Constraint violations',
      ],
      suggestedFixes: [
        'Run "prisma db push" to sync schema',
        'Check database connection string',
        'Verify unique constraints are not violated',
        'Ensure required fields are provided',
        'Check foreign key relationships',
      ],
      documentationLinks: [
        'https://www.prisma.io/docs/reference/api-reference/error-reference',
      ],
    },

    // Permission Errors
    {
      pattern: /Permission denied|Access denied|Unauthorized/i,
      category: ErrorCategory.PERMISSION,
      severity: ErrorSeverity.HIGH,
      commonCauses: [
        'Missing authentication',
        'Expired token',
        'Insufficient privileges',
      ],
      suggestedFixes: [
        'Check if user is authenticated',
        'Verify authentication token is valid',
        'Check user permissions and roles',
        'Ensure API key is correctly configured',
      ],
      documentationLinks: [
        'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/401',
      ],
    },

    // Timeout Errors
    {
      pattern: /Timeout|timed out|ETIMEDOUT/i,
      category: ErrorCategory.TIMEOUT,
      severity: ErrorSeverity.MEDIUM,
      commonCauses: [
        'Slow network',
        'Server overload',
        'Long-running operations',
      ],
      suggestedFixes: [
        'Increase timeout duration',
        'Optimize server-side operations',
        'Implement pagination for large datasets',
        'Add loading states and retry mechanisms',
        'Check network latency',
      ],
    },

    // Validation Errors
    {
      pattern: /ValidationError|Invalid input|Required field/i,
      category: ErrorCategory.VALIDATION,
      severity: ErrorSeverity.MEDIUM,
      commonCauses: [
        'Missing required fields',
        'Invalid data format',
        'Type mismatches',
      ],
      suggestedFixes: [
        'Check all required fields are provided',
        'Validate data types match schema',
        'Ensure date formats are correct',
        'Verify email/URL formats are valid',
      ],
    },

    // Dependency Errors
    {
      pattern: /Cannot find module|Module not found|Cannot resolve/i,
      category: ErrorCategory.DEPENDENCY,
      severity: ErrorSeverity.HIGH,
      commonCauses: [
        'Missing npm packages',
        'Incorrect import paths',
        'Build cache issues',
      ],
      suggestedFixes: [
        'Run "npm install" or "bun install"',
        'Check import paths are correct',
        'Clear node_modules and reinstall',
        'Verify package.json dependencies',
        'Check for typos in import statements',
      ],
      documentationLinks: [
        'https://nodejs.org/api/modules.html#modules_all_together',
      ],
    },
  ];

  private errorHistory: ErrorAnalysis[] = [];
  private errorCounts: Map<string, number> = new Map();

  public analyzeError(
    errorMessage: string,
    context?: {
      stackTrace?: string;
      task?: Task;
      agent?: AgentSession;
      userAction?: string;
      systemState?: Record<string, unknown>;
    },
  ): ErrorAnalysis {
    const analysis: ErrorAnalysis = {
      id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      message: errorMessage,
      stackTrace: context?.stackTrace,
      affectedTasks: context?.task ? [context.task] : [],
      affectedAgents: context?.agent ? [context.agent] : [],
      suggestedFixes: [],
      documentationLinks: [],
      relatedErrors: [],
      context: {
        userAction: context?.userAction,
        systemState: context?.systemState,
      },
    };

    // Match error patterns
    for (const pattern of this.errorPatterns) {
      if (pattern.pattern.test(errorMessage)) {
        analysis.category = pattern.category;
        analysis.severity = pattern.severity;
        analysis.suggestedFixes = [...pattern.suggestedFixes];
        analysis.documentationLinks = pattern.documentationLinks || [];
        break;
      }
    }

    // Extract additional context from stack trace
    if (context?.stackTrace) {
      analysis.suggestedFixes.push(
        ...this.analyzeStackTrace(context.stackTrace),
      );
    }

    // Find related errors
    analysis.relatedErrors = this.findRelatedErrors(analysis);

    // Update error history
    this.errorHistory.unshift(analysis);
    if (this.errorHistory.length > 1000) {
      this.errorHistory = this.errorHistory.slice(0, 1000);
    }

    // Update error counts
    const errorKey = `${analysis.category}:${analysis.message.substring(0, 50)}`;
    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);

    return analysis;
  }

  private analyzeStackTrace(stackTrace: string): string[] {
    const suggestions: string[] = [];

    // Check for specific file patterns
    if (stackTrace.includes('node_modules')) {
      suggestions.push(
        'Error originates from a third-party package - check package documentation',
      );
    }

    if (stackTrace.includes('async') || stackTrace.includes('Promise')) {
      suggestions.push(
        'This is an asynchronous error - check Promise handling and async/await usage',
      );
    }

    // Extract file locations
    const fileMatches = stackTrace.match(/at .* \((.*?:\d+:\d+)\)/g);
    if (fileMatches && fileMatches.length > 0) {
      suggestions.push(
        `Check the following files: ${fileMatches.slice(0, 3).join(', ')}`,
      );
    }

    return suggestions;
  }

  private findRelatedErrors(currentError: ErrorAnalysis): ErrorAnalysis[] {
    return this.errorHistory
      .filter((error) => {
        // Same category
        if (
          error.category === currentError.category &&
          error.id !== currentError.id
        ) {
          return true;
        }
        // Similar message
        if (
          this.calculateSimilarity(error.message, currentError.message) > 0.7
        ) {
          return true;
        }
        // Same affected components
        if (
          error.affectedTasks.some((task) =>
            currentError.affectedTasks.some(
              (currentTask) => currentTask.id === task.id,
            ),
          )
        ) {
          return true;
        }
        return false;
      })
      .slice(0, 5);
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const words1 = str1.toLowerCase().split(/\s+/);
    const words2 = str2.toLowerCase().split(/\s+/);
    const intersection = words1.filter((word) => words2.includes(word));
    return intersection.length / Math.max(words1.length, words2.length);
  }

  public getErrorSummary(timeRange?: { start: Date; end: Date }): ErrorSummary {
    const filteredErrors = timeRange
      ? this.errorHistory.filter(
          (error) =>
            error.timestamp >= timeRange.start &&
            error.timestamp <= timeRange.end,
        )
      : this.errorHistory;

    const errorsByCategory: Record<ErrorCategory, number> = {} as Record<
      ErrorCategory,
      number
    >;
    const errorsBySeverity: Record<ErrorSeverity, number> = {} as Record<
      ErrorSeverity,
      number
    >;

    // Initialize counts
    Object.values(ErrorCategory).forEach((category) => {
      errorsByCategory[category] = 0;
    });
    Object.values(ErrorSeverity).forEach((severity) => {
      errorsBySeverity[severity] = 0;
    });

    // Count errors
    filteredErrors.forEach((error) => {
      errorsByCategory[error.category]++;
      errorsBySeverity[error.severity]++;
    });

    // Calculate trends (hourly for last 24 hours)
    const now = new Date();
    const errorTrends = [];
    for (let i = 23; i >= 0; i--) {
      const hourStart = new Date(now.getTime() - i * 60 * 60 * 1000);
      const hourEnd = new Date(now.getTime() - (i - 1) * 60 * 60 * 1000);
      const count = this.errorHistory.filter(
        (error) => error.timestamp >= hourStart && error.timestamp < hourEnd,
      ).length;
      errorTrends.push({ timestamp: hourStart, count });
    }

    // Get most common errors
    const mostCommonErrors = Array.from(this.errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => {
        const [category, message] = key.split(':');
        return {
          message,
          count,
          category: category as ErrorCategory,
        };
      });

    return {
      totalErrors: filteredErrors.length,
      errorsByCategory,
      errorsBySeverity,
      errorTrends,
      mostCommonErrors,
    };
  }

  public clearErrorHistory(): void {
    this.errorHistory = [];
    this.errorCounts.clear();
  }

  public exportErrorLog(): string {
    return JSON.stringify(
      {
        exportDate: new Date().toISOString(),
        summary: this.getErrorSummary(),
        errors: this.errorHistory.slice(0, 100), // Export last 100 errors
      },
      null,
      2,
    );
  }
}

export const errorAnalysisService = new ErrorAnalysisService();
