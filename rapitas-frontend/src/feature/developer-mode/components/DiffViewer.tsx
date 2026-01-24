"use client";

import { useState } from "react";
import {
  FileText,
  FilePlus,
  FileMinus,
  FileEdit,
  ChevronRight,
  ChevronDown,
  Code,
  FileCode,
} from "lucide-react";
import type { FileDiff } from "@/types";

type DiffViewerProps = {
  files: FileDiff[];
  showRawDiff?: boolean;
  onToggleView?: (isRaw: boolean) => void;
};

export function DiffViewer({
  files,
  showRawDiff = false,
  onToggleView,
}: DiffViewerProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    new Set(files.map((f) => f.filename))
  );
  const [isRawView, setIsRawView] = useState(showRawDiff);

  const toggleFile = (filename: string) => {
    setExpandedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filename)) {
        newSet.delete(filename);
      } else {
        newSet.add(filename);
      }
      return newSet;
    });
  };

  const toggleView = () => {
    setIsRawView(!isRawView);
    onToggleView?.(!isRawView);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "added":
        return <FilePlus className="w-4 h-4 text-green-500" />;
      case "deleted":
      case "removed":
        return <FileMinus className="w-4 h-4 text-red-500" />;
      case "modified":
      case "changed":
        return <FileEdit className="w-4 h-4 text-amber-500" />;
      default:
        return <FileText className="w-4 h-4 text-zinc-400" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "added":
        return "追加";
      case "deleted":
      case "removed":
        return "削除";
      case "modified":
      case "changed":
        return "変更";
      case "renamed":
        return "名前変更";
      default:
        return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "added":
        return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300";
      case "deleted":
      case "removed":
        return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300";
      case "modified":
      case "changed":
        return "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300";
      default:
        return "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400";
    }
  };

  const parsePatch = (patch: string) => {
    if (!patch) return [];

    const lines = patch.split("\n");
    return lines.map((line, index) => {
      let type: "added" | "removed" | "context" | "header" = "context";
      if (line.startsWith("+") && !line.startsWith("+++")) {
        type = "added";
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        type = "removed";
      } else if (line.startsWith("@@")) {
        type = "header";
      }
      return { line, type, index };
    });
  };

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {files.length} ファイル
          </span>
          <div className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <span className="font-medium">+{totalAdditions}</span>
            </span>
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <span className="font-medium">-{totalDeletions}</span>
            </span>
          </div>
        </div>
        <button
          onClick={toggleView}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-md transition-colors"
        >
          {isRawView ? (
            <>
              <FileCode className="w-4 h-4" />
              構造化表示
            </>
          ) : (
            <>
              <Code className="w-4 h-4" />
              RAW表示
            </>
          )}
        </button>
      </div>

      {/* File List */}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {files.map((file) => (
          <div key={file.filename}>
            {/* File Header */}
            <button
              onClick={() => toggleFile(file.filename)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
            >
              {expandedFiles.has(file.filename) ? (
                <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
              )}
              {getStatusIcon(file.status)}
              <span className="flex-1 text-left text-sm font-mono text-zinc-700 dark:text-zinc-300 truncate">
                {file.filename}
              </span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(file.status)}`}
              >
                {getStatusLabel(file.status)}
              </span>
              <div className="flex items-center gap-2 text-xs">
                {file.additions > 0 && (
                  <span className="text-green-600 dark:text-green-400">
                    +{file.additions}
                  </span>
                )}
                {file.deletions > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    -{file.deletions}
                  </span>
                )}
              </div>
            </button>

            {/* File Diff Content */}
            {expandedFiles.has(file.filename) && file.patch && (
              <div className="bg-zinc-900 dark:bg-zinc-950 overflow-x-auto">
                {isRawView ? (
                  <pre className="p-4 text-xs font-mono text-zinc-300 whitespace-pre">
                    {file.patch}
                  </pre>
                ) : (
                  <div className="divide-y divide-zinc-800">
                    {parsePatch(file.patch).map(({ line, type, index }) => (
                      <div
                        key={index}
                        className={`flex text-xs font-mono ${
                          type === "added"
                            ? "bg-green-900/30"
                            : type === "removed"
                              ? "bg-red-900/30"
                              : type === "header"
                                ? "bg-blue-900/20"
                                : ""
                        }`}
                      >
                        <div className="w-10 shrink-0 px-2 py-0.5 text-right text-zinc-500 select-none border-r border-zinc-800">
                          {type !== "header" ? index + 1 : ""}
                        </div>
                        <div className="w-6 shrink-0 px-1 py-0.5 text-center select-none">
                          {type === "added" && (
                            <span className="text-green-400">+</span>
                          )}
                          {type === "removed" && (
                            <span className="text-red-400">-</span>
                          )}
                          {type === "header" && (
                            <span className="text-blue-400">@</span>
                          )}
                        </div>
                        <pre
                          className={`flex-1 px-2 py-0.5 ${
                            type === "added"
                              ? "text-green-300"
                              : type === "removed"
                                ? "text-red-300"
                                : type === "header"
                                  ? "text-blue-300"
                                  : "text-zinc-300"
                          }`}
                        >
                          {line.slice(1)}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* No patch available */}
            {expandedFiles.has(file.filename) && !file.patch && (
              <div className="px-4 py-6 bg-zinc-50 dark:bg-zinc-800/30 text-center">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  差分情報がありません
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Empty State */}
      {files.length === 0 && (
        <div className="px-4 py-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            変更されたファイルはありません
          </p>
        </div>
      )}
    </div>
  );
}

export default DiffViewer;
