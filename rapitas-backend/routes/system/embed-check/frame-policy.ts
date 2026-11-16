/**
 * frame-policy
 *
 * Decide from response headers whether a page would let `embedderOrigin`
 * show it in an iframe: CSP `frame-ancestors` (CSP Level 3 §6.4.2) first,
 * `X-Frame-Options` only when no enforced policy has frame-ancestors (HTML's
 * processing model). Pure: no I/O, so every rule is unit-testable.
 *
 * Deliberately three-valued. Anything this parser does not fully understand
 * (a host-source with a path, an unknown quoted keyword, ALLOW-FROM) yields
 * `unknown` rather than a guess — the caller still opens the frame with the
 * "open externally" rescue visible, which is the safe failure.
 */

/** The verdict returned to the frontend; nothing else from the page is. */
export type EmbedVerdict = 'embeddable' | 'refused' | 'unknown';

/** The headers that matter, already read from the final response. */
export interface FramePolicyHeaders {
  /** Every enforced `Content-Security-Policy` value; multiple headers arrive comma-joined. */
  csp: string | null;
  /** `X-Frame-Options`, comma-joined when sent more than once. */
  xFrameOptions: string | null;
}

type Match = 'match' | 'no-match' | 'unknown';

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

/** The port a URL actually uses, filling in the scheme default. */
function effectivePort(url: URL): string {
  return url.port || DEFAULT_PORTS[url.protocol] || '';
}

/**
 * Split CSP header text into policies and return each policy's
 * frame-ancestors source list, or null for a policy without one.
 *
 * Within a policy only the FIRST occurrence of a directive counts (CSP3
 * §2.2.1 — duplicates are ignored), and directive names are ASCII
 * case-insensitive.
 */
function frameAncestorsLists(csp: string | null): Array<string[] | null> {
  if (!csp) return [];
  return csp.split(',').map((policy) => {
    for (const directive of policy.split(';')) {
      const tokens = directive.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      if (tokens[0].toLowerCase() === 'frame-ancestors') return tokens.slice(1);
    }
    return null;
  });
}

/** Match one host-source expression (`[scheme://]host[:port]`) against the embedder. */
function matchHostSource(expr: string, embedder: URL, target: URL): Match {
  const m =
    /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\*|\d+))?(\/.*)?$/i.exec(
      expr,
    );
  if (!m) return 'unknown';
  const [, scheme, host, port, path] = m;
  // Path matching is not implemented; a path in the expression could change
  // the answer, so it is not guessed at.
  if (path !== undefined) return 'unknown';

  const embedderScheme = embedder.protocol.slice(0, -1);
  if (scheme) {
    const s = scheme.toLowerCase();
    // http: also admits its secure upgrade, https:.
    const schemeOk = s === embedderScheme || (s === 'http' && embedderScheme === 'https');
    if (!schemeOk) return 'no-match';
  } else {
    // No scheme: the embedder must use the protected page's scheme, or its
    // secure upgrade.
    const targetScheme = target.protocol.slice(0, -1);
    const schemeOk =
      embedderScheme === targetScheme || (targetScheme === 'http' && embedderScheme === 'https');
    if (!schemeOk) return 'no-match';
  }

  const h = host.toLowerCase();
  const eh = embedder.hostname.toLowerCase();
  if (h === '*') {
    // A bare `*` host-source is handled as the wildcard keyword elsewhere;
    // `scheme://*` reaches here and matches any host.
  } else if (h.startsWith('*.')) {
    // `*.example.com` covers subdomains only, never example.com itself.
    if (!eh.endsWith(h.slice(1))) return 'no-match';
  } else if (h !== eh) {
    return 'no-match';
  }

  if (port === '*') return 'match';
  const ep = effectivePort(embedder);
  if (port) return port === ep ? 'match' : 'no-match';
  // Omitted port: the scheme's default, with the http→https upgrade (80→443).
  const expected = scheme
    ? DEFAULT_PORTS[`${scheme.toLowerCase()}:`]
    : DEFAULT_PORTS[target.protocol];
  if (ep === expected) return 'match';
  if (expected === '80' && ep === '443' && embedder.protocol === 'https:') return 'match';
  return 'no-match';
}

