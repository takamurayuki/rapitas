"use client";
import { useState, useEffect } from "react";
import {
  X,
  Download,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Code,
  Image as ImageIcon,
  File,
  Loader2,
} from "lucide-react";
import type { Resource } from "@/types";
import { API_BASE_URL, fetchWithRetry } from "@/utils/api";
import MarkdownViewer from "./MarkdownViewer";
import "./markdown-viewer.css";

type FileViewerProps = {
  resource: Resource;
  isOpen: boolean;
  onClose: () => void;
  resources?: Resource[]; // 同じタスクの他のリソース（ナビゲーション用）
  onNavigate?: (resource: Resource) => void;
};

export default function FileViewer({
  resource,
  isOpen,
  onClose,
  resources = [],
  onNavigate,
}: FileViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string>("");
  const [imageScale, setImageScale] = useState(1);
  const [imageRotation, setImageRotation] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ファイルURLを取得
  const getFileUrl = (res: Resource) => {
    if (res.filePath) {
      return `${API_BASE_URL}/resources/file/${res.filePath}`;
    }

    return res.url || "";
  };

  // ダウンロードURLを取得
  const getDownloadUrl = (res: Resource) => {
    if (res.filePath) {
      return `${API_BASE_URL}/resources/download/${res.filePath}`;
    }
    return res.url || "";
  };

  // ファイルタイプを判定
  const getFileType = (res: Resource): string => {
    const mimeType = res.mimeType || "";
    const fileName = res.fileName || res.title || "";
    const ext = fileName.split(".").pop()?.toLowerCase() || "";

    if (mimeType.startsWith("image/") || res.type === "image") {
      return "image";
    }
    if (mimeType === "application/pdf" || res.type === "pdf") {
      return "pdf";
    }
    // マークダウンファイルを別途判定
    if (ext === "md" || mimeType === "text/markdown") {
      return "markdown";
    }
    if (
      mimeType.startsWith("text/") ||
      [
        "txt",
        "json",
        "js",
        "ts",
        "jsx",
        "tsx",
        "css",
        "html",
        "xml",
        "yaml",
        "yml",
        "log",
        "csv",
      ].includes(ext)
    ) {
      return "text";
    }
    return "other";
  };

  // テキストファイルを読み込み
  useEffect(() => {
    const fileType = getFileType(resource);
    if (!isOpen || (fileType !== "text" && fileType !== "markdown")) return;

    const loadFile = async () => {
      setIsLoading(true);
      setError(null);
      setTextContent("");

      const url = getFileUrl(resource);

      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Accept:
              "text/plain, text/markdown, text/html, application/json, text/*",
          },
          mode: "cors",
          credentials: "omit", // 認証情報を送信しない
        });

        if (!res.ok) {
          throw new Error(
            `ファイルの読み込みに失敗しました: ${res.status} ${res.statusText}`,
          );
        }

        const text = await res.text();
        setTextContent(text);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(`ファイルの読み込みに失敗しました: ${message}`);
      } finally {
        setIsLoading(false);
      }
    };

    loadFile();
  }, [isOpen, resource]);

  // 画像の読み込み完了時
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setIsLoading(false);
  };

  // 画像の読み込みエラー時
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    console.error("[FileViewer] Image load error:", e);
    const url = getFileUrl(resource);
    console.error("[FileViewer] Failed to load image from:", url);
    setError(`画像の読み込みに失敗しました: ${url}`);
    setIsLoading(false);
  };

  // ナビゲーション
  const currentIndex = resources.findIndex((r) => r.id === resource.id);
  const canNavigatePrev = currentIndex > 0;
  const canNavigateNext = currentIndex < resources.length - 1;

  const handlePrevious = () => {
    if (canNavigatePrev && onNavigate) {
      onNavigate(resources[currentIndex - 1]);
    }
  };

  const handleNext = () => {
    if (canNavigateNext && onNavigate) {
      onNavigate(resources[currentIndex + 1]);
    }
  };

  // キーボードナビゲーション
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        handlePrevious();
      } else if (e.key === "ArrowRight") {
        handleNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, currentIndex]);

  if (!isOpen) return null;

  const fileType = getFileType(resource);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      {/* Main Container */}
      <div
        className={`relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 ${
          isFullscreen
            ? "w-full h-full m-0 rounded-none"
            : "w-[95vw] h-[90vh] md:w-[90vw] md:h-[85vh] max-w-6xl"
        }`}
      >
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 sm:p-4 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              {fileType === "image" ? (
                <ImageIcon className="w-5 h-5 text-emerald-500" />
              ) : fileType === "pdf" ? (
                <FileText className="w-5 h-5 text-rose-500" />
              ) : fileType === "markdown" ? (
                <FileText className="w-5 h-5 text-purple-500" />
              ) : fileType === "text" ? (
                <Code className="w-5 h-5 text-blue-500" />
              ) : (
                <File className="w-5 h-5 text-zinc-500" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {resource.title || resource.fileName}
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {resource.mimeType}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 sm:gap-2 ml-auto">
            {/* Navigation */}
            {resources.length > 1 && (
              <div className="flex items-center gap-1 mr-2 px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                <button
                  onClick={handlePrevious}
                  disabled={!canNavigatePrev}
                  className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="前のファイル (←)"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {currentIndex + 1} / {resources.length}
                </span>
                <button
                  onClick={handleNext}
                  disabled={!canNavigateNext}
                  className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="次のファイル (→)"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Image controls */}
            {fileType === "image" && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setImageScale(Math.min(imageScale + 0.25, 3))}
                  className="p-1.5 sm:p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  title="拡大"
                >
                  <ZoomIn className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
                <button
                  onClick={() =>
                    setImageScale(Math.max(imageScale - 0.25, 0.5))
                  }
                  className="p-1.5 sm:p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  title="縮小"
                >
                  <ZoomOut className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
                <button
                  onClick={() => setImageRotation((r) => r + 90)}
                  className="p-1.5 sm:p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  title="回転"
                >
                  <RotateCw className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
                <div className="hidden sm:block w-px h-6 bg-zinc-200 dark:bg-zinc-700" />
              </div>
            )}

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1.5 sm:p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title={isFullscreen ? "通常表示" : "全画面表示"}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4 sm:w-5 sm:h-5" />
              ) : (
                <Maximize2 className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>
            <a
              href={getDownloadUrl(resource)}
              download={resource.fileName || resource.title}
              className="p-1.5 sm:p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="ダウンロード"
            >
              <Download className="w-4 h-4 sm:w-5 sm:h-5" />
            </a>
            <a
              href={getFileUrl(resource)}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex p-1.5 sm:p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="新しいタブで開く"
            >
              <ExternalLink className="w-4 h-4 sm:w-5 sm:h-5" />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 sm:p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="閉じる (Esc)"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="pt-24 sm:pt-20 h-full overflow-auto bg-zinc-50 dark:bg-black/50">
          {isLoading && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 text-zinc-400 animate-spin" />
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="p-4 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 rounded-lg">
                <div>{error}</div>
                <div className="mt-2 text-xs font-mono">
                  URL: {getFileUrl(resource)}
                </div>
              </div>
              <div className="flex gap-2">
                <a
                  href={getFileUrl(resource)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  ブラウザで開く
                </a>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(getFileUrl(resource));
                    alert("URLをコピーしました");
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-500 text-white rounded-lg hover:bg-zinc-600 transition-colors"
                >
                  URLをコピー
                </button>
              </div>
            </div>
          )}

          {/* Image Viewer */}
          {fileType === "image" && !error && (
            <div className="flex items-center justify-center h-full p-8">
              <img
                src={getFileUrl(resource)}
                alt={resource.title || resource.fileName || ''}
                className="max-w-full max-h-full object-contain transition-transform duration-300"
                style={{
                  transform: `scale(${imageScale}) rotate(${imageRotation}deg)`,
                }}
                onLoad={handleImageLoad}
                onError={handleImageError}
              />
            </div>
          )}

          {/* PDF Viewer */}
          {fileType === "pdf" && !error && (
            <iframe
              src={getFileUrl(resource)}
              className="w-full h-full"
              onLoad={() => {
                console.log("[FileViewer] PDF loaded successfully");
                setIsLoading(false);
              }}
              onError={(e) => {
                console.error("[FileViewer] PDF load error:", e);
                const url = getFileUrl(resource);
                console.error("[FileViewer] Failed to load PDF from:", url);
                setError(`PDFの読み込みに失敗しました: ${url}`);
                setIsLoading(false);
              }}
            />
          )}

          {/* Markdown Viewer */}
          {fileType === "markdown" && !error && !isLoading && (
            <div className="p-8 max-w-4xl mx-auto">
              <MarkdownViewer content={textContent} />
            </div>
          )}

          {/* Text Viewer */}
          {fileType === "text" && !error && !isLoading && (
            <div className="p-8">
              <pre className="font-mono text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                {textContent}
              </pre>
            </div>
          )}

          {/* Other Files */}
          {fileType === "other" && !error && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <File className="w-16 h-16 text-zinc-400" />
              <p className="text-zinc-600 dark:text-zinc-400">
                このファイルタイプはプレビューできません
              </p>
              <a
                href={getDownloadUrl(resource)}
                download={resource.fileName || resource.title}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                <Download className="w-4 h-4" />
                ダウンロード
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
