/**
 * Resources API Routes
 * Supports both URL-based resources and file uploads
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { NotFoundError, ValidationError } from '../../middleware/error-handler';
import { writeFile, unlink, copyFile, stat } from 'fs/promises';
import { existsSync, realpathSync } from 'fs';
import { join, basename, extname, resolve, sep } from 'path';
import { tmpdir } from 'os';
import { getProjectRoot } from '../../config';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  UPLOAD_DIR,
  ensureUploadDir,
  getMimeType,
  resolveUploadPath,
} from './resources-upload-support';
import { ATTACHMENT_SECURITY_HEADERS, resolveAttachmentDisposition } from './attachment-serving';

import { randomUUID } from 'crypto';
import { isValidEntityId } from '../../utils/common/id-validation';

// Filenames that must never be copyable through upload-from-path, regardless
// of which root they resolve under — a stray allowlisted root (e.g. a theme
// working directory that happens to contain a `.git` checkout or a `.env`)
// must not become a path to secrets via this endpoint.
const SENSITIVE_UPLOAD_FILENAME_PATTERN =
  /(^|[\\/])(\.env(\..+)?|\.git|id_rsa(\.pub)?|.*\.key|.*\.pem|\.npmrc|\.aws|credentials(\.json)?)$/i;

/**
 * Base directories a `filePath` sent to POST /resources/upload-from-path is
 * allowed to resolve inside. Defaults to the OS temp dir (where a Tauri
 * file/drag-drop picker stages files) and this repo's root (covers theme
 * working directories that live inside the monorepo checkout); operators can
 * add project checkouts that live elsewhere via RAPITAS_UPLOAD_ALLOWED_ROOTS
 * (comma-separated absolute paths).
 *
 * @returns Resolved absolute allowlisted root paths / 許可ルートの絶対パス一覧
 */
export function getAllowedUploadSourceRoots(): string[] {
  const roots = new Set<string>([resolve(tmpdir()), resolve(getProjectRoot())]);
  const extra = process.env.RAPITAS_UPLOAD_ALLOWED_ROOTS;
  if (extra) {
    for (const raw of extra.split(',')) {
      const trimmed = raw.trim();
      if (trimmed) roots.add(resolve(trimmed));
    }
  }
  return Array.from(roots);
}

/**
 * Resolves and validates an untrusted source file path for
 * `POST /resources/upload-from-path`. Without this check, `sourcePath` was
 * passed straight to `existsSync`/`stat`/`copyFile` with no containment,
 * letting any caller (the endpoint is reachable cross-site — it's a
 * same-origin localhost API with no auth) copy `.env`, SSH keys, or any
 * other file readable by the backend process into `uploads/`, then download
 * it via `GET /resources/file/:filename`.
 *
 * @param sourcePath - Untrusted absolute path from the request body / リクエストボディの未検証絶対パス
 * @returns Resolved, allowlist-contained absolute path / 許可ルート配下に収まる絶対パス
 * @throws {ValidationError} When the path escapes every allowlisted root, or matches a known-sensitive filename
 */
export function resolveUploadSourcePath(sourcePath: string): string {
  const lexical = resolve(sourcePath);
  // The lexical name is checked too: a link called `.env` is refused on its
  // own name as well as on its target's.
  if (SENSITIVE_UPLOAD_FILENAME_PATTERN.test(lexical)) {
    throw new ValidationError('このファイルはアップロードできません');
  }

  // NOTE(security): The REAL path is what the checks below must see. `resolve`
  // is purely lexical while `copyFile` follows links, so a symlink or a Windows
  // junction sitting inside an allowlisted root — the OS temp dir is one, and a
  // Tauri dialog writes there — pointed anywhere on disk and bypassed both the
  // allowlist and the sensitive-filename rule by naming the link instead of its
  // target. The roots are resolved the same way, because on Windows the temp
  // dir itself is reached through links and comparing a real path against a
  // lexical root would reject legitimate files.
  let real: string;
  try {
    real = realpathSync.native(lexical);
  } catch {
    throw new ValidationError('ファイルが見つかりません');
  }
  if (SENSITIVE_UPLOAD_FILENAME_PATTERN.test(real)) {
    throw new ValidationError('このファイルはアップロードできません');
  }

  const roots = getAllowedUploadSourceRoots().map((root) => {
    try {
      return realpathSync.native(root);
    } catch {
      // A configured root that does not exist cannot contain anything; keep it
      // in the list so the comparison simply never matches it.
      return root;
    }
  });
  const contained = roots.some((root) => real === root || real.startsWith(root + sep));
  if (!contained) {
    throw new ValidationError('許可されていない場所のファイルです');
  }
  return real;
}

/**
 * Resolve an attachment request to a file on disk, refusing anything this
 * workspace does not own.
 *
 * NOTE: The Resource row is now REQUIRED, not an optional source of MIME
 * metadata. It used to be looked up only to decorate the response, so a file
 * whose row was absent — deleted, or belonging to another workspace, since
 * `prisma.resource` is workspace-scoped — was still served to anyone who knew
 * its stored name. Existence on disk was the only check.
 *
 * @param filename - Stored filename from the URL / URL 内の保存ファイル名
 * @returns The contained path and its authorised row / 配信パスと認可済み行
 * @throws {NotFoundError} When no visible Resource claims the file / 認可された行が無い場合
 */
