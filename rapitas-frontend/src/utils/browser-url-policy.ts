/**
 * browser-url-policy
 *
 * What the in-app browser will open, and how an address-bar entry becomes a
 * URL. Mirrors `rapitas-desktop/src-tauri/src/link_webview/policy.rs` so a
 * refused URL never makes a tab, a webview or an iframe — and adds the web
 * app's own origin (`window.location.origin`), which only the frontend knows.
 *
 * NOTE: this guards document loads chosen by the app (entry points). What a
 * page fetches or posts is the backend's to refuse (`createCrossSiteGuard`).
 */
import { API_BASE_URL } from '@/utils/api';

/** The dev server and the origins the backend trusts as the app. */
export const APP_PORT = 3000;
/** The backend API's port in every shipped configuration. */
export const BACKEND_PORT = 3001;
const RESERVED_LOOPBACK_PORTS = new Set([APP_PORT, BACKEND_PORT]);

/** Where a non-URL entry is searched (Q4). Same engine as a new tab. */
export const SEARCH_URL = 'https://www.google.com/search?q=';

/** Loopback aliases: localhost, *.localhost, 127/8, ::1, mapped, unspecified. */
export function isLoopbackAlias(hostname: string): boolean {
  const h = hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h === '0.0.0.0') return true;
  if (h === '::1' || h === '::') return true;
  // IPv4-mapped forms as the URL parser prints them (`::ffff:7f00:1`).
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    return high >> 8 === 127 || (high === 0 && parseInt(mapped[2], 16) === 0);
  }
  return h.startsWith('::ffff:127.') || h === '::ffff:0.0.0.0';
}

function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

/** Origins that are the app or the backend, from this runtime's own view. */
function ownOrigins(): Set<string> {
  const origins = new Set<string>();
  try {
    origins.add(new URL(API_BASE_URL).origin);
  } catch {
    // A relative API base has no origin of its own; the page origin covers it.
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    origins.add(window.location.origin);
  }
  return origins;
}

/**
 * Why the in-app browser refuses a URL, or null when it may open it.
 *
 * @param raw - The URL to check / 判定する URL
 * @returns 'scheme' for non-http(s), 'app-origin' for the app or backend, null when allowed / 拒否理由
 */
export function browserUrlRefusal(raw: string): 'scheme' | 'app-origin' | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'scheme';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'scheme';
  const host = url.hostname.toLowerCase();
  if (host === 'tauri.localhost' || host.endsWith('.tauri.localhost')) return 'app-origin';
  if (isLoopbackAlias(host) && RESERVED_LOOPBACK_PORTS.has(effectivePort(url))) {
    return 'app-origin';
  }
  if (ownOrigins().has(url.origin)) return 'app-origin';
  return null;
}

/** Whether the in-app browser may open this URL. */
export function canOpenInBrowser(raw: string): boolean {
  return browserUrlRefusal(raw) === null;
}

/**
 * Turn an address-bar entry into something to open.
 *
 * A URL (with or without scheme) opens as typed; anything that is not one —
 * a phrase with spaces, a single word with no dot — is searched (Q4). A
 * single dotless word is a search rather than `https://word/` because that
 * is what people mean far more often than an intranet host.
 *
 * @param typed - The address bar's contents / 入力
 * @returns The URL to load, or null for an empty entry / 開く URL
 */
export function resolveAddressInput(typed: string): string | null {
  const trimmed = typed.trim();
  if (!trimmed) return null;
  // `javascript:…`, `mailto:…`, `file:…` are returned as typed so the policy
  // refuses them visibly; prefixing https:// would turn `mailto:a@b.c` into a
  // login to b.c. A colon followed by a digit is a port (`localhost:5173`).
  if (/^[a-z][a-z0-9+.-]*:(?!\/\/|\d)/i.test(trimmed) && !/\s/.test(trimmed)) return trimmed;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const looksLikeHost =
    !/\s/.test(trimmed) &&
    (hasScheme ||
      /^[^/?#:]+\.[^/?#:]+/.test(trimmed) ||
      /^localhost(:\d+)?(\/|$)/i.test(trimmed) ||
      /^[^/?#:]+:\d+(\/|$)/.test(trimmed));
  if (looksLikeHost) {
    const candidate = hasScheme ? trimmed : `https://${trimmed}`;
    try {
      return new URL(candidate).toString();
    } catch {
      // Falls through to a search.
    }
  }
  return `${SEARCH_URL}${encodeURIComponent(trimmed)}`;
}
