/**
 * Research
 *
 * Looking candidates up, instead of asking her to remember them.
 *
 * Every other thing ラピ does runs with no tools at all — the aux CLI is
 * started with the network, the shell and the repo switched off, because a
 * text-generation call has no business reaching any of them. This is the one
 * job that cannot be done that way: "which companies match what I said"
 * has no answer inside the model, only a plausible-looking one.
 *
 * So the whole design is about the difference between what was found and
 * what was filled in. Each candidate carries the URL it came from, and any
 * field the search did not establish comes back empty rather than guessed.
 * An invented salary figure in a note is read months later as a fact, which
 * is worse than an empty cell someone has to fill.
 *
 * Writes nothing. The caller decides what to do with the findings.
 *
 * Not responsible for deciding what to compare on — that comes from the
 * roadmap's own `comparisonAxes`.
 */
import { sendAIMessage } from '../../utils/ai-client';
import { createLogger } from '../../config/logger';

const logger = createLogger('assistant-research');

/** Most candidates one search may come back with. A shortlist, not a dump. */
export const MAX_CANDIDATES = 8;

/** Caps so one answer cannot fill the panel. */
const MAX_NAME = 120;
const MAX_CELL = 200;
const MAX_URL = 500;

/**
 * Searching is several round-trips, not one.
 *
 * Measured: a trivial one-result query took 12s over three turns. A
 * shortlist with a cell per axis is a different order of work, so this gets
 * its own ceiling rather than the 120s every text call uses.
 */
export const RESEARCH_TIMEOUT_MS = 300_000;

/** One thing that was found, and where it was found. */
export interface Candidate {
  name: string;
  /** Where this came from. No source, no candidate. */
  sourceUrl: string;
  /** Axis name to what the search established. Missing means not found. */
  values: Record<string, string>;
  /** Why it is on the list, in one line. */
  why: string;
}

export interface ResearchFindings {
  /** What was actually searched for, so a bad reading shows. */
  query: string;
  candidates: Candidate[];
  /** Axes the search could not fill for anyone, named rather than hidden. */
  unresolvedAxes: string[];
}

const SYSTEM_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
ユーザーが挙げた条件に合う候補を **WebSearch で実際に調べて** 一覧にします。

やり方:
1. まず条件から検索語を組み立て、WebSearch で検索する。必要なら WebFetch でページを読む。
2. 見つかった候補を最大8件まで挙げる。
3. 各候補について、与えられた「比較の観点」ごとに**調べて分かった値だけ**を書く。

**絶対に守ること:**
- **調べて確認できなかった値は書かない。** その観点のキー自体を省く。
  推測・一般論・「〜と思われる」で埋めない。空欄のほうが、間違った値よりはるかに良い。
- 各候補には必ず sourceUrl（実際に見たページのURL）を付ける。URLが無い候補は挙げない。
- 検索しても候補が見つからない場合は candidates を空配列にする。でっち上げない。
- どの候補についても埋められなかった観点は unresolvedAxes に列挙する。

出力は JSON オブジェクトのみ。前後に説明文を付けない。

JSON の形:
{
  "query": string,
  "candidates": [
    { "name": string, "sourceUrl": string, "values": { "<観点名>": string }, "why": string }
  ],
  "unresolvedAxes": string[]
}`;

/** A non-empty trimmed string, or undefined. */
function asText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : undefined;
}

/** Pull the first JSON object out of a reply that may be fenced or chatty. */
function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Keep only what a real page backs up.
 *
 * A candidate without a source is the failure mode this whole feature has
 * to avoid: it looks exactly like a researched one and is not.
 */
function resolveCandidates(raw: unknown, axes: string[]): Candidate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = (item ?? {}) as {
        name?: unknown;
        sourceUrl?: unknown;
        values?: unknown;
        why?: unknown;
      };
      const name = asText(row.name, MAX_NAME);
      const sourceUrl = asText(row.sourceUrl, MAX_URL);
      // http(s) only, and present: a candidate whose source is "検索結果" or
      // an invented path is indistinguishable from one that was made up.
      if (!name || !sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return null;

      const values: Record<string, string> = {};
      const given = (row.values ?? {}) as Record<string, unknown>;
      for (const axis of axes) {
        const cell = asText(given[axis], MAX_CELL);
        if (cell) values[axis] = cell;
      }
      return { name, sourceUrl, values, why: asText(row.why, MAX_CELL) ?? '' };
    })
    .filter((c): c is Candidate => c !== null)
    .slice(0, MAX_CANDIDATES);
}

/**
 * Which axes nothing could be found for.
 *
 * Derived here rather than believed from the answer: the model naming an
 * axis as unresolved while also filling it, or filling nothing and saying
 * nothing, are both answers the note would carry straight to the reader.
 */
function unresolved(axes: string[], candidates: Candidate[]): string[] {
  return axes.filter((axis) => !candidates.some((c) => c.values[axis]));
}

/**
 * Search for candidates that fit what the user said they wanted.
 *
 * @param input - The goal, what was decided, and what to compare on / 目標・決めたこと・比較の観点
 * @returns What was found with its sources, or null when nothing usable came back / 調査結果
 */
export async function researchCandidates(input: {
  goal: string;
  axes: string[];
  decisions?: { question: string; answer: string }[];
}): Promise<ResearchFindings | null> {
  const goal = input.goal.trim();
  const axes = input.axes.map((a) => a.trim()).filter(Boolean);
  if (!goal || axes.length === 0) return null;

  const decided = (input.decisions ?? []).map((d) => `- ${d.question} → ${d.answer}`).join('\n');

  let raw: Record<string, unknown> | null = null;
  const started = Date.now();
  try {
    const response = await sendAIMessage({
      provider: 'ollama',
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 4096,
      timeoutMs: RESEARCH_TIMEOUT_MS,
      tools: 'web',
      messages: [
        {
          role: 'user',
          content: [
            `やりたいこと:\n${goal}`,
            decided ? `決まっている条件:\n${decided}` : '',
            `比較の観点:\n${axes.map((a) => `- ${a}`).join('\n')}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    });
    raw = extractJson(response.content);
  } catch (err) {
    logger.info({ err }, 'research unavailable');
    return null;
  }
  if (!raw) return null;

  const candidates = resolveCandidates(raw.candidates, axes);
  const findings: ResearchFindings = {
    query: asText(raw.query, MAX_CELL) ?? goal,
    candidates,
    unresolvedAxes: unresolved(axes, candidates),
  };
  logger.info(
    {
      candidates: candidates.length,
      unresolved: findings.unresolvedAxes.length,
      ms: Date.now() - started,
    },
    'research done',
  );
  return findings;
}
