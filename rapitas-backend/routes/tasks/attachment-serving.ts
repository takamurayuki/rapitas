/**
 * AttachmentServing
 *
 * Decides how an uploaded task attachment may be handed to a browser: which
 * MIME types are safe to render inline, and the headers every attachment
 * response carries.
 * Not responsible for finding or authorising the file — the route owns both.
 *
 * Why this is not cosmetic: the attachment endpoints live on the API's own
 * origin, and that API has no user auth and endpoints that execute code (see
 * index.ts's bind-host NOTE). `text/html`, `image/svg+xml`, `text/javascript`
 * and `application/xml` are all in ALLOWED_MIME_TYPES, so serving an upload
 * inline with its stored type let a malicious attachment script the API as
 * soon as someone opened it. Binding to loopback is no defence — the browser
 * running the attachment is already on loopback.
 */

/**
 * MIME types that render without an execution context of their own.
 *
 * NOTE: `image/svg+xml` is deliberately ABSENT. SVG is an image that carries
 * `<script>` and event handlers, which makes it the one image type that must
 * not be rendered from this origin. Anything not listed here is withheld
 * rather than guessed at — an allowlist fails closed, a denylist does not.
 */
const INLINE_SAFE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/ico',
  'image/x-icon',
  'application/pdf',
  'text/plain',
  'text/csv',
]);

/** Families that are safe inline regardless of their specific subtype. */
const INLINE_SAFE_PREFIXES = ['audio/', 'video/'];

/** Types whose bytes are handed over without claiming what they are. */
const OPAQUE_MIME_TYPE = 'application/octet-stream';

/**
 * Headers every attachment response carries, inline or not.
 *
 * `nosniff` stops a browser re-reading a `text/plain` upload as HTML.
 * `sandbox` (with no tokens — the most restrictive form) drops the response
 * into an opaque origin with no scripts, so a type that ever slips past the
 * allowlist still cannot reach the API it came from. `DENY` keeps an
 * attachment out of another page's frame.
 */
export const ATTACHMENT_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
  'X-Frame-Options': 'DENY',
};

/** How an attachment response should present a file. */
export interface AttachmentDisposition {
  /** The `Content-Type` to send. */
  contentType: string;
  /** The `Content-Disposition` kind to send. */
  disposition: 'inline' | 'attachment';
}

/** `text/html; charset=utf-8` -> `text/html`, lowercased and trimmed. */
function essence(mimeType: string | undefined | null): string {
  return (mimeType ?? '').split(';')[0].trim().toLowerCase();
}

function isInlineSafe(essenceType: string): boolean {
  if (INLINE_SAFE_MIME_TYPES.has(essenceType)) return true;
  return INLINE_SAFE_PREFIXES.some((prefix) => essenceType.startsWith(prefix));
}

/**
 * Decide the `Content-Type` and `Content-Disposition` for serving one file.
 *
 * A type that could execute is downgraded to an opaque download even when the
 * caller asked for inline: `Content-Disposition: attachment` keeps the browser
 * from rendering it, and neutralising the type means a browser that ignores
 * the disposition is still not handed `text/html`.
 *
 * @param mimeType - The stored or detected MIME type / 保存済み・推定の MIME タイプ
 * @param requested - What the endpoint wants: viewing or downloading / 閲覧かダウンロードか
 * @returns The type and disposition to send / 送るべき type と disposition
 */
export function resolveAttachmentDisposition(
  mimeType: string | undefined | null,
  requested: 'inline' | 'attachment',
): AttachmentDisposition {
  const essenceType = essence(mimeType);
  const safe = isInlineSafe(essenceType);

  if (!safe) {
    return { contentType: OPAQUE_MIME_TYPE, disposition: 'attachment' };
  }
  const contentType = essenceType.startsWith('text/')
    ? `${essenceType}; charset=utf-8`
    : essenceType;
  return { contentType, disposition: requested };
}
