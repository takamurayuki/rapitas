'use client';
import { useState, useRef, useCallback } from 'react';
import {
  Upload,
  X,
  File,
  Image,
  FileText,
  Trash2,
  Download,
  ExternalLink,
  Loader2,
  Check,
  Eye,
} from 'lucide-react';
import type { Resource } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import FileViewer from '@/components/file-viewer/FileViewer';
import { createLogger } from '@/lib/logger';

const logger = createLogger('FileUploader');

// ダウンロード状態の型
type DownloadState = 'idle' | 'downloading' | 'completed';

// ファイルをダウンロードする関数
async function downloadFile(url: string, fileName: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('ダウンロードに失敗しました');
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    logger.error('Download error:', error);
    throw error;
  }
}

type FileUploaderProps = {
  taskId: number;
  resources: Resource[];
  onResourcesChange: () => void;
};

export default function FileUploader({
  taskId,
  resources,
  onResourcesChange,
}: FileUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadStates, setDownloadStates] = useState<
    Record<number, DownloadState>
  >({});
  const [viewingResource, setViewingResource] = useState<Resource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ダウンロード処理（アニメーション付き）
  const handleDownload = useCallback(
    async (resourceId: number, url: string, fileName: string) => {
      setDownloadStates((prev) => ({ ...prev, [resourceId]: 'downloading' }));
      try {
        await downloadFile(url, fileName);
        setDownloadStates((prev) => ({ ...prev, [resourceId]: 'completed' }));
        // 2秒後にアイドル状態に戻す
        setTimeout(() => {
          setDownloadStates((prev) => ({ ...prev, [resourceId]: 'idle' }));
        }, 2000);
      } catch (e) {
        setDownloadStates((prev) => ({ ...prev, [resourceId]: 'idle' }));
        setError(e instanceof Error ? e.message : 'ダウンロードに失敗しました');
      }
    },
    [],
  );

  // ファイルをアップロード（FileList用）
  const uploadFiles = useCallback(
    async (files: FileList) => {
      setIsUploading(true);
      setError(null);

      try {
        for (const file of Array.from(files)) {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('taskId', taskId.toString());

          const res = await fetch(`${API_BASE_URL}/resources/upload`, {
            method: 'POST',
            body: formData,
          });

          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || 'アップロードに失敗しました');
          }
          await res.json();
        }

        onResourcesChange();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'アップロードに失敗しました');
      } finally {
        setIsUploading(false);
      }
    },
    [taskId, onResourcesChange],
  );

  // ブラウザのネイティブドラッグイベント（Tauri環境でもdragDropEnabled: trueで動作）
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragActive(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        uploadFiles(files);
      }
    },
    [uploadFiles],
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await uploadFiles(files);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (resourceId: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/resources/${resourceId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('削除に失敗しました');
      }

      onResourcesChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  const getFileIcon = (resource: Resource) => {
    if (resource.type === 'image' || resource.mimeType?.startsWith('image/')) {
      return <Image className="w-4 h-4 text-emerald-500" />;
    }
    if (resource.type === 'pdf' || resource.mimeType === 'application/pdf') {
      return <FileText className="w-4 h-4 text-rose-500" />;
    }
    return <File className="w-4 h-4 text-blue-500" />;
  };

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const getFileUrl = (resource: Resource) => {
    if (resource.filePath) {
      return `${API_BASE_URL}/resources/file/${resource.filePath}`;
    }
    return resource.url || '#';
  };

  const getDownloadUrl = (resource: Resource) => {
    if (resource.filePath) {
      return `${API_BASE_URL}/resources/download/${resource.filePath}`;
    }
    return resource.url || '#';
  };

  const fileResources = resources.filter(
    (r) =>
      r.filePath || r.type === 'file' || r.type === 'image' || r.type === 'pdf',
  );

  return (
    <div className="space-y-3">
      {/* Upload Area */}
      <div
        className={`relative border-2 border-dashed rounded-xl p-4 transition-all cursor-pointer ${
          dragActive
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
            : 'border-zinc-200 dark:border-zinc-700 hover:border-blue-200 dark:hover:border-blue-500'
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          accept="image/*,.pdf,.txt,.md,.json,.zip,.csv,.xml,.yaml,.yml,.html,.css,.js,.ts,.jsx,.tsx,.sql,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rar,.7z,.gz,.tar"
        />
        <div className="flex flex-col items-center gap-2 text-center pointer-events-none">
          {isUploading ? (
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          ) : (
            <Upload className="w-8 h-8 text-zinc-400 dark:text-zinc-500" />
          )}
          <div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {isUploading
                ? 'アップロード中...'
                : 'ファイルをドラッグ&ドロップ'}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              または クリックして選択（最大10MB）
            </p>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 p-2 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 rounded-lg text-sm">
          <X className="w-4 h-4" />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto p-1 hover:bg-rose-100 dark:hover:bg-rose-900/40 rounded"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* File List */}
      {fileResources.length > 0 && (
        <div className="space-y-2">
          {fileResources.map((resource) => (
            <div
              key={resource.id}
              className="flex items-center gap-3 p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg group"
            >
              {/* Preview or Icon */}
              {resource.type === 'image' && resource.filePath ? (
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-zinc-200 dark:bg-zinc-700 shrink-0">
                  <img
                    src={getFileUrl(resource)}
                    alt={resource.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-lg bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center shrink-0">
                  {getFileIcon(resource)}
                </div>
              )}

              {/* File Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                  {resource.title || resource.fileName}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatFileSize(resource.fileSize)}
                  {resource.mimeType && ` • ${resource.mimeType.split('/')[1]}`}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setViewingResource(resource)}
                  className="p-1.5 text-zinc-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                  title="プレビュー"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <a
                  href={getFileUrl(resource)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-zinc-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                  title="新しいタブで開く"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <div className="relative">
                  <button
                    onClick={() =>
                      handleDownload(
                        resource.id,
                        getDownloadUrl(resource),
                        resource.fileName || resource.title || 'download',
                      )
                    }
                    disabled={downloadStates[resource.id] === 'downloading'}
                    className={`relative p-1.5 rounded-lg transition-all duration-300 ${
                      downloadStates[resource.id] === 'completed'
                        ? 'text-emerald-500 bg-emerald-100 dark:bg-emerald-900/40 scale-110'
                        : downloadStates[resource.id] === 'downloading'
                          ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/30'
                          : 'text-zinc-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                    }`}
                    title={
                      downloadStates[resource.id] === 'completed'
                        ? 'ダウンロード完了'
                        : downloadStates[resource.id] === 'downloading'
                          ? 'ダウンロード中...'
                          : 'ダウンロード'
                    }
                  >
                    {downloadStates[resource.id] === 'completed' ? (
                      <Check className="w-4 h-4 animate-[successPop_0.4s_ease-out]" />
                    ) : downloadStates[resource.id] === 'downloading' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    {/* Ripple effect on completion */}
                    {downloadStates[resource.id] === 'completed' && (
                      <span className="absolute inset-0 rounded-lg bg-emerald-400/30 animate-[ripple_0.6s_ease-out]" />
                    )}
                  </button>
                  {/* Success tooltip */}
                  {downloadStates[resource.id] === 'completed' && (
                    <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/60 rounded-md whitespace-nowrap animate-[fadeInUp_0.3s_ease-out] shadow-sm">
                      完了!
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(resource.id)}
                  className="p-1.5 text-zinc-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors"
                  title="削除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* File Viewer */}
      {viewingResource && (
        <FileViewer
          resource={viewingResource}
          isOpen={!!viewingResource}
          onClose={() => setViewingResource(null)}
          resources={fileResources}
          onNavigate={(res) => setViewingResource(res)}
        />
      )}
    </div>
  );
}
