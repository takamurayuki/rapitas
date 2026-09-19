/**
 * jev-client
 *
 * Thin HTTP client for Jev (TypeSafe AI's "System-1" decision model):
 * given unstructured context plus a list of typed questions, it returns one
 * structured answer per question in a single fast, cheap, non-autoregressive
 * pass — no free-form generation, so no hallucinated prose to parse.
 * Intended for the many places in this codebase that currently either (a)
 * spend a full LLM call on what is really a yes/no/choice decision, or (b)
 * settle for a brittle keyword/regex heuristic because a full LLM call would
 * be too slow/costly to run on every item.
 *
 * NOTE: the exact request/response JSON shape below is inferred from public
 * descriptions of the Jev API (early access, behind a waitlist as of
 * 2026-09) — RAPITAS_JEV_API_KEY is not yet configured in this project.
 * Verify field names against the real API docs once access is granted;
 * this module is the single place to adjust if the wire format differs.
 * Every caller of this module already treats a null return as "unavailable,
 * proceed as if Jev were never asked" — fixing the wire format later needs
 * no changes outside this file.
 *
 * Not responsible for deciding WHAT to ask or how to act on an answer —
 * only for asking Jev and returning its answers, or null when it can't.
 */
import { createLogger } from '../../config/logger';

const log = createLogger('ai:jev-client');

const JEV_API_URL = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-latest';
/** Jev's own numbers put typical calls around 100ms; leave generous headroom
 * for a cold connection without letting a stuck call block a caller's
 * pipeline (every caller of this module must stay fire-and-forget-safe). */
const JEV_TIMEOUT_MS = 5_000;

/** One typed yes/no question to ask against the given context. */
export interface JevBooleanQuestion {
  /** Caller-chosen id, echoed back on the matching answer. / 呼び出し側が付けるID */
  id: string;
  /** The question, phrased so a higher probability clearly means "yes". / 質問文 */
  prompt: string;
}

/** Jev's answer to one JevBooleanQuestion. */
export interface JevBooleanAnswer {
  id: string;
  /** Probability in [0, 1] that the answer is "yes". / 「はい」である確率 */
  probability: number;
}

interface JevResponseBody {
  answers?: Array<{ id?: unknown; probability?: unknown }>;
}

/**
 * Resolves the Jev API key from the environment. Not a full secret-store
 * lookup like the per-agent provider keys (jev-client.ts is a standalone
 * integration, not tied to AIAgentConfig) — a single project-wide key is
 * the documented access model for early access.
 */
function apiKey(): string | null {
  const v = process.env.RAPITAS_JEV_API_KEY?.trim();
  return v ? v : null;
}

/**
 * True when a Jev API key is configured. Callers use this to skip building
 * a context string entirely when Jev is not set up, rather than paying that
 * cost only to have askJevBoolean immediately return null.
 */
export function isJevConfigured(): boolean {
  return apiKey() !== null;
}

/**
 * Asks Jev a batch of yes/no questions against one shared context.
 *
 * Fails OPEN unconditionally: no API key, a non-OK response, a timeout, or a
 * malformed body all return null — never throws. Callers must treat null as
 * "proceed exactly as if this check did not exist," never as a negative
 * answer; only a real answer in the returned array carries a verdict.
 *
 * @param context - Unstructured text Jev reasons over (task/concern text,
 *   log excerpts, etc.), capped by the caller. / 判定対象の非構造化テキスト
 * @param questions - Yes/no questions to ask against the context. / 質問群
 * @returns Answers (only for questions Jev actually answered), or null when
 *   Jev is unavailable or the call failed. / 回答一覧、利用不可時は null
 */
export async function askJevBoolean(
  context: string,
  questions: JevBooleanQuestion[],
): Promise<JevBooleanAnswer[] | null> {
  if (questions.length === 0) return [];
  const key = apiKey();
  if (!key) return null;
  try {
    const res = await fetch(JEV_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        context,
        questions: questions.map((q) => ({ id: q.id, type: 'boolean', prompt: q.prompt })),
      }),
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, '[jev-client] Non-OK response — treating as unavailable');
      return null;
    }
    const body = (await res.json()) as JevResponseBody;
    if (!Array.isArray(body.answers)) return null;
    const answers: JevBooleanAnswer[] = [];
    for (const a of body.answers) {
      if (typeof a.id !== 'string') continue;
      if (typeof a.probability !== 'number' || !Number.isFinite(a.probability)) continue;
      if (a.probability < 0 || a.probability > 1) continue;
      answers.push({ id: a.id, probability: a.probability });
    }
    return answers;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : err },
      '[jev-client] Request failed — treating as unavailable',
    );
    return null;
  }
}
