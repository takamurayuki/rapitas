/**
 * DevToolsSection
 *
 * Renders the developer tools section, including the CLI management link
 * and the external integrations panel (Webhook + MCP).
 */
'use client';

import { useTranslations } from 'next-intl';
import { Terminal, ChevronRight } from 'lucide-react';
import { WebhookSettings } from '@/components/settings/WebhookSettings';
import { MCPSetupGuide } from '@/components/settings/MCPSetupGuide';

/**
 * Developer tools and integrations panels.
 */
export function DevToolsSection() {
  const t = useTranslations('settings');

  return (
    <>
      {/* CLI tools panel */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-zinc-400" />
            <div>
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                {t('devTools')}
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                {t('cliSetup')}
              </p>
            </div>
          </div>
        </div>
        <div className="p-6">
          <a
            href="/settings/cli-tools"
            className="block group p-4 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <Terminal className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="font-medium text-zinc-900 dark:text-zinc-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {t('cliManagement')}
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {t('cliDescription')}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" />
            </div>
          </a>
        </div>
      </div>

      {/* Integrations panel */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs dark:shadow-2xl dark:shadow-black/50 overflow-hidden">
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
            外部連携
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            Webhook通知とIDE統合の設定
          </p>
        </div>
        <div className="p-6 space-y-6">
          <WebhookSettings />
          <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
            <MCPSetupGuide />
          </div>
        </div>
      </div>
    </>
  );
}
