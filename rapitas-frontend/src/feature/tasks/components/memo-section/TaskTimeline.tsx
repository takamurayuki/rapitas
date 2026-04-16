'use client';
// TaskTimeline

import { memo, useMemo } from 'react';
import { History, MessageSquare, Pin } from 'lucide-react';
import type { NoteData, TaskActivity } from './types';
import { MEMO_TYPE_CONFIG } from './types';
import { generateMockTaskActivities } from './memo-utils';
import { TaskActivityItem } from './TaskActivityItem';

/**
 * Merges and displays task activity and memo history in a single timeline.
 *
 * @param taskId - Numeric task identifier used to load mock activities / タスクID
 * @param notes - Processed NoteData array to merge into the timeline / タイムラインに合成するメモ一覧
 */
export const TaskTimeline = memo(function TaskTimeline({
  taskId,
  notes,
}: {
  taskId: number;
  notes: NoteData[];
}) {
  const activities = useMemo(
    () => generateMockTaskActivities(taskId),
    [taskId],
  );

  const timelineItems = useMemo(() => {
    const items: Array<
      | { type: 'activity'; data: TaskActivity; timestamp: string }
      | { type: 'memo'; data: NoteData; timestamp: string }
    > = [];

    activities.forEach((activity) => {
      items.push({
        type: 'activity',
        data: activity,
        timestamp: activity.timestamp,
      });
    });

    notes.forEach((note) => {
      items.push({
        type: 'memo',
        data: note,
        timestamp: note.createdAt,
      });
    });

    return items.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [activities, notes]);

  if (timelineItems.length === 0) {
    return (
      <div className="text-center py-4">
        <History className="w-6 h-6 text-zinc-300 dark:text-zinc-600 mx-auto mb-1.5" />
        <p className="text-[10px] text-zinc-400">タスクの履歴がありません</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {timelineItems.map((item, index) => (
        <div key={`${item.type}-${item.data.id || index}`} className="relative">
          {/* Timeline connector line between items */}
          {index < timelineItems.length - 1 && (
            <div className="absolute left-3.5 top-8 w-0.5 h-6 bg-zinc-200 dark:bg-zinc-700" />
          )}

          <div className="relative">
            {item.type === 'activity' ? (
              <TaskActivityItem activity={item.data as TaskActivity} />
            ) : (
              <div className="flex items-start gap-2.5 py-1.5">
                <div
                  className={`p-1 rounded-full ${MEMO_TYPE_CONFIG[(item.data as NoteData).memoType || 'general'].color.bg}`}
                >
                  <MessageSquare
                    className={`w-3 h-3 ${MEMO_TYPE_CONFIG[(item.data as NoteData).memoType || 'general'].color.text}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={`px-1.5 py-0.5 text-[9px] rounded-full ${MEMO_TYPE_CONFIG[(item.data as NoteData).memoType || 'general'].color.badge}`}
                    >
                      {
                        MEMO_TYPE_CONFIG[
                          (item.data as NoteData).memoType || 'general'
                        ].label
                      }
                    </span>
                    {(item.data as NoteData).isPinned && (
                      <Pin className="w-2.5 h-2.5 text-blue-500" />
                    )}
                  </div>
                  <p className="text-xs text-zinc-700 dark:text-zinc-300 mt-0.5 line-clamp-2">
                    {(item.data as NoteData).content}
                  </p>
                  <div className="text-[10px] text-zinc-400 mt-0.5">
                    {(item.data as NoteData).time}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
});
