/**
 * Resources API Routes
 * Supports both URL-based resources and file uploads
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { ValidationError } from "../middleware/error-handler";
import { mkdir, writeFile, unlink, copyFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { join, basename, extname } from "path";

// 拡張子からMIMEタイプを取得
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase().slice(1);
  const mimeTypes: Record<string, string> = {
    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    ico: "image/x-icon",
    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    // Text
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    html: "text/html",
    css: "text/css",
    xml: "text/xml",
    yaml: "text/yaml",
    yml: "text/yaml",
    // Code
    js: "application/javascript",
    ts: "application/typescript",
    jsx: "application/javascript",
    tsx: "application/typescript",
    json: "application/json",
    sql: "application/sql",
    // Archives
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
    gz: "application/gzip",
    tar: "application/x-tar",
  };
  return mimeTypes[ext] || "application/octet-stream";
}
import { randomUUID } from "crypto";

// Upload directory configuration
const UPLOAD_DIR = join(process.cwd(), "uploads");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/ico",
  "image/x-icon",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Text
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/javascript",
  "text/xml",
  "text/yaml",
  // Code/Data
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/sql",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/gzip",
  "application/x-tar",
  // Other
  "application/octet-stream", // Generic binary (fallback for unknown types)
];

// Ensure upload directory exists
async function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
}

export const resourcesRoutes = new Elysia()
  // Get resources for a task
  .get(
    "/tasks/:id/resources",
    async ({  params  }: any) => {
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError("無効なIDです");

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
