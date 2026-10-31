/**
 * attachment-serving.test
 *
 * The hole this closes: `GET /resources/file/:filename` served an uploaded
 * file inline with its stored MIME type and no CSP. `text/html`,
 * `image/svg+xml`, `text/javascript` and `application/xml` are all in
 * ALLOWED_MIME_TYPES, so an uploaded .html opened in a browser ran with origin
 * http://127.0.0.1:3001 — the API's own origin, on a server the repository
 * documents as having no user auth and endpoints that execute code. A
 * malicious attachment was therefore a path to driving the agent.
 *
 * Loopback binding is no defence here: the browser running the attachment is
 * already on the loopback interface.
 */
import { describe, expect, test } from 'bun:test';
import { resolveAttachmentDisposition, ATTACHMENT_SECURITY_HEADERS } from './attachment-serving';

describe('types that cannot execute stay viewable', () => {
  test.each([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/x-icon',
    'application/pdf',
    'text/plain',
    'text/csv',
    'audio/mpeg',
    'video/mp4',
  ])('%s is served inline with its own type', (mimeType) => {
    const out = resolveAttachmentDisposition(mimeType, 'inline');
    expect(out.disposition).toBe('inline');
    expect(out.contentType.startsWith(mimeType)).toBe(true);
  });

  test('a text type carries a charset so it is not decoded as latin-1', () => {
    expect(resolveAttachmentDisposition('text/plain', 'inline').contentType).toBe(
      'text/plain; charset=utf-8',
    );
  });

  test('a binary type carries no charset', () => {
    expect(resolveAttachmentDisposition('image/png', 'inline').contentType).toBe('image/png');
  });
});

describe('types that can execute are never rendered', () => {
  test.each([
    'text/html',
    'application/xhtml+xml',
    'image/svg+xml',
    'text/javascript',
    'application/javascript',
    'text/xml',
    'application/xml',
    'text/css',
    'application/json',
    'application/zip',
    'application/octet-stream',
    'application/msword',
  ])('%s is forced to download as an opaque blob', (mimeType) => {
    const out = resolveAttachmentDisposition(mimeType, 'inline');
    expect(out.disposition).toBe('attachment');
    // The type is neutralised too: a browser that ignores the disposition
    // header must still not be handed text/html to render.
    expect(out.contentType).toBe('application/octet-stream');
  });

  test('svg is treated as executable even though it is an image', () => {
    // SVG carries <script> and event handlers. It is the one image type that
    // must not be rendered from the API origin.
    expect(resolveAttachmentDisposition('image/svg+xml', 'inline').disposition).toBe('attachment');
  });

  test('a type with parameters is still matched on its essence', () => {
    expect(resolveAttachmentDisposition('text/html; charset=utf-8', 'inline').disposition).toBe(
      'attachment',
    );
  });

  test('matching ignores case and surrounding whitespace', () => {
    expect(resolveAttachmentDisposition('  TEXT/HTML  ', 'inline').disposition).toBe('attachment');
  });

  test('an unknown type is withheld rather than guessed at', () => {
    expect(resolveAttachmentDisposition('application/x-made-up', 'inline').disposition).toBe(
      'attachment',
    );
  });

  test('an empty or missing type is withheld', () => {
    expect(resolveAttachmentDisposition('', 'inline').disposition).toBe('attachment');
    expect(resolveAttachmentDisposition(undefined, 'inline').disposition).toBe('attachment');
  });
});

describe('the download endpoint', () => {
  test('keeps the real type so the OS opens the right application', () => {
    const out = resolveAttachmentDisposition('application/pdf', 'attachment');
    expect(out.disposition).toBe('attachment');
    expect(out.contentType).toBe('application/pdf');
  });

  test('still neutralises an executable type', () => {
    // Content-Disposition: attachment already prevents rendering, but a
    // mis-handled download must not come back as a renderable document.
    expect(resolveAttachmentDisposition('text/html', 'attachment').contentType).toBe(
      'application/octet-stream',
    );
  });
});

describe('security headers', () => {
  test('forbids MIME sniffing, so a .txt cannot be re-read as HTML', () => {
    expect(ATTACHMENT_SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
  });

  test('sandboxes the response into an opaque origin', () => {
    // Even if a type slips through the allowlist, a sandboxed document has no
    // access to the API origin it was served from.
    expect(ATTACHMENT_SECURITY_HEADERS['Content-Security-Policy']).toContain('sandbox');
  });

  test('does not let an attachment be framed by another page', () => {
    expect(ATTACHMENT_SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
  });
});
