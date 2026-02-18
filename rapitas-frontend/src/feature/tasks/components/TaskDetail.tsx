import { Task } from '@/types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { createMarkdownComponents } from '@/feature/tasks/components/MarkdownComponents';
import TaskStatusChange from '@/feature/tasks/components/TaskStatusChange';
import {
  statusConfig,
  renderStatusIcon,
} from '@/feature/tasks/config/StatusConfig';
import { getLabelsArray, hasLabels } from '@/utils/labels';
import { Tag } from 'lucide-react';
import { getIconComponent } from '@/components/category/IconData';

interface TaskDetailProps {
  task: Task;
  isEditing: boolean;
  editTitle: string;
  editDescription: string;
  editStatus: string;
  editLabels: string;
  editEstimatedHours: string;
  isDragging: boolean;
  onEditTitleChange: (value: string) => void;
  onEditDescriptionChange: (value: string) => void;
  onEditStatusChange: (value: string) => void;
  onEditLabelsChange: (value: string) => void;
  onEditEstimatedHoursChange: (value: string) => void;
  onStatusUpdate: (taskId: number, newStatus: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLTextAreaElement>) => void;
}

export default function TaskDetail({
  task,
  isEditing,
  editTitle,
  editDescription,
  editStatus,
  editLabels,
  editEstimatedHours,
  onEditTitleChange,
  onEditDescriptionChange,
  onEditStatusChange,
  onEditLabelsChange,
  onEditEstimatedHoursChange,
  onStatusUpdate,
  onDragOver,
  onDragLeave,
  onDrop,
}: TaskDetailProps) {
  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 p-8 mb-6">
      {isEditing ? (
        /* 編集モード */
        <div className="space-y-6">
          {/* タイトルとステータス */}
          <div>
            <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
              タイトル <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <input
                type="text"
                className="flex-1 min-w-0 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-4 py-3 text-lg font-bold shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={editTitle}
                onChange={(e) => onEditTitleChange(e.target.value)}
                required
              />
              <div className="flex items-center gap-1 shrink-0">
                {(['todo', 'in-progress', 'done'] as const).map((status) => {
                  const config = statusConfig[status];
                  return (
                    <TaskStatusChange
                      key={status}
                      status={status}
                      currentStatus={editStatus}
                      config={config}
                      renderIcon={renderStatusIcon}
                      onClick={(newStatus) => onEditStatusChange(newStatus)}
                      size="md"
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* 説明 */}
          <div>
            <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
              説明
            </label>
            <textarea
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              rows={14}
              value={editDescription}
              onChange={(e) => onEditDescriptionChange(e.target.value)}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              placeholder="マークダウン形式で記述できます&#10;&#10;# 見出し1&#10;## 見出し2&#10;&#10;**太字** *斜体*&#10;&#10;- [ ] チェックボックス&#10;- [x] 完了済み&#10;&#10;`インラインコード` や > 引用&#10;&#10;ファイルや画像はここにドラッグ&ドロップできます"
            />
          </div>

          {/* ラベルと見積もり時間 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                ラベル
              </label>
              <input
                type="text"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="カンマ区切りで入力"
                value={editLabels}
                onChange={(e) => onEditLabelsChange(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                見積もり時間
              </label>
              <input
                type="number"
                step="0.5"
                min="0"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="時間"
                value={editEstimatedHours}
                onChange={(e) => onEditEstimatedHoursChange(e.target.value)}
              />
            </div>
          </div>
        </div>
      ) : (
        /* 表示モード */
        <>
          <div className="flex items-start justify-between mb-4">
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
              {task.title}
            </h1>
            <div className="flex items-center gap-2">
              {(['todo', 'in-progress', 'done'] as const).map((status) => {
                const config = statusConfig[status];
                return (
                  <TaskStatusChange
                    key={status}
                    status={status}
                    currentStatus={task.status}
                    config={config}
                    renderIcon={renderStatusIcon}
                    onClick={(newStatus) => onStatusUpdate(task.id, newStatus)}
                    size="md"
                  />
                );
              })}
            </div>
          </div>

          {task.description && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                説明
              </h2>
              <div
                className="prose prose-sm prose-zinc dark:prose-invert max-w-none 
                prose-headings:font-bold 
                prose-h1:text-2xl prose-h1:mt-4 prose-h1:mb-2
                prose-h2:text-xl prose-h2:mt-3 prose-h2:mb-2
                prose-h3:text-lg prose-h3:mt-2 prose-h3:mb-1
                prose-p:my-2 prose-p:leading-relaxed
                prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                prose-pre:bg-zinc-100 prose-pre:dark:bg-indigo-dark-800 
                prose-pre:p-4 prose-pre:rounded-lg prose-pre:overflow-x-auto
                prose-blockquote:border-l-4 prose-blockquote:border-zinc-300 
                prose-blockquote:dark:border-zinc-700 prose-blockquote:pl-4 
                prose-blockquote:italic prose-blockquote:text-zinc-600 
                prose-blockquote:dark:text-zinc-400
                prose-ul:my-2 prose-ol:my-2
                prose-li:my-1
                prose-table:border-collapse prose-table:w-full
                prose-th:border prose-th:border-zinc-300 prose-th:dark:border-zinc-700 
                prose-th:bg-zinc-100 prose-th:dark:bg-indigo-dark-800 prose-th:px-3 prose-th:py-2
                prose-td:border prose-td:border-zinc-300 prose-td:dark:border-zinc-700 
                prose-td:px-3 prose-td:py-2
                prose-img:rounded-lg prose-img:shadow-md
                prose-hr:border-zinc-300 prose-hr:dark:border-zinc-700
                [&_code]:bg-zinc-100 [&_code]:dark:bg-indigo-dark-800 
                [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded 
                [&_code]:text-sm [&_code]:font-mono
                [&_code]:text-zinc-800 [&_code]:dark:text-zinc-200
                [&_code]:before:content-[''] [&_code]:after:content-['']
                [&_pre_code]:bg-transparent [&_pre_code]:p-0"
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  components={createMarkdownComponents()}
                >
                  {task.description}
                </ReactMarkdown>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mb-6">
            {task.taskLabels && task.taskLabels.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                  ラベル
                </h3>
                <div className="flex flex-wrap gap-2">
                  {task.taskLabels.map((tl) => {
                    if (!tl.label) return null;
                    const IconComponent =
                      getIconComponent(tl.label.icon || '') || Tag;
                    return (
                      <span
                        key={tl.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium"
                        style={{
                          backgroundColor: `${tl.label.color}20`,
                          color: tl.label.color,
                        }}
                      >
                        <IconComponent className="w-3.5 h-3.5" />
                        {tl.label.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : hasLabels(task.labels) ? (
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                  ラベル
                </h3>
                <div className="flex flex-wrap gap-2">
                  {getLabelsArray(task.labels).map((label, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 text-sm"
                    >
                      <Tag className="w-3.5 h-3.5" />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {task.estimatedHours && (
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                  見積もり時間
                </h3>
                <span className="px-3 py-1 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 text-sm inline-block">
                  ⏱ {task.estimatedHours}時間
                </span>
              </div>
            )}
          </div>

          <div className="text-sm text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-zinc-700 pt-4">
            <p>作成日時: {new Date(task.createdAt).toLocaleString('ja-JP')}</p>
            <p>更新日時: {new Date(task.updatedAt).toLocaleString('ja-JP')}</p>
          </div>
        </>
      )}
    </div>
  );
}
