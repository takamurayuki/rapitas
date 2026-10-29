/**
 * ResourcesUploadSupport
 *
 * Filesystem plumbing for the task-attachment endpoints: the extension→MIME
 * map, the upload directory, containment for a request-supplied filename, and
 * the size/type allowlists.
 *
 * Deliberately imports NOTHING from the `config` barrel. 59 test files replace
 * that barrel wholesale with `mock.module`, most of them without mirroring
 * `getProjectRoot`, so a module that reads it through the barrel breaks
 * depending on link order. The two functions that do need it
 * (getAllowedUploadSourceRoots / resolveUploadSourcePath) stay in resources.ts
 * for that reason.
 */
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname, resolve, sep } from 'path';
import { ValidationError } from '../../middleware/error-handler';

// Get MIME type from file extension
export function getMimeType(filePath: string): string {
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

// Upload directory configuration
export const UPLOAD_DIR = join(process.cwd(), 'uploads');

/**
 * Resolve a request-supplied filename to an absolute path INSIDE UPLOAD_DIR,
 * or throw if it would escape (path traversal). `path.join` alone does not
 * strip `..`, so a raw `:filename` param like `../../.env` would read secrets.
 *
 * @param filename - Untrusted filename from the URL. / URL由来の未検証ファイル名
 * @returns Contained absolute path. / uploads配下に収まる絶対パス
 * @throws {ValidationError} When the path escapes UPLOAD_DIR. / 配下から外れる場合
 */
export function resolveUploadPath(filename: string): string {
  const resolved = resolve(UPLOAD_DIR, filename);
  const root = resolve(UPLOAD_DIR);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new ValidationError('ファイルが見つかりません');
  }
  return resolved;
}

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const ALLOWED_MIME_TYPES = [
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
export async function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
}
