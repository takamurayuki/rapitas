'use client';

import { useState } from 'react';
import { ArrowLeft, AlertCircle, Code, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { useErrorCapture } from '@/feature/developer-mode/hooks/useErrorCapture';
import { type ErrorAnalysis } from '@/feature/developer-mode/services/errorAnalysisService';
import Link from 'next/link';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ErrorDemoPage');

export default function ErrorDemoPage() {
  const t = useTranslations('settings');
  const [lastError, setLastError] = useState<ErrorAnalysis | null>(null);

  const { manualCaptureError } = useErrorCapture({
    captureConsoleErrors: true,
    captureUnhandledRejections: true,
    captureNetworkErrors: true,
    onError: (error) => {
      setLastError(error);
    },
  });

  // エラーを意図的に発生させる関数群
  const triggerSyntaxError = () => {
    try {
      // SyntaxErrorは実行時には発生しないので、evalを使用
      eval('const x = {');
    } catch (error) {
      manualCaptureError(
        'SyntaxError: Unexpected token',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };

  const triggerTypeError = () => {
    try {
      const obj = null as unknown as {
        someProperty: { doSomething: () => void };
      };
      // This will throw: Cannot read properties of null
      obj.someProperty.doSomething();
    } catch (error) {
      logger.error(error);
    }
  };

  const triggerNetworkError = async () => {
    try {
      await fetch('https://invalid-domain-that-does-not-exist.com/api/test');
    } catch (error) {
      // fetchのエラーはuseErrorCaptureが自動的にキャプチャします
    }
  };

  const triggerPromiseRejection = () => {
    // Unhandled promise rejection
    Promise.reject(
      new Error('Unhandled Promise Rejection: Database connection failed'),
    );
  };

  const triggerValidationError = () => {
    manualCaptureError(
      'ValidationError: Required field "email" is missing',
      undefined,
      {
        formData: { name: 'John Doe', email: null },
        endpoint: '/api/users/create',
      },
    );
  };

  const triggerTimeoutError = () => {
    manualCaptureError(
      'Timeout: Operation timed out after 30 seconds',
      undefined,
      {
        operation: 'fetchLargeDataset',
        timeoutMs: 30000,
        dataSize: '2.5GB',
      },
    );
  };

  const triggerDependencyError = () => {
    try {
      throw new Error("Cannot find module 'non-existent-module'");
    } catch (error) {
      logger.error(error);
    }
  };

  const triggerComplexError = () => {
    manualCaptureError(
      'P2002 Prisma Error: Unique constraint failed on the fields: (`email`)',
      undefined,
      {
        model: 'User',
        operation: 'create',
        fields: { email: 'user@example.com' },
        sqlQuery: 'INSERT INTO users (email, name) VALUES ($1, $2)',
      },
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/settings/developer-mode"
          className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('errorDemoBackToDevMode')}
        </Link>

        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-red-100 dark:bg-red-900/30 rounded-xl">
            <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {t('errorDemoTitle')}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t('errorDemoSubtitle')}
            </p>
          </div>
        </div>
      </div>

      {/* 最後にキャプチャされたエラー */}
      {lastError && (
        <Card className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
                {t('errorDemoCaptured')}
              </h3>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                {t('errorDemoCategory')}: {lastError.category} |{' '}
                {t('errorDemoSeverity')}: {lastError.severity}
              </p>
              <p className="text-sm mt-1 font-mono">{lastError.message}</p>
            </div>
          </div>
        </Card>
      )}

      {/* エラートリガーボタン */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <Code className="h-5 w-5 text-purple-500" />
            <h2 className="font-semibold">{t('errorDemoSyntaxRuntime')}</h2>
          </div>
          <div className="space-y-3">
            <Button
              onClickAction={triggerSyntaxError}
              variant="secondary"
              className="w-full justify-start"
            >
              {t('errorDemoSyntaxBtn')}
            </Button>
            <Button
              onClickAction={triggerTypeError}
              variant="secondary"
              className="w-full justify-start"
            >
              {t('errorDemoTypeBtn')}
            </Button>
            <Button
              onClickAction={triggerDependencyError}
              variant="secondary"
              className="w-full justify-start"
            >
              {t('errorDemoModuleBtn')}
            </Button>
          </div>
        </Card>

        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="h-5 w-5 text-blue-500" />
            <h2 className="font-semibold">{t('errorDemoNetworkAsync')}</h2>
          </div>
          <div className="space-y-3">
            <Button
              onClickAction={triggerNetworkError}
              variant="secondary"
              className="w-full justify-start"
            >
              {t('errorDemoNetworkBtn')}
            </Button>
            <Button
              onClickAction={triggerPromiseRejection}
              variant="secondary"
              className="w-full justify-start"
            >
              {t('errorDemoPromiseBtn')}
            </Button>
            <Button
              onClickAction={triggerTimeoutError}
              variant="secondary"
              className="w-full justify-start"
            >
              {t('errorDemoTimeoutBtn')}
            </Button>
          </div>
        </Card>

        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="h-5 w-5 text-orange-500" />
            <h2 className="font-semibold">{t('errorDemoValidationDb')}</h2>
          </div>
          <div className="space-y-3">
            <Button
              onClickAction={triggerValidationError}
              variant="secondary"
              className="w-full justify-start"
            >
              {t('errorDemoValidationBtn')}
            </Button>
            <Button
              onClickAction={triggerComplexError}
              variant="secondary"
              className="w-full justify-start"
            >
              {t('errorDemoPrismaBtn')}
            </Button>
          </div>
        </Card>

        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="h-5 w-5 text-red-500" />
            <h2 className="font-semibold">{t('errorDemoHowToUse')}</h2>
          </div>
          <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <p>{t('errorDemoStep1')}</p>
            <p>{t('errorDemoStep2')}</p>
            <p>{t('errorDemoStep3')}</p>
            <p className="mt-3 text-xs">{t('errorDemoNote')}</p>
          </div>
        </Card>
      </div>

      {/* 説明 */}
      <Card className="mt-6 p-6 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
        <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-2">
          {t('errorDemoAboutTitle')}
        </h3>
        <ul className="space-y-2 text-sm text-blue-700 dark:text-blue-300">
          <li>{t('errorDemoAbout1')}</li>
          <li>{t('errorDemoAbout2')}</li>
          <li>{t('errorDemoAbout3')}</li>
          <li>{t('errorDemoAbout4')}</li>
          <li>{t('errorDemoAbout5')}</li>
        </ul>
      </Card>
    </div>
  );
}
