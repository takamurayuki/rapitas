'use client';
// WorkflowTabBar

import { Clock } from 'lucide-react';
import type { WorkflowFileType, WorkflowStatus } from '@/types';
import type { WorkflowTab } from './workflow-viewer-utils';

interface WorkflowTabBarProps {
  /** Tabs to display (filtered by the current workflow mode) */
  tabs: WorkflowTab[];
  /** Currently selected tab id */
  activeTab: WorkflowFileType;
  /** Whether each tab has a corresponding file */
  tabStatus: Record<WorkflowFileType, boolean>;
  /** Resolved effective status used to determine badge visibility */
  effectiveStatus: WorkflowStatus | null;
  /** Called when user clicks a tab */
  onTabChange: (tab: WorkflowFileType) => void;
}

/**
 * Tab navigation bar for workflow file types.
 *
 * @param tabs - Tab definitions visible in the current mode
 * @param activeTab - Currently selected tab
 * @param tabStatus - Map of file-type to existence flag
 * @param effectiveStatus - Current workflow status for badge logic
 * @param onTabChange - Tab-selection handler / タブ選択ハンドラ
 */
export function WorkflowTabBar({
  tabs,
  activeTab,
  tabStatus,
  effectiveStatus,
  onTabChange,
}: WorkflowTabBarProps) {
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-700">
      <nav className="flex">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const hasContent = tabStatus[tab.id];
          const TabIcon = tab.icon;
          // Show badge for plan tab awaiting approval
          const needsAttention =
            tab.id === 'plan' &&
            effectiveStatus === 'plan_created' &&
            hasContent;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`relative flex items-center gap-2 py-3 px-5 border-b-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-300'
              }`}
            >
              <TabIcon className="h-4 w-4" />
              <span>{tab.label}</span>
              {needsAttention ? (
                <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 text-[10px] font-medium rounded-full">
                  <Clock className="h-2.5 w-2.5" />
                  承認待ち
                </span>
              ) : (
                <div
                  className={`w-2 h-2 rounded-full ${
                    hasContent ? 'bg-green-500' : 'bg-zinc-300 dark:bg-zinc-600'
                  }`}
                />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