async function resolveAuthorizedAttachment(
  filename: string,
): Promise<{ filePath: string; resource: { mimeType: string | null; fileName: string | null } }> {
  const filePath = resolveUploadPath(filename);
  const resource = await prisma.resource.findFirst({
    where: { filePath: filename },
    select: { mimeType: true, fileName: true },
  });
  if (!resource || !existsSync(filePath)) {
    throw new NotFoundError('ファイルが見つかりません');
  }
  return { filePath, resource };
}

/** `filename*=UTF-8''...` value, escaping what RFC 5987 leaves to the caller. */
function encodeContentDispositionFilename(name: string): string {
  return encodeURIComponent(name)
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

export const resourcesRoutes = new Elysia()
  // Get resources for a task
  .get('/tasks/:id/resources', async ({ params }) => {
    if (!isValidEntityId(params.id)) throw new ValidationError('無効なIDです');
    const id = Number(params.id);

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
  .post(
    '/resources/upload',
    async (context) => {
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
    },
    {
      // NOTE: `file` is intentionally left OUT of this schema (no t.File()).
      // routes/system/transcribe.ts already documents that Elysia's t.File()
      // validator can reject valid multipart FormData; the handler above does
      // its own File-instance/size/MIME checks. Only the string fields get
      // framework-level validation here.
      //
      // FIXME: `additionalProperties: true` is load-bearing and must stay.
      // The default is NOT permissive: Elysia 1.4.30's t.Object validation
      // STRIPS undeclared properties, so without this the multipart `file`
      // part never reaches the handler and every upload answers 400
      // 「ファイルが見つかりません」. Measured 2026-10-26 — the route had been
      // broken in production while its tests stayed green, because they only
      // ever exercised resolveUploadSourcePath and never the HTTP path.
      body: t.Object(
        {
          taskId: t.Optional(t.String()),
          title: t.Optional(t.String({ maxLength: 200 })),
          description: t.Optional(t.String({ maxLength: 5000 })),
        },
        { additionalProperties: true },
      ),
    },
  )

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

      // Contain sourcePath to the allowlisted roots before touching the
      // filesystem — see resolveUploadSourcePath for why this is required.
      const resolvedSourcePath = resolveUploadSourcePath(sourcePath);

      // Validate source file exists
      if (!existsSync(resolvedSourcePath)) {
        throw new ValidationError('ファイルが見つかりません');
      }

      // Get file stats
      const stats = await stat(resolvedSourcePath);
      if (stats.size > MAX_FILE_SIZE) {
        throw new ValidationError(
          `ファイルサイズは${MAX_FILE_SIZE / 1024 / 1024}MB以下にしてください`,
        );
      }

      // Get file info
      const fileName = basename(resolvedSourcePath);
      const ext = extname(resolvedSourcePath).slice(1) || '';
      const mimeType = getMimeType(resolvedSourcePath);

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
      await copyFile(resolvedSourcePath, destPath);

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
    const { filePath, resource } = await resolveAuthorizedAttachment(filename);

    const { contentType, disposition } = resolveAttachmentDisposition(
      resource.mimeType || getMimeType(filePath),
      'inline',
    );
    set.headers['Content-Type'] = contentType;
    // Private: this is a per-workspace artifact, not a public asset.
    set.headers['Cache-Control'] = 'private, max-age=3600';
    Object.assign(set.headers, ATTACHMENT_SECURITY_HEADERS);

    const name = resource.fileName
      ? `filename*=UTF-8''${encodeContentDispositionFilename(resource.fileName)}`
      : `filename="${filename}"`;
    set.headers['Content-Disposition'] = `${disposition}; ${name}`;

    return Bun.file(filePath);
  })

  // Download uploaded file (attachment - for downloading)
  .get('/resources/download/:filename', async (context) => {
    const { params, set } = context;
    const { filename } = params;
    const { filePath, resource } = await resolveAuthorizedAttachment(filename);

    const { contentType } = resolveAttachmentDisposition(resource.mimeType, 'attachment');
    set.headers['Content-Type'] = contentType;
    Object.assign(set.headers, ATTACHMENT_SECURITY_HEADERS);

    const name = resource.fileName
      ? `filename*=UTF-8''${encodeContentDispositionFilename(resource.fileName)}`
      : `filename="${filename}"`;
    set.headers['Content-Disposition'] = `attachment; ${name}`;

    return Bun.file(filePath);
  })

  // Delete resource (and file if exists)
  .delete(
    '/resources/:id',
    async (context) => {
      const { params } = context;
      if (!isValidEntityId(params.id)) throw new ValidationError('無効なIDです');
      const id = Number(params.id);

      // Get resource to check for file
      const resource = await prisma.resource.findUnique({ where: { id } });

      if (resource?.filePath) {
        const filePath = join(UPLOAD_DIR, resource.filePath);
        if (existsSync(filePath)) {
          await unlink(filePath);
        }
      }

      return await prisma.resource.delete({ where: { id } });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