/** Match one source expression from a frame-ancestors list. */
function matchSource(expr: string, embedder: URL, target: URL): Match {
  const lower = expr.toLowerCase();
  if (lower === '*') {
    // `*` covers network schemes; the web app is always served over one.
    return embedder.protocol === 'http:' || embedder.protocol === 'https:' ? 'match' : 'no-match';
  }
  if (lower === "'self'") {
    if (embedder.origin === target.origin) return 'match';
    // Secure upgrade of the protected page's own origin.
    const upgraded =
      target.protocol === 'http:' &&
      embedder.protocol === 'https:' &&
      embedder.hostname === target.hostname;
    return upgraded ? 'match' : 'no-match';
  }
  if (lower.startsWith("'")) return 'unknown';
  if (lower === 'http:') {
    return embedder.protocol === 'http:' || embedder.protocol === 'https:' ? 'match' : 'no-match';
  }
  if (lower === 'https:') return embedder.protocol === 'https:' ? 'match' : 'no-match';
  if (/^[a-z][a-z0-9+.-]*:$/.test(lower)) return 'unknown';
  return matchHostSource(expr, embedder, target);
}

/** Evaluate one policy's frame-ancestors list. */
function evaluateList(list: string[], embedder: URL, target: URL): Match {
  // 'none' is only meaningful alone; mixed with other sources it is ignored.
  const sources = list.filter((s) => s.toLowerCase() !== "'none'");
  if (sources.length === 0) return 'no-match';
  let sawUnknown = false;
  for (const source of sources) {
    const result = matchSource(source, embedder, target);
    if (result === 'match') return 'match';
    if (result === 'unknown') sawUnknown = true;
  }
  return sawUnknown ? 'unknown' : 'no-match';
}

/** X-Frame-Options, used only when no policy carries frame-ancestors. */
function evaluateXfo(value: string | null): EmbedVerdict {
  if (value === null) return 'embeddable';
  const tokens = value
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return 'embeddable';
  if (tokens.includes('deny')) return 'refused';
  // The embedder is the app's origin, never the page's own, so SAMEORIGIN
  // refuses it.
  if (tokens.every((t) => t === 'sameorigin')) return 'refused';
  // ALLOW-FROM (obsolete), garbage, or mixed values.
  return 'unknown';
}

/**
 * Whether `target` would render inside a frame on `embedderOrigin`.
 *
 * @param headers - The final response's relevant headers / 最終応答のヘッダー
 * @param target - The page being embedded / 埋め込む対象 URL
 * @param embedderOrigin - The app's origin that would hold the iframe / 埋め込み元 origin
 * @returns The three-valued verdict / 判定（3値）
 */
export function evaluateFramePolicy(
  headers: FramePolicyHeaders,
  target: URL,
  embedderOrigin: string,
): EmbedVerdict {
  let embedder: URL;
  try {
    embedder = new URL(embedderOrigin);
  } catch {
    return 'unknown';
  }

  const lists = frameAncestorsLists(headers.csp).filter((l): l is string[] => l !== null);
  if (lists.length > 0) {
    // frame-ancestors present anywhere ⇒ X-Frame-Options is ignored. Every
    // such policy must allow the embedder; one refusal refuses.
    let sawUnknown = false;
    for (const list of lists) {
      const result = evaluateList(list, embedder, target);
      if (result === 'no-match') return 'refused';
      if (result === 'unknown') sawUnknown = true;
    }
    return sawUnknown ? 'unknown' : 'embeddable';
  }
  return evaluateXfo(headers.xFrameOptions);
}
