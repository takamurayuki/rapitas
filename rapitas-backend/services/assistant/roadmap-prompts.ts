/**
 * RoadmapPrompts
 *
 * What ラピ is told when she drafts a plan, and what she is told the second
 * time once the user has answered.
 *
 * Two prompts rather than one, because the two rounds want opposite things.
 * The first round's job is to find out what it does not know: it may ask up
 * to six questions and the plan it sketches is provisional. The second
 * round's job is to commit: the answers are in, so it must not ask again —
 * a question in the final round is a loop with no exit, and the screen has
 * nowhere left to put it.
 *
 * Dates are asked for as whole days from today, never as dates. Calendar
 * arithmetic is reliably the part a model gets wrong, and a plan whose
 * deadline is a month out by accident is worse than one with no dates at
 * all. Turning a day count into a date is the caller's job.
 *
 * Not responsible for believing any of the answer — see `roadmap-draft.ts`.
 */

/** Most steps one draft may propose. A roadmap is not a backlog dump. */
export const MAX_ROADMAP_STEPS = 12;

/**
 * Most questions the first round may ask.
 *
 * Six rather than four: the complaint that started this was that she did not
 * ask enough before planning, and one round has to carry the whole interview
 * because she has no memory between messages.
 */
export const MAX_ROADMAP_QUESTIONS = 6;

/** The output shape, written once and quoted by both prompts. */
const SHAPE = `{
  "goal": string,
  "themeChoice": { "kind": "existing", "id": number } | { "kind": "new", "name": string, "reason": string },
  "projectChoice": { "kind": "existing", "id": number } | { "kind": "new", "name": string, "reason": string } | { "kind": "none", "reason": string },
  "deadlineInDays": number | null,
  "questions": [{ "question": string, "options": string[], "recommended": string, "recommendedReason": string }],
  "steps": [{ "title": string, "action": string, "done": string[], "dueInDays": number | null }]
}`;

/** Rules both rounds follow, so the two prompts cannot drift apart. */
const COMMON = `テーマとプロジェクトについて:
- themeChoice は作業を置くテーマ。既存に合うものがあれば existing、無ければ new。無理に既存へ当てはめない。
- projectChoice はまとまりとしてのプロジェクト。既存・新規・不要(none)のいずれか。テーマとは独立した別の分類で、階層ではない。
- id は提示された一覧のものだけを使う。無ければ new または none にする。

ステップの書き方:
- title は「何をするか」が一目で分かる短い文。
- action は着手した人が読んで、そのまま手を動かせる一文。背景や目的の説明は書かない。
- done は完了条件の配列。「終わったかどうか」を他人が見て判断できる形にする（件数・枚数・レビュー済みなど）。1〜4個。
- steps は多くても ${MAX_ROADMAP_STEPS} 個。1つで終わるならそれでよい。

期限について:
- 日付は書かない。**今日から何日後か**を整数で書く（dueInDays / deadlineInDays）。
- ユーザーが期限を言っている場合は deadlineInDays にその日数を入れ、各ステップの dueInDays を期限内に収まるよう割り振る。先にやるものを早い日数にする。
- 期限の指定が無い場合は deadlineInDays と dueInDays をすべて null にする。

守ること:
1. 出力は JSON オブジェクトのみ。前後に説明文を付けない。`;

/**
 * The first round: find out what she does not know, and sketch a plan.
 */
export const INTERVIEW_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
ユーザーがやりたいことを聞いて、計画を立てます。**作成はしません**。提案するだけで、実際の作成は本人の承認後に別途行われます。

これは1回目です。**まだ分かっていないことを聞き出すのが主な仕事**です。steps は暫定で、回答をもらってから作り直します。

質問の作り方:
- 計画の中身が変わるようなことだけを聞く。答えても計画が変わらない質問は入れない。
- 次の観点のうち、ユーザーの発言から読み取れないものを優先して聞く:
  現状（今の状況・持っている材料）／ 制約（使える時間・お金・譲れない条件）／
  期限（いつまでに、どの時点で何が必要か）／ 優先順位（何を犠牲にできるか）／
  判断軸（何をもって良し悪しを決めるか）／ 進め方（どこまで自分でやるか）
- options は2〜4個。自由記述にしない。
- recommended にはどれを勧めるか、recommendedReason にはその理由を1文で書く。
- 多くても ${MAX_ROADMAP_QUESTIONS} 個。聞くことが無ければ空配列にする。

${COMMON}

JSON の形:
${SHAPE}`;

/**
 * The second round: the answers are in, so decide.
 */
export const PLAN_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
ユーザーがやりたいことについて、すでに質問して回答をもらっています。**その回答を踏まえて最終的な計画を作ります**。作成はしません。提案するだけです。

これは2回目です。**もう質問はしません**。questions は必ず空配列にします。
回答で分かったことは計画に反映させる。回答に合わない暫定案は捨ててよい。

粒度について:
- 1ステップは、着手したら区切りまで進められる大きさにする。数日かかるものは分ける。
- 期限がある場合は、期限から逆算して「いつまでに何が終わっていればよいか」で区切る。

${COMMON}

JSON の形:
${SHAPE}`;

/** One question and what the user picked. */
export interface RoadmapAnswer {
  question: string;
  answer: string;
}

/** A theme or project the model is shown. */
export interface NamedRef {
  id: number;
  name: string;
  description?: string | null;
}

/** Today, as the model should read it. */
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

const list = (items: NamedRef[]) =>
  items.length > 0
    ? items
        .map((i) => `- id=${i.id} 「${i.name}」${i.description ? ` — ${i.description}` : ''}`)
        .join('\n')
    : '（まだありません）';

/**
 * Build the message that carries the world, the request and any answers.
 *
 * @param input - What exists, what was asked for, and what was answered / 既存の分類・依頼・回答
 * @returns The user-role message content / ユーザーメッセージの本文
 */
export function buildRoadmapMessage(input: {
  text: string;
  themes: NamedRef[];
  projects: NamedRef[];
  answers?: RoadmapAnswer[];
  today: Date;
}): string {
  const parts = [
    `今日の日付: ${isoDay(input.today)}`,
    `既存のテーマ:\n${list(input.themes)}`,
    `既存のプロジェクト:\n${list(input.projects)}`,
    `やりたいこと:\n${input.text}`,
  ];
  // Only on the second round: the word "回答" appearing at all is what tells
  // the model (and the tests) which round this is.
  if (input.answers && input.answers.length > 0) {
    parts.push(
      `聞いたことと回答:\n${input.answers.map((a) => `- ${a.question} → ${a.answer}`).join('\n')}`,
    );
  }
  return parts.join('\n\n');
}
