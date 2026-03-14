/**
 * Middleware exports
 */
export {
  errorHandler,
  AppError,
  NotFoundError,
  ValidationError,
  setupGlobalErrorHandlers,
} from './error-handler';

export {
  performanceOptimization,
  compressionMiddleware,
  cacheMiddleware,
  performanceMonitoring,
  rateLimitMiddleware,
  connectionPooling,
} from './performance';
