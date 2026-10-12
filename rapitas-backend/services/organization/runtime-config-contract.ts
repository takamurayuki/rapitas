/**
 * runtime-config-contract
 *
 * The rules a project's runtime verification config must follow so the harness
 * — not the app — decides which port it listens on.
 *
 * Why this exists. `parseRuntimeConfig` accepts a config that hardcodes a port
 * and names `localhost`, because `{port}` is documented as optional
 * substitution. Measured 2026-10-12 on ContextFlow task #1212: the generated
 * config was `{"start":"pnpm dev -p 3210","url":"http://localhost:3210"}`, the
 * harness could not place the app on its allocated port, Next.js fell back to
 * its own default, found 3000 taken by rapitas's frontend, auto-incremented,
 * and ended up LISTENING on `[::]:3001` — the backend's port. Any client that
 * resolves `localhost` to `::1` then reaches the generated app instead of
 * rapitas. The same incident shape cost a two-hour outage on 2026-07-08.
 *
 * NOT responsible for parsing, defaulting or loading the config — runtime-smoke
 * owns all three. This module only says whether a config is safe to launch, so
 * the environment-setup task can state the rule and a caller can enforce it.
 */

/**
 * Ports a generated project must never be configured onto.
 *
 * 3000 is rapitas's frontend and 3001 its backend; a dev server that grabs
 * either one shadows rapitas itself rather than merely failing.
 */
export const RESERVED_PORTS: readonly number[] = [3000, 3001];

/** The only host a runtime URL may name. */
export const REQUIRED_HOST = '127.0.0.1';

/** The placeholder the harness substitutes with the port it allocated. */
export const PORT_PLACEHOLDER = '{port}';

/** One contract violation, with a message the agent can act on. */
export interface RuntimeContractViolation {
  /** Stable identifier for tests and UI grouping. / 安定ID */
  code:
    | 'start_missing_port_placeholder'
    | 'url_missing_port_placeholder'
    | 'url_host_not_loopback'
    | 'reserved_port';
  message: string;
}

/** Any bare port number in the text, ignoring the placeholder itself. */
function literalPorts(text: string): number[] {
  const withoutPlaceholder = text.split(PORT_PLACEHOLDER).join('');
  const matches = withoutPlaceholder.match(/(?<![\d.])\d{2,5}(?![\d.])/g) ?? [];
  return matches.map(Number).filter((n) => Number.isFinite(n));
}

/**
 * Check a runtime config against the launch contract.
 *
 * Deliberately takes the raw fields rather than a parsed config: the point is
 * to judge what the author WROTE, and `{port}` is gone once substituted.
 *
 * @param raw - The config's `start` and `url` as written / 記述されたまま の start と url
 * @returns Violations, empty when the config is safe to launch / 違反一覧
 */
export function checkRuntimeConfigContract(raw: {
  start?: unknown;
  url?: unknown;
}): RuntimeContractViolation[] {
  const violations: RuntimeContractViolation[] = [];
  const start = typeof raw.start === 'string' ? raw.start : '';
  const url = typeof raw.url === 'string' ? raw.url : '';

  if (!start.includes(PORT_PLACEHOLDER)) {
    violations.push({
      code: 'start_missing_port_placeholder',
      message:
        `"start" に ${PORT_PLACEHOLDER} がありません。ポートを固定すると、` +
        'ハーネスが割り当てたポートでアプリを起動できず、dev サーバーが自分で' +
        '別のポート（rapitas の 3000/3001 を含む）を選んでしまいます。',
    });
  }
  if (!url.includes(PORT_PLACEHOLDER)) {
    violations.push({
      code: 'url_missing_port_placeholder',
      message:
        `"url" に ${PORT_PLACEHOLDER} がありません。起動ポートと待ち受けURLが` +
        'ずれると、起動していても到達できず検証不能になります。',
    });
  }

  const host = hostOf(url);
  if (host !== null && host !== REQUIRED_HOST) {
    violations.push({
      code: 'url_host_not_loopback',
      message:
        `"url" のホストは ${REQUIRED_HOST} にしてください（現在: ${host}）。` +
        'localhost は環境によって ::1 に解決され、IPv6 側で待ち受けている' +
        '別プロセスへ接続が横取りされます。',
    });
  }

  for (const [field, text] of [
    ['start', start],
    ['url', url],
  ] as const) {
    for (const port of literalPorts(text)) {
      if (RESERVED_PORTS.includes(port)) {
        violations.push({
          code: 'reserved_port',
          message:
            `"${field}" がポート ${port} を指しています。${RESERVED_PORTS.join(' と ')} は ` +
            'rapitas 自身（フロントエンドとバックエンド）が使うため、生成プロジェクトでは使えません。',
        });
      }
    }
  }

  return violations;
}

/** The host of an http(s) URL, or null when it is not parseable as one. */
function hostOf(url: string): string | null {
  if (!url) return null;
  // The placeholder is not a legal port, so swap in a dummy before parsing.
  const parseable = url.split(PORT_PLACEHOLDER).join('1');
  try {
    return new URL(parseable).hostname;
  } catch {
    return null;
  }
}
