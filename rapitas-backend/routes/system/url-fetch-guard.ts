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

/**
 * Expand an IPv6 literal to its 16 bytes.
 *
 * NOTE(security): Judging the address STRING was the first implementation's
 * mistake. It matched `::ffff:127.0.0.1` and missed every other spelling of
 * that same address — reproduced 2026-10-31, 7 of 12 forms got through,
 * including `::ffff:7f00:1` (hex), `0:0:0:0:0:ffff:127.0.0.1` (uncompressed)
 * and `::ffff:a9fe:a9fe` (the cloud-metadata address in hex). One address has
 * many spellings; only the bytes are unambiguous.
 *
 * @param ip - An IPv6 literal, already validated by `isIP` / 検証済みの IPv6 リテラル
 * @returns The 16 bytes, or null when it cannot be expanded / 16バイト、展開不能なら null
 */
function ipv6ToBytes(ip: string): Uint8Array | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;

  const expand = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    const pieces = part.split(':');
    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i];
      // A trailing dotted quad occupies the last two hextets.
      if (piece.includes('.')) {
        if (i !== pieces.length - 1) return null;
        const octets = piece.split('.').map(Number);
        if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
          return null;
        }
        out.push(...octets);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
      const value = Number.parseInt(piece, 16);
      out.push((value >> 8) & 0xff, value & 0xff);
    }
    return out;
  };

  const head = expand(halves[0]);
  const tail = halves.length === 2 ? expand(halves[1]) : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) return head.length === 16 ? new Uint8Array(head) : null;

  const gap = 16 - head.length - tail.length;
  if (gap < 0) return null;
  return new Uint8Array([...head, ...new Array(gap).fill(0), ...tail]);
}

/** The well-known NAT64 prefix, 64:ff9b::/96, which embeds an IPv4 address. */
const NAT64_PREFIX = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];

function startsWithBytes(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

/** The embedded IPv4 address as dotted quad, for the forms that carry one. */
function embeddedIPv4(bytes: Uint8Array): string | null {
  const firstTenZero = bytes.slice(0, 10).every((b) => b === 0);
  // ::ffff:a.b.c.d — IPv4-mapped.
  if (firstTenZero && bytes[10] === 0xff && bytes[11] === 0xff) {
    return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
  }
  // ::a.b.c.d — deprecated IPv4-compatible. Excludes :: and ::1, which are
  // judged on their own below.
  if (firstTenZero && bytes[10] === 0 && bytes[11] === 0) {
    const last = (bytes[12] << 24) | (bytes[13] << 16) | (bytes[14] << 8) | bytes[15];
    if (last !== 0 && last !== 1) {
      return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    }
  }
  // 64:ff9b::a.b.c.d — NAT64 translation of an IPv4 destination.
  if (startsWithBytes(bytes, NAT64_PREFIX)) {
    return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
  }
  return null;
}

function isBlockedIPv6(ip: string): boolean {
  const bytes = ipv6ToBytes(ip.toLowerCase());
  if (bytes === null) return true;

  // Any form that carries an IPv4 address reaches the IPv4 stack, so it is
  // judged by the IPv4 rules rather than treated as an opaque v6 address.
  const embedded = embeddedIPv4(bytes);
  if (embedded !== null) return isBlockedIPv4(embedded);

  const allZero = bytes.every((b) => b === 0);
  if (allZero) return true; // ::
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true; // ::1
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast
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
