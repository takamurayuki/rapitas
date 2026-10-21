/**
 * IntentRouter
 *
 * One sentence in, one of ラピ's destinations out.
 *
 * The tab bar was the only way in, and it cannot stay short: four of her five
 * modes are useful from anywhere, so hiding by page does not slow the growth,
 * and merging only works while two things happen to be one job. A single
 * input that routes by intent does not grow at all — a new capability becomes
 * another destination, not another tab.
 *
 * Routing is safe to let a model decide because **no destination writes
 * anything**. Each one reads and shows; the two that can eventually change
 * something — filing a task, deleting tasks — ask for confirmation of their
 * own after you arrive. So the cost of a wrong turn is a wasted read, and the
 * cost of refusing to turn is nothing at all, because the tabs still work.
 *
 * That asymmetry decides the behaviour here: when it does not know, it says
 * so. A shrug costs a click; a confident wrong answer costs the belief that
 * she understood.
 *
 * Not responsible for doing anything at the destination — see the routes
 * under `routes/ai/`.
 */
import { sendAIMessage } from '../../utils/ai-client';
import { createLogger } from '../../config/logger';

const logger = createLogger('assistant-router');

/**
 * Where a sentence can be sent.
 *
 * These are ラピ's panel modes, named the same, because the destination of a
 * routed sentence is a tab she switches to — the input is a front door to
 * what is already there, not a second implementation of it.
 */
export const ROUTABLE_INTENTS = ['watch', 'create', 'ask', 'tidy', 'consult'] as const;

export type RoutableIntent = (typeof ROUTABLE_INTENTS)[number];

export interface RoutedIntent {
  intent: RoutableIntent;
  /** Why she took it that way, shown so a wrong turn is readable. */
  reason: string;
}

/** Said when the model routes but will not say why. */
const NO_REASON_GIVEN = 'その言い方から判断しました。';

/** Keeps one chatty answer from filling the bubble. */
const MAX_REASON = 120;

const SYSTEM_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
ユーザーの一文を読み、どの行き先に送るかだけを決めます。処理そのものは行き先が行います。

行き先:
- watch: いま手当てが要るタスクの一覧。「何かある?」「滞ってるものは」など
- create: 新しいタスクを起票する。「〜を直したい」「〜を作る」など
- ask: 既存タスクを検索して件数や一覧を答える。「〜は何件」「〜を探して」など
- tidy: 不要なタスクを片付ける。「古いのを消して」「整理して」など
- consult: いま開いているタスクについて相談する。「このタスクを分析して」など

守ること:
1. 出力は JSON オブジェクトのみ。前後に説明文を付けない。
2. 行き先を1つだけ選ぶ。迷ったら最もよく当てはまるものを選ぶ。
3. どの行き先にも当てはまらないと判断したら intent に "unknown" を入れる。無理に選ばない。
4. reason には「なぜその行き先にしたか」を日本語で1文だけ書く。

JSON の形:
{ "intent": "watch" | "create" | "ask" | "tidy" | "consult" | "unknown", "reason": string }`;

/** What the model returns, before any of it is believed. */
interface RawRoute {
  intent?: unknown;
  reason?: unknown;
}

/** Pull the first JSON object out of a reply that may be fenced or chatty. */
function extractJson(text: string): RawRoute | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as RawRoute;
  } catch {
    return null;
  }
}

/**
 * Decide where a sentence should go.
 *
 * @param text - What the user typed / 入力された一文
 * @param hasOpenTask - Whether the open-task destination exists right now / 「このタスク」が成立するか
 * @returns The destination and why, or null when it will not guess / 行き先と理由（判断できなければ null）
 */
export async function routeIntent(
  text: string,
  hasOpenTask: boolean,
): Promise<RoutedIntent | null> {
  const utterance = text.trim();
  if (!utterance) return null;

  // Stated rather than left for the model to infer: `consult` is the one
  // destination that can fail to exist, and routing to a tab that is not in
  // the bar strands the user on nothing.
  const context = hasOpenTask
    ? 'いまタスクが開かれています。consult を選べます。'
    : 'いまタスクは開かれていません。consult は選べません。';

  let raw: RawRoute | null = null;
  try {
    const response = await sendAIMessage({
      provider: 'ollama',
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 256,
      messages: [{ role: 'user', content: `${context}\n\n入力:\n${utterance}` }],
    });
    raw = extractJson(response.content);
  } catch (err) {
    logger.info({ err }, 'routing unavailable');
    return null;
  }
  if (!raw) return null;

  const intent = raw.intent;
  if (typeof intent !== 'string') return null;
  if (!(ROUTABLE_INTENTS as readonly string[]).includes(intent)) {
    // Covers "unknown" and anything invented. Both mean the same thing here:
    // leave the tabs to it.
    logger.info({ intent, utterance }, 'no destination');
    return null;
  }
  if (intent === 'consult' && !hasOpenTask) {
    logger.info({ utterance }, 'routed to the open task with none open');
    return null;
  }

  const reason =
    typeof raw.reason === 'string' && raw.reason.trim()
      ? raw.reason.trim().slice(0, MAX_REASON)
      : NO_REASON_GIVEN;

  logger.info({ intent, utterance }, 'routed');
  return { intent: intent as RoutableIntent, reason };
}
