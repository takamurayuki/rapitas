'use client';

import { Settings, Code, GraduationCap, Layers } from 'lucide-react';
import { useAppModeStore, type AppMode } from '@/stores/appModeStore';

const MODE_OPTIONS: {
  value: AppMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    value: 'all',
    label: 'すべて表示',
    description: '開発・学習の両方のナビゲーションを表示します',
    icon: Layers,
  },
  {
    value: 'development',
    label: '開発モード',
    description:
      'GitHub連携・エージェント管理など開発関連のナビゲーションのみ表示します',
    icon: Code,
  },
  {
    value: 'learning',
    label: '学習モード',
    description:
      '試験目標・学習目標・フラッシュカードなど学習関連のナビゲーションのみ表示します',
    icon: GraduationCap,
  },
];

export default function GeneralSettingsPage() {
  const { mode, setMode } = useAppModeStore();

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
          <Settings className="w-6 h-6 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            全体設定
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            アプリケーション全体の表示・動作を管理
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* 表示モード設定 */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <Layers className="w-5 h-5 text-zinc-400" />
              <div>
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  表示モード
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                  ナビゲーションに表示する項目を用途に応じて切り替えます
                </p>
              </div>
            </div>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = mode === option.value;

                return (
                  <button
                    key={option.value}
                    onClick={() => setMode(option.value)}
                    className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                      isSelected
                        ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-violet-300 dark:hover:border-violet-700 bg-white dark:bg-zinc-800'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute top-2 right-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                      </div>
                    )}
                    <Icon
                      className={`w-6 h-6 mb-2 ${
                        isSelected
                          ? 'text-violet-600 dark:text-violet-400'
                          : 'text-zinc-400 dark:text-zinc-500'
                      }`}
                    />
                    <h3
                      className={`font-medium text-sm ${
                        isSelected
                          ? 'text-violet-700 dark:text-violet-300'
                          : 'text-zinc-900 dark:text-zinc-100'
                      }`}
                    >
                      {option.label}
                    </h3>
                    <p
                      className={`text-xs mt-1 ${
                        isSelected
                          ? 'text-violet-500 dark:text-violet-400'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
