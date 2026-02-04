"use client";

import { Task, Label, Resource } from "@/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createMarkdownComponents } from "@/feature/tasks/components/MarkdownComponents";
import TaskStatusChange from "@/feature/tasks/components/TaskStatusChange";
import {
  statusConfig,
  renderStatusIcon,
} from "@/feature/tasks/config/StatusConfig";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion/Accordion";
import { SelectedLabelsDisplay } from "@/feature/tasks/components/LabelSelector";
import FileUploader from "@/feature/tasks/components/FileUploader";
import {
  Clock,
  Calendar,
  Tag,
  FileText,
  Info,
  Paperclip,
} from "lucide-react";
import PriorityIcon from "@/feature/tasks/components/PriorityIcon";

interface CompactTaskDetailCardProps {
  task: Task;
  onStatusUpdate: (taskId: number, newStatus: string) => void;
  onEditCode?: (language: string, code: string) => void;
  resources?: Resource[];
  onResourcesChange?: () => void;
}

export default function CompactTaskDetailCard({
  task,
  onStatusUpdate,
  onEditCode,
  resources = [],
  onResourcesChange,
}: CompactTaskDetailCardProps) {
  const fileResources = resources.filter(
    (r) => r.filePath || r.type === "file" || r.type === "image" || r.type === "pdf"
  );
  const hasMetaInfo =
    (task.taskLabels && task.taskLabels.length > 0) || task.estimatedHours;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
      {/* Header: Title & Status in one compact row */}
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          {/* Title with Priority Icon */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 leading-tight truncate">
              {task.title}
            </h1>
            <PriorityIcon priority={task.priority} size="md" />
          </div>

          {/* Status Buttons - Compact inline with title */}
          <div className="flex items-center gap-1 shrink-0">
            {(["todo", "in-progress", "done"] as const).map((status) => {
              const config = statusConfig[status];
              return (
                <TaskStatusChange
                  key={status}
                  status={status}
                  currentStatus={task.status}
                  config={config}
                  renderIcon={renderStatusIcon}
                  onClick={(newStatus) => onStatusUpdate(task.id, newStatus)}
                  size="sm"
                  showLabel={false}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Accordion sections */}
      <Accordion
        defaultExpanded={["description"]}
        allowMultiple={true}
        className="border-t border-zinc-100 dark:border-zinc-800"
      >
        {/* Description - Default expanded */}
        {task.description && (
          <AccordionItem id="description">
            <AccordionTrigger
              id="description"
              icon={<FileText className="w-4 h-4" />}
            >
              説明
            </AccordionTrigger>
            <AccordionContent id="description">
              <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4">
                <div
                  className="prose prose-zinc dark:prose-invert max-w-none prose-sm
                  prose-headings:font-bold
                  prose-h1:text-lg prose-h1:mt-3 prose-h1:mb-2
                  prose-h2:text-base prose-h2:mt-2 prose-h2:mb-1.5
                  prose-h3:text-sm prose-h3:mt-1.5 prose-h3:mb-1
                  prose-p:my-1.5 prose-p:leading-relaxed prose-p:text-sm
                  prose-a:text-violet-600 prose-a:no-underline hover:prose-a:underline
                  prose-pre:bg-zinc-100 prose-pre:dark:bg-zinc-900
                  prose-pre:p-3 prose-pre:rounded-lg prose-pre:overflow-x-auto prose-pre:text-xs
                  prose-blockquote:border-l-4 prose-blockquote:border-violet-300
                  prose-blockquote:dark:border-violet-700 prose-blockquote:pl-3
                  prose-blockquote:italic prose-blockquote:text-zinc-600
                  prose-blockquote:dark:text-zinc-400 prose-blockquote:text-sm
                  prose-ul:my-1.5 prose-ol:my-1.5
                  prose-li:my-0.5 prose-li:text-sm
                  [&_code]:bg-zinc-200 [&_code]:dark:bg-zinc-700
                  [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
                  [&_code]:text-xs [&_code]:font-mono
                  [&_code]:text-zinc-800 [&_code]:dark:text-zinc-200
                  [&_code]:before:content-[''] [&_code]:after:content-['']
                  [&_pre_code]:bg-transparent [&_pre_code]:p-0"
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={createMarkdownComponents(onEditCode)}
                  >
                    {task.description}
                  </ReactMarkdown>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Meta Information - Collapsible */}
        {hasMetaInfo && (
          <AccordionItem id="meta">
            <AccordionTrigger
              id="meta"
              icon={<Tag className="w-4 h-4" />}
              badge={
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {task.taskLabels?.length || 0} labels
                  {task.estimatedHours ? ` / ${task.estimatedHours}h` : ""}
                </span>
              }
            >
              ラベル・見積もり
            </AccordionTrigger>
            <AccordionContent id="meta">
              <div className="flex flex-wrap items-center gap-3">
                {task.taskLabels && task.taskLabels.length > 0 && (
                  <SelectedLabelsDisplay
                    labels={task.taskLabels
                      .map((tl) => tl.label)
                      .filter((l): l is Label => l !== undefined)}
                  />
                )}
                {task.estimatedHours && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-sm font-medium">
                    <Clock className="w-3.5 h-3.5" />
                    {task.estimatedHours}時間
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Details with AI Features - Collapsible */}
        <AccordionItem id="details">
          <AccordionTrigger
            id="details"
            icon={<Info className="w-4 h-4" />}
            badge={
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                更新: {new Date(task.updatedAt).toLocaleDateString("ja-JP")}
              </span>
            }
          >
            詳細情報
          </AccordionTrigger>
          <AccordionContent id="details">
            {/* Timestamps */}
            <div className="flex flex-wrap items-center gap-4 pt-3 text-sm text-zinc-500 dark:text-zinc-400">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>
                  作成: {new Date(task.createdAt).toLocaleString("ja-JP")}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>
                  更新: {new Date(task.updatedAt).toLocaleString("ja-JP")}
                </span>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Attachments - Collapsible */}
        <AccordionItem id="attachments">
          <AccordionTrigger
            id="attachments"
            icon={<Paperclip className="w-4 h-4" />}
            badge={
              fileResources.length > 0 ? (
                <span className="px-1.5 py-0.5 text-xs font-medium bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 rounded-full">
                  {fileResources.length}
                </span>
              ) : undefined
            }
          >
            添付ファイル
          </AccordionTrigger>
          <AccordionContent id="attachments">
            {onResourcesChange ? (
              <FileUploader
                taskId={task.id}
                resources={resources}
                onResourcesChange={onResourcesChange}
              />
            ) : (
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                ファイルの追加には編集権限が必要です
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
