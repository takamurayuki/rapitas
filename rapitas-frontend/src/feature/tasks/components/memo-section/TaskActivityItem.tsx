'use client';
// TaskActivityItem

import { memo } from 'react';
import {
  TrendingUp,
  User,
  ArrowRight,
  FileText,
  Tag,
  GitCommit,
} from 'lucide-react';
import type { TaskActivity } from './types';
import { timeAgo } from './memo-utils';

/**
 * Displays one activity row with an icon, action label, optional details, and timestamp.
 *
 * @param activity - The activity data to render / レンダリングするアクティビティデータ
 */
export const TaskActivityItem = memo(function TaskActivityItem({
  activity,
}: {
  activity: TaskActivity;
}) {
  const getActivityIcon = () => {
    switch (activity.type) {
      case 'status_change':
        return <TrendingUp className="w-3 h-3" />;
      case 'assignment':
        return <User className="w-3 h-3" />;
      case 'priority_change':
        return <ArrowRight className="w-3 h-3" />;
      case 'description_update':
        return <FileText className="w-3 h-3" />;
      case 'label_change':
        return <Tag className="w-3 h-3" />;
      default:
        return <GitCommit className="w-3 h-3" />;
    }
  };

  const getActivityColor = () => {
    switch (activity.type) {
      case 'status_change':
        return 'text-blue-500 bg-blue-50 dark:bg-blue-900/20';
      case 'assignment':
        return 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20';
      case 'priority_change':
        return 'text-amber-500 bg-amber-50 dark:bg-amber-900/20';
      case 'description_update':
        return 'text-purple-500 bg-purple-50 dark:bg-purple-900/20';
      case 'label_change':
        return 'text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20';
      default:
        return 'text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50';
    }
  };

  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className={`p-1 rounded-full ${getActivityColor()}`}>
        {getActivityIcon()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {activity.action}
          </span>
          {activity.details && (
            <span className="text-zinc-500 dark:text-zinc-400">
              {activity.details}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-400">
          <span>{timeAgo(new Date(activity.timestamp))}</span>
          {activity.user && (
            <>
              <span>•</span>
              <span>{activity.user}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
