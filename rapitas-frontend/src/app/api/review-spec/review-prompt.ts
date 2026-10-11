/**
 * review-prompt
 *
 * The prompt that reads a freshly generated specification and reports what a
 * developer would have to guess, plus the parser for its reply.
 * NOT responsible for the mechanical completeness checks — those come from the
 * backend's spec-consistency service, which the route merges in.
 */

/** One thing the specification leaves open. */
export interface ReviewQuestion {
  /** Stable id used as the answer field's key. / 回答欄のキー */
  id: string;
  /** The question, in the user's language. / 質問文 */
  question: string;
  /** Why it matters — what goes wrong if it stays unanswered. / 未回答だと何が起きるか */
  impact: string;
  /** 2-4 concrete options, so answering is a choice not an essay. / 選択肢 */
  options: string[];
}

/** What the review route returns. */
export interface ReviewSpecResult {
  /** Mechanical findings from the backend checker. / 機械検査の指摘 */
  findings: { code: string; severity: 'error' | 'warning'; message: string }[];
  /** Judgement questions from the model. / モデルが出した質問 */
  questions: ReviewQuestion[];
  /** True when the checker found no error-severity finding. / error が無ければ true */
  implementable: boolean;
  /** Set when the question round could not run. / 質問生成に失敗した理由 */
  degradedReason?: string;
}

// NOTE: The checker already answers the mechanical questions (is every feature
// verifiable, traceable, recorded). This prompt is for the half a regex cannot
// reach: which decisions were made on the model's own authority and would cost
// a rewrite if the user disagrees. It must NOT repeat the checker's findings.
export const reviewSystemPrompt = `あなたはシニアプロダクトマネージャーです。
生成された要件定義書・設計書・技術選定記録を読み、**実装を始める前にユーザー本人に確認すべき事項**を洗い出します。

出力形式（JSONのみ・他の文字列を一切含めない）:
{
  "questions": [
    {
      "id": "短い識別子（英小文字とハイフンのみ）",
      "question": "確認したい内容（1文・日本語）",
      "impact": "未確認のまま進めると何が起きるか（1文・具体的に）",
      "options": ["選択肢1", "選択肢2", "選択肢3"]
    }
  ]
}

## 何を質問するか（重要）
- **文書の中でモデルが独断で決めた事項**を優先する。とくに、ヒアリング結果が「未確認」だった
  のに文書では具体値になっているもの（同時接続数・レイテンシ・可用性・保持期間・課金有無など）。
- その値が**アーキテクチャや費用を確定させている**ものを最優先にする
  （例: 「同時1万人」がRedis常設とスケールアウト構成を決めている → 本当にその規模か）。
- 業務ルール・権利・法令にかかわる前提。
- スコープ外にした項目のうち、ユーザーが実は必須と考えそうなもの。
- 複数の機能要件が同じデータを別の意味で使っている箇所（後で整合しなくなる）。

## 何を質問しないか
- 機能IDの抜け・受け入れ基準の件数・設計との対応漏れ・ADRの参照切れ。
  これらは別の機械検査が既に報告しているので**重複させない**。
- 実装の詳細（変数名・ディレクトリ名など）。手戻りにならない。
- 文書に書いていないことの一般論。

## 件数と形式
- **3〜8件**。多すぎると答えられない。影響の大きい順に並べる。
- options は**2〜4個**の具体的な選択肢にする（❌「その他」だけ → ✅「〜10人」「〜100人」「〜1万人」）。
- 1件も無い場合は "questions": [] を返す。無理に作らない。

JSONのみ出力。`;

/**
 * Parse the model's reply into questions, tolerating code fences and prose.
 *
 * NOTE: Returns [] rather than throwing. A failed question round must degrade
 * to "no questions" — the mechanical findings are still worth showing, and
 * blocking the wizard on a parse failure would be worse than a thinner review.
 *
 * @param raw - The model's reply / モデルの応答
 * @returns Well-formed questions only / 形の正しい質問のみ
 */
export function parseReviewQuestions(raw: string): ReviewQuestion[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const attempt = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  const parsed =
    attempt(cleaned) ?? attempt(cleaned.match(/\{[\s\S]*"questions"[\s\S]*\}/)?.[0] ?? '');
  const list = (parsed as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const out: ReviewQuestion[] = [];
  for (const item of list) {
    const q = item as Partial<ReviewQuestion>;
    const id = typeof q.id === 'string' ? q.id.trim() : '';
    const question = typeof q.question === 'string' ? q.question.trim() : '';
    // A question with no text cannot be answered, and a duplicate id would make
    // two answers collide in the answer map.
    if (!id || !question || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      question,
      impact: typeof q.impact === 'string' ? q.impact.trim() : '',
      options: Array.isArray(q.options)
        ? q.options.filter((o): o is string => typeof o === 'string' && !!o.trim()).slice(0, 4)
        : [],
    });
  }
  return out.slice(0, 8);
}

/**
 * Format the user's answers as the block the generator prompt expects.
 *
 * @param questions - The questions that were asked / 提示した質問
 * @param answers - Answer text by question id / 質問IDごとの回答
 * @returns One line per answered question, or '' / 回答済みのみを1行ずつ、無ければ空文字
 */
export function formatReviewAnswers(
  questions: readonly ReviewQuestion[],
  answers: Readonly<Record<string, string>>,
): string {
  const lines = questions
    .map((q) => ({ q, a: (answers[q.id] ?? '').trim() }))
    .filter(({ a }) => !!a)
    .map(({ q, a }) => `- ${q.question} → ${a}`);
  return lines.join('\n');
}
