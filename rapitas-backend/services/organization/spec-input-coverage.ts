/**
 * spec-input-coverage
 *
 * Finds a feature whose `入力` line promises more than its own acceptance
 * criteria and screen flow can judge.
 *
 * Why this exists. Measured 2026-10-13 on ContextFlow F-01. Its `入力` named
 * three integrations —「Slackチャンネル、Gmail/メールラベル、Google Driveフォルダ」
 * — while all three of its acceptance criteria and its single 画面導線 line
 * described Slack alone. Every mechanical check passed (8 features, 3 criteria
 * each, zero findings), the task was filed, and then:
 *
 *   planner  → scopes to Slack, matching the criteria exactly (correct)
 *   verifier → reports ⚠️一部失敗 because the 入力 prose is unmet (honest)
 *   gate     → bounces it; a repair cycle cannot implement what has no criteria
 *
 * $7.71 of agent time went into a task that could not reach a pass. The verify
 * gate cannot fix this: it sees only verify.md, and the remaining work there is
 * genuinely unmet requirement text. The decidable moment is here, before the
 * task exists.
 *
 * NOT responsible for judging whether the feature is well designed, or for
 * splitting it — a human or a documentation task decides that.
 */

import { matchFeatureLine, sectionLines } from './requirements-task-plan';

/** A named thing in an `入力` enumeration, e.g. `Slack`, `Gmail`, `Drive`. */
const NAMED_TOKEN = /[A-Za-z][A-Za-z0-9.+-]{2,}/g;

/** Tokens that name a format or protocol rather than a source to integrate. */
const GENERIC_TOKENS = new Set([
  'oauth',
  'json',
  'csv',
  'yaml',
  'xml',
  'http',
  'https',
  'api',
  'url',
  'uri',
  'id',
  'ids',
  'utf',
  'png',
  'jpeg',
  'pdf',
  'sql',
  'llm',
  'ui',
  'web',
]);

/**
 * Algorithms, encodings and ciphers, with or without a bit width.
 *
 * NOTE: measured 2026-10-13 — TempoRaid F-02's input is
 * 「BeatMapとfingerprint(SHA-256)」 and `sha-256` was reported as an
 * uncovered integration target. A hash is how an input is computed, never
 * something to integrate with, so naming one can never make a feature
 * unjudgeable.
 */
const ALGORITHM_TOKEN =
  /^(?:sha|md5|aes|rsa|hmac|jwt|base64|uuid|crc|tls|ssl|gzip|bcrypt|argon2|pbkdf2)(?:[-_.]?\d+)?$/;

/**
 * A parenthetical that LISTS rather than qualifies.
 *
 * NOTE: measured 2026-10-18 on a freshly generated document —
 * 「Googleアカウント（Firebase Authentication のGoogleプロバイダのみ）」 was read
 * as three integration targets (`google`, `firebase`, `authentication`) and the
 * gate rejected a document with nothing wrong with it. A parenthetical without
 * a list separator explains HOW an input is obtained; it does not add targets.
 * One that separates — `(Slack、Gmail、Drive)` — is an enumeration and stays.
 */
const LISTING_PARENTHETICAL = /[、,・/]/;

/** Drop parentheticals that qualify, keeping those that enumerate. */
function withoutQualifiers(text: string): string {
  return text.replace(/[（(]([^）)]*)[）)]/g, (whole, inner: string) =>
    LISTING_PARENTHETICAL.test(inner) ? whole : ' ',
  );
}

/** The `入力` line's enumeration, with qualifying parentheticals removed. */
function inputEnumeration(detail: string): string | null {
  for (const line of detail.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]?\s*入力\s*[:：]\s*(.+)$/);
    if (m) return withoutQualifiers(m[1]);
  }
  return null;
}

/** Distinct named tokens in the text, lowercased, generics dropped. */
function namedTokens(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.match(NAMED_TOKEN) ?? []) {
    const token = raw.toLowerCase();
    if (GENERIC_TOKENS.has(token) || ALGORITHM_TOKEN.test(token)) continue;
    seen.add(token);
  }
  return [...seen];
}

/** One feature whose inputs are only partly judgeable. */
export interface UncoveredInput {
  featureId: string;
  /** Tokens the criteria and screen flow do mention. / 基準が触れている対象 */
  covered: string[];
  /** Tokens nothing judges. / 判定対象になっていない対象 */
  uncovered: string[];
}

/**
 * Features whose `入力` names several things but whose criteria judge only some.
 *
 * Deliberately requires PARTIAL coverage: at least one named input covered and
 * at least one not. That is the exact shape that cannot converge — the planner
 * can legitimately scope down to the covered part, and the uncovered part then
 * has nothing to implement against. A feature where nothing is covered is a
 * different problem, already reported as `missing_criteria`, and one where
 * everything is covered is fine.
 *
 * @param requirements - requirements.md content / 要件定義書
 * @returns One entry per partly-judgeable feature / 部分的にしか判定できない機能
 */
export function findUncoveredInputs(requirements: string): UncoveredInput[] {
  const criteriaText = sectionLines(requirements, '受け入れ基準').join('\n');
  const reachabilityText = sectionLines(requirements, '画面導線').join('\n');
  const out: UncoveredInput[] = [];

  let currentId: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (!currentId) return;
    const enumeration = inputEnumeration(body.join('\n'));
    if (enumeration) {
      const tokens = namedTokens(enumeration);
      if (tokens.length >= 2) {
        // Only this feature's own criteria and flow lines judge it.
        const judged = [criteriaText, reachabilityText]
          .join('\n')
          .split(/\r?\n/)
          .filter((l) => l.includes(`[${currentId}]`) || l.includes(`［${currentId}］`))
          .join('\n')
          .toLowerCase();
        const covered = tokens.filter((t) => judged.includes(t));
        const uncovered = tokens.filter((t) => !judged.includes(t));
        if (covered.length > 0 && uncovered.length > 0) {
          out.push({ featureId: currentId, covered, uncovered });
        }
      }
    }
    body = [];
  };

  for (const line of sectionLines(requirements, '機能要件')) {
    const m = matchFeatureLine(line);
    if (m) {
      flush();
      currentId = m.id;
      continue;
    }
    if (currentId) body.push(line);
  }
  flush();
  return out;
}
