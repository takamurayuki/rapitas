/**
 * resource.types
 *
 * A file or link attached to a task.
 *
 * NOTE: This used to live in learning.types.ts, which made it look like a
 * study resource. It is a task attachment — FileUploader/FileViewer and the
 * task detail panes are its only consumers — and it shared that file by
 * accident. Kept when the learning features were removed.
 */

export type Resource = {
  id: number;
  taskId?: number | null;
  title: string;
  url?: string | null;
  type: string;
  description?: string | null;
  // File upload fields
  filePath?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt: string;
  updatedAt: string;
};
