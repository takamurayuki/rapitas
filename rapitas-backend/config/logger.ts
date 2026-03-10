/**
 * 中央ロガーモジュール - pino ベース
 * 全てのログ出力はこのモジュール経由で行う
 */
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * ルートロガーインスタンス
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

/**
 * 名前付き子ロガーを生成
 */
export function createLogger(name: string): pino.Logger {
  return logger.child({ name });
}
