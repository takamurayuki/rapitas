/**
 * embed-check-service
 *
 * Fetch a page's headers (never its body) and decide whether the web app may
 * show it in an iframe, with a short cache. Not responsible for the HTTP
 * route or for trusting the embedder origin — the route checks that first.
 *
 * Guarantees (nav60 §3.2): the first URL and every redirect hop go through
 * url-fetch-guard, so a name or literal resolving to a private/loopback
 * address AT CHECK TIME is never fetched. At most 1 + MAX_REDIRECTS (=4)
 * GETs are made per check, each with only a User-Agent header, and each
 * body is cancelled unread. Only the three-valued verdict leaves here.
 *
 * NOTE: Not guaranteed — a DNS answer that changes between the guard's
 * lookup and fetch's own lookup (rebinding). Pinning the connection to the
 * checked address needs a resolver hook Bun's fetch does not expose without
 * breaking SNI/certificate checks, so stage 1 accepts that residual risk.
 */
import { assertFetchableUrl, type AddressResolver } from '../url-fetch-guard';
import { fetchWithCheckedRedirects } from '../checked-redirect-fetch';
import { evaluateFramePolicy, type EmbedVerdict } from './frame-policy';

/** DNS, every redirect and the response headers together must fit in this. */
export const EMBED_CHECK_TIMEOUT_MS = 5000;
/** How long a verdict is reused. */
export const EMBED_CHECK_TTL_MS = 10 * 60 * 1000;
/** Most verdicts kept; the oldest is dropped first. */
export const EMBED_CHECK_MAX_ENTRIES = 500;

/** Collaborators, injectable for tests. */
export interface EmbedCheckDeps {
  resolver?: AddressResolver;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

interface CacheEntry {
  verdict: EmbedVerdict;
  at: number;
}

/**
 * A cache of verdicts keyed by target URL (fragment removed) and embedder.
 *
 * Keyed on the whole URL, not the origin: one site can send different
 * framing headers per page.
 */
export class EmbedVerdictCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs = EMBED_CHECK_TTL_MS,
    private readonly maxEntries = EMBED_CHECK_MAX_ENTRIES,
  ) {}

  /** The cache key for a target and an embedder. */
  static keyOf(target: URL, embedderOrigin: string): string {
    const url = new URL(target.toString());
    url.hash = '';
    return `${url.toString()}\n${embedderOrigin}`;
  }

  get(key: string, now: number): EmbedVerdict | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (now - entry.at >= this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return entry.verdict;
  }

  set(key: string, verdict: EmbedVerdict, now: number): void {
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { verdict, at: now });
  }

  get size(): number {
    return this.entries.size;
  }
}

const sharedCache = new EmbedVerdictCache();

/** Fetch and evaluate, without the cache. */
async function evaluateUncached(
  rawUrl: string,
  embedderOrigin: string,
  deps: EmbedCheckDeps,
  signal: AbortSignal,
): Promise<{ verdict: EmbedVerdict; target: URL | null }> {
  let target: URL;
  try {
    target = await assertFetchableUrl(rawUrl, deps.resolver);
  } catch {
    // localhost, private addresses, non-http(s), unresolvable names.
    return { verdict: 'unknown', target: null };
  }
  const res = await fetchWithCheckedRedirects(target, {
    signal,
    resolver: deps.resolver,
    fetchImpl: deps.fetchImpl,
  });
  if (!res) return { verdict: 'unknown', target };
  // The iframe shows the FINAL response, so its headers decide.
  const headers = {
    csp: res.headers.get('content-security-policy'),
    xFrameOptions: res.headers.get('x-frame-options'),
  };
  void res.body?.cancel().catch(() => {});
  const finalUrl = res.url ? new URL(res.url) : target;
  return { verdict: evaluateFramePolicy(headers, finalUrl, embedderOrigin), target };
}

/**
 * Whether `rawUrl` can be shown in an iframe on `embedderOrigin`.
 *
 * @param rawUrl - The page the user asked to open / 開こうとしている URL
 * @param embedderOrigin - The (already trusted) app origin / 信頼済みの埋め込み元
 * @param deps - Injected collaborators and cache / 差し替え用の依存
 * @param cache - The verdict cache / 判定キャッシュ
 * @returns embeddable / refused / unknown — never anything from the page / 3値の判定
 */
export async function checkEmbeddable(
  rawUrl: string,
  embedderOrigin: string,
  deps: EmbedCheckDeps = {},
  cache: EmbedVerdictCache = sharedCache,
): Promise<EmbedVerdict> {
  const now = deps.now ?? Date.now;
  let key: string | null = null;
  try {
    key = EmbedVerdictCache.keyOf(new URL(rawUrl), embedderOrigin);
  } catch {
    return 'unknown';
  }
  const cached = cache.get(key, now());
  if (cached) return cached;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // One deadline for the whole chain. The guard's DNS lookup takes no
  // signal, so the race (not only the abort) is what bounds it.
  const deadline = new Promise<{ verdict: EmbedVerdict; target: null }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ verdict: 'unknown', target: null });
    }, deps.timeoutMs ?? EMBED_CHECK_TIMEOUT_MS);
  });
  let verdict: EmbedVerdict;
  try {
    ({ verdict } = await Promise.race([
      evaluateUncached(rawUrl, embedderOrigin, deps, controller.signal),
      deadline,
    ]));
  } catch {
    verdict = 'unknown';
  } finally {
    clearTimeout(timer);
  }
  cache.set(key, verdict, now());
  return verdict;
}
