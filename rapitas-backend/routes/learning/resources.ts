/**
 * Resources API Routes
 * Supports both URL-based resources and file uploads
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { ValidationError } from '../../middleware/error-handler';
import { mkdir, writeFile, unlink, copyFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, extname } from 'path';

// Get MIME type from file extension
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase().slice(1);
  const mimeTypes: Record<string, string> = {
    // Images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    html: 'text/html',
    css: 'text/css',
    xml: 'text/xml',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    // Code
    js: 'application/javascript',
    ts: 'application/typescript',
    jsx: 'application/javascript',
    tsx: 'application/typescript',
    json: 'application/json',
    sql: 'application/sql',
    // Archives
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    gz: 'application/gzip',
    tar: 'application/x-tar',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}
import { randomUUID } from 'crypto';

// Upload directory configuration
const UPLOAD_DIR = join(process.cwd(), 'uploads');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/ico',
  'image/x-icon',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/css',
  'text/javascript',
  'text/xml',
  'text/yaml',
  // Code/Data
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-yaml',
  'application/sql',
  // Archives
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/gzip',
  'application/x-tar',
  // Other
  'application/octet-stream', // Generic binary (fallback for unknown types)
];

// Ensure upload directory exists
async function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
}

export const resourcesRoutes = new Elysia()
  // Get resources for a task
  .get('/tasks/:id/resources', async ({ params }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError('無効なIDです');

    return await prisma.resource.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'desc' },
    });
  })

  // Create URL-based resource
  .post(
    '/resources',
    async ({ body }) => {
      const { taskId, title, url, type, description } = body as {
        taskId?: number;
        title: string;
        url?: string;
        type: string;
        description?: string;
      };
      return await prisma.resource.create({
        data: {
          title,
          type,
          ...(taskId && { taskId }),
          ...(url && { url }),
          ...(description && { description }),
        },
      });
    },
    {
      body: t.Object({
        taskId: t.Optional(t.Number()),
        title: t.String({ minLength: 1 }),
        url: t.Optional(t.String()),
        type: t.String(),
        description: t.Optional(t.String()),
      }),
    },
  )

  // Upload file resource
  .post('/resources/upload', async (context) => {
    const { body } = context;
    const {
      taskId: taskIdStr,
      file,
      title,
      description,
    } = body as {
      taskId?: string;
      file: File;
      title?: string;
      description?: string;
    };

    // Validate file exists
    if (!file || !(file instanceof File)) {
      throw new ValidationError('ファイルが見つかりません');
    }

    // NOTE: taskId from FormData is a string, convert to number
    const taskId = taskIdStr ? parseInt(taskIdStr, 10) : undefined;
    if (taskIdStr && (isNaN(taskId!) || taskId! <= 0)) {
      throw new ValidationError('無効なタスクIDです');
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new ValidationError(
        `ファイルサイズは${MAX_FILE_SIZE / 1024 / 1024}MB以下にしてください`,
      );
    }

    // Validate MIME type (extract base MIME type without charset)
    const baseMimeType = file.type.split(';')[0].trim();
    if (!ALLOWED_MIME_TYPES.includes(baseMimeType)) {
      throw new ValidationError(`許可されていないファイル形式です: ${file.type}`);
    }

    await ensureUploadDir();

    // Generate unique filename
    const ext = file.name.split('.').pop() || '';
    const uniqueName = `${randomUUID()}.${ext}`;
    const filePath = join(UPLOAD_DIR, uniqueName);

    // Save file
    const buffer = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    // Determine type based on MIME
    let resourceType = 'file';
    if (baseMimeType.startsWith('image/')) resourceType = 'image';
    else if (baseMimeType === 'application/pdf') resourceType = 'pdf';

    // Create resource record
    return await prisma.resource.create({
      data: {
        title: title || file.name,
        type: resourceType,
        fileName: file.name,
        filePath: uniqueName,
        fileSize: file.size,
        mimeType: baseMimeType,
        ...(taskId && { taskId }),
        ...(description && { description }),
      },
    });
  })

  // Upload file from path (for Tauri drag-drop)
  .post(
    '/resources/upload-from-path',
    async (context) => {
      const { body } = context;
      const {
        taskId,
        filePath: sourcePath,
        title,
        description,
      } = body as {
        taskId: number;
        filePath: string;
        title?: string;
        description?: string;
      };

      // Validate source file exists
      if (!existsSync(sourcePath)) {
        throw new ValidationError('ファイルが見つかりません');
      }

      // Get file stats
      const stats = await stat(sourcePath);
      if (stats.size > MAX_FILE_SIZE) {
        throw new ValidationError(
          `ファイルサイズは${MAX_FILE_SIZE / 1024 / 1024}MB以下にしてください`,
        );
      }

      // Get file info
      const fileName = basename(sourcePath);
      const ext = extname(sourcePath).slice(1) || '';
      const mimeType = getMimeType(sourcePath);

      // Validate MIME type
      const baseMimeType = mimeType.split(';')[0].trim();
      if (!ALLOWED_MIME_TYPES.includes(baseMimeType)) {
        throw new ValidationError(`許可されていないファイル形式です: ${mimeType}`);
      }

      await ensureUploadDir();

      // Generate unique filename
      const uniqueName = `${randomUUID()}.${ext}`;
      const destPath = join(UPLOAD_DIR, uniqueName);

      // Copy file to uploads directory
      await copyFile(sourcePath, destPath);

      // Determine type based on MIME
      let resourceType = 'file';
      if (baseMimeType.startsWith('image/')) resourceType = 'image';
      else if (baseMimeType === 'application/pdf') resourceType = 'pdf';

      // Create resource record
      return await prisma.resource.create({
        data: {
          title: title || fileName,
          type: resourceType,
          fileName: fileName,
          filePath: uniqueName,
          fileSize: stats.size,
          mimeType: baseMimeType,
          taskId,
          ...(description && { description }),
        },
      });
    },
    {
      body: t.Object({
        taskId: t.Number(),
        filePath: t.String({ minLength: 1 }),
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
      }),
    },
  )

  // Serve uploaded file (inline - for viewing)
  .get('/resources/file/:filename', async (context) => {
    const { params, set } = context;
    const { filename } = params;
    const filePath = join(UPLOAD_DIR, filename);

    if (!existsSync(filePath)) {
      throw new ValidationError('ファイルが見つかりません');
    }

    // Get resource info for MIME type
    const resource = await prisma.resource.findFirst({
      where: { filePath: filename },
    });

    const file = Bun.file(filePath);
    const mimeType = resource?.mimeType || getMimeType(filePath);

    set.headers['Content-Type'] = mimeType.includes('text')
      ? `${mimeType}; charset=utf-8`
      : mimeType;
    set.headers['Cache-Control'] = 'public, max-age=3600';

    if (resource?.fileName) {
      const encodedFilename = encodeURIComponent(resource.fileName)
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A');
      set.headers['Content-Disposition'] = `inline; filename*=UTF-8''${encodedFilename}`;
    } else {
      set.headers['Content-Disposition'] = `inline; filename="${filename}"`;
    }

    return file;
  })

  // Download uploaded file (attachment - for downloading)
  .get('/resources/download/:filename', async (context) => {
    const { params, set } = context;
    const { filename } = params;
    const filePath = join(UPLOAD_DIR, filename);

    if (!existsSync(filePath)) {
      throw new ValidationError('ファイルが見つかりません');
    }

    // Get resource info for MIME type and original filename
    const resource = await prisma.resource.findFirst({
      where: { filePath: filename },
    });

    const file = Bun.file(filePath);
    set.headers['Content-Type'] = resource?.mimeType || 'application/octet-stream';

    if (resource?.fileName) {
      const encodedFilename = encodeURIComponent(resource.fileName)
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A');
      set.headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodedFilename}`;
    } else {
      set.headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    }

    return file;
  })

  // Delete resource (and file if exists)
  .delete('/resources/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError('無効なIDです');

    // Get resource to check for file
    const resource = await prisma.resource.findUnique({ where: { id } });

    if (resource?.filePath) {
      const filePath = join(UPLOAD_DIR, resource.filePath);
      if (existsSync(filePath)) {
        await unlink(filePath);
      }
    }

    return await prisma.resource.delete({ where: { id } });
  });
