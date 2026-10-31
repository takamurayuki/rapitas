/**
 * UrlFetchGuard
 *
 * Decides whether a caller-supplied URL may be fetched by the server, and caps
 * how much of the reply is read.
 * Not responsible for the fetch itself — the route owns that, so this stays
 * pure enough to test the address policy without a network.
 *
 * Why: `POST /url-metadata` fetched any URL it was given and returned the
 * page's `<title>`, which makes it more than a blind SSRF — a caller could
 * name an internal address and read a line of its content back. The worst
 * target is this API itself (`http://127.0.0.1:3001/...`), which the
 * repository documents as having no user auth.
 */
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { ValidationError } from '../../middleware/error-handler';

/** Schemes the server will dereference. Anything else is refused. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** How much of a page body is read. A `<title>` lives in `<head>`. */
export const MAX_METADATA_BYTES = 256 * 1024;

/** Redirect hops followed, each re-checked. */
export const MAX_REDIRECTS = 3;

/** Resolves a hostname to addresses. Injected so tests need no network. */
export type AddressResolver = (hostname: string) => Promise<string[]>;

/** The real resolver: every address the name has, v4 and v6. */
export const resolveAddresses: AddressResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
    return true;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 — "this host"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback — where this API listens
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  // Carrier-grade NAT. Not a plausible target for a bookmark's title, and it
  // is where some metadata services sit, so it is refused rather than probed.
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true; // multicast and broadcast
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // An IPv4-mapped address (::ffff:127.0.0.1) reaches the IPv4 stack, so it
  // has to be judged by the IPv4 rules — not treated as an opaque v6 address.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  if (lower === '::1' || lower === '::') return true;
  const head = lower.split(':')[0];
  if (/^f[cd]/.test(head)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(head)) return true; // fe80::/10 link-local
  if (/^ff/.test(head)) return true; // multicast
  return false;
}

/**
 * Whether an address must not be fetched.
 *
 * Fails closed: an address this code cannot classify is treated as blocked,
 * because it is not one it can vouch for.
 *
 * @param ip - A literal IPv4 or IPv6 address / IPv4 または IPv6 のリテラル
 * @returns true when the address is loopback, private, or otherwise internal / 内部アドレスなら true
 */
export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIPv4(ip);
  if (version === 6) return isBlockedIPv6(ip);
  return true;
}

/**
 * Validate a caller-supplied URL and confirm every address it resolves to is
 * external.
 *
 * Checking the hostname alone is not enough: a public name can resolve inward,
 * so the name is resolved and ALL of its addresses are judged. A literal
 * address is judged directly, without consulting DNS.
 *
 * @param raw - The URL as the caller sent it / 呼び出し元が送った URL
 * @param resolver - How to resolve a hostname / ホスト名の解決方法
 * @returns The parsed URL, safe to fetch / 取得して良いと判定した URL
 * @throws {ValidationError} When the scheme, host, or any resolved address is refused / 拒否する場合
 */
export async function assertFetchableUrl(
  raw: string,
  resolver: AddressResolver = resolveAddresses,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('URLの形式が正しくありません');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new ValidationError('http / https のURLのみ取得できます');
  }

  // `new URL('http://[::1]/')` keeps the brackets in `hostname`.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) {
      throw new ValidationError('内部アドレスのURLは取得できません');
    }
    return url;
  }
  // `localhost` and friends never reach DNS on some systems, and resolving
  // them would answer with a loopback address anyway — refuse by name.
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new ValidationError('内部アドレスのURLは取得できません');
  }

  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    throw new ValidationError('URLのホスト名を解決できませんでした');
  }
  if (addresses.length === 0) {
    throw new ValidationError('URLのホスト名を解決できませんでした');
  }
  if (addresses.some(isBlockedAddress)) {
    throw new ValidationError('内部アドレスのURLは取得できません');
  }
  return url;
}

/**
 * Read a response body as text, stopping at {@link MAX_METADATA_BYTES}.
 *
 * `res.text()` reads whatever the far end sends, so a hostile or merely large
 * page could exhaust memory for the sake of one `<title>`.
 *
 * @param res - The response to read / 読み取るレスポンス
 * @returns The leading bytes of the body, decoded as UTF-8 / 先頭部分の本文
 */
export async function readCappedText(res: Response): Promise<string> {
  const body = res.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_METADATA_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = MAX_METADATA_BYTES - total;
      chunks.push(value.length > remaining ? value.subarray(0, remaining) : value);
      total += Math.min(value.length, remaining);
    }
  } finally {
    // Release the far end even when the cap cut the read short.
    await reader.cancel().catch(() => {});
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8').decode(joined);
}
