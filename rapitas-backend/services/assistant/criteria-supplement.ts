/**
 * CriteriaSupplement
 *
 * The checkable sentences ラピ adds when a proposal has fewer than three
 * completion criteria (companion design 段B: 3〜7 checkable sentences).
 *
 * A sentence is only checkable if it names an operation, a result and the
 * evidence that shows it, in the terms of the task at hand. So the task is
 * first read for its kind, and each kind gets its own sentence shapes:
 *
 * - `software`: changes the jury can check from the diff — where the change
 *   is, that nothing unrelated broke — plus one the person checks by using it.
 *   "既存の機能を壊さない" is a software sentence and appears only here.
 * - `errand` (life tasks and procedures — 予約, 申請, 支払い, 購入, 連絡): what
 *   has to be settled and the record that proves it (予約番号, 控え, 領収書 …).
 *   There is no diff, so every sentence is the person's to check.
 * - `unknown`: too little to go on. The sentences stay generic, so they are
 *   never offered to the jury: they are marked as the person's, and flagged
 *   `generic` so the card asks for them to be rewritten before confirming.
 *
 * Heuristic keyword rules, deliberately: the card shows what was decided and
 * the user edits it. Pure — no database, no model.
 */
import type { CriterionVerifier } from './criteria-wording';

/** What sort of work a task is, as far as its wording tells. */
export type TaskKind = 'software' | 'errand' | 'unknown';

/** One sentence ラピ offers to fill a proposal up to the minimum. */
export interface SupplementCandidate {
  text: string;
  verifier: CriterionVerifier;
  /** True when the material was too thin to say anything task-specific. */
  generic?: boolean;
}

/** What the sentences are built from. */
export interface SupplementInput {
  title: string;
  description?: string | null;
  goals?: string[];
  constraints?: string[];
}

/** Words that mean the work is a change to software. Checked before errands: "予約機能を実装" is software. */
const SOFTWARE =
  /実装|修正|バグ|不具合|機能|画面|テスト|コード|リファクタ|デプロイ|リリース|ビルド|プルリク|エラー|アプリ|サーバー?|データベース|スクリプト|ログイン|エンドポイント|コンポーネント|フロントエンド|バックエンド|マイグレーション|ライブラリ|\b(?:API|UI|DB|CI|PR|CLI|SDK|bug|fix|test|refactor|deploy|build|endpoint|lint)\b/i;

/**
 * Errands with a known shape: what must be settled, and the record that proves it.
 *
 * Order matters: the first match wins ("予約の支払い" reads as a booking).
 */
const ERRANDS: ReadonlyArray<{ pattern: RegExp; sentences: (name: string) => string[] }> = [
  {
    pattern: /予約/,
    sentences: (name) => [
      `「${name}」の予約の日時と場所（医院・店など）が決まっている`,
      '予約が取れたことを、予約番号・予約確認の画面・確認メールのどれかで後から確かめられる形で残している',
      '予約の日時を、予定表（カレンダーなど）に入れてある',
    ],
  },
  {
    pattern: /申請|申し込|申込|手続|届け?出|提出|登録/,
    sentences: (name) => [
      `「${name}」の書類・入力を提出し終えている（出し先と出した日が分かる）`,
      '提出したことを、受付番号・控え・受付完了のメールのどれかで確かめられる形で残している',
      '次に必要なこと（結果の連絡・追加の書類など）と、その期限が分かっている',
    ],
  },
  {
    pattern: /支払|払う|払い|振込|振り込|納付|精算/,
    sentences: (name) => [
      `「${name}」で支払う金額と支払先が、請求の内容と合っている`,
      '支払いが済んだことを、領収書・明細・振込の控えのどれかで確かめられる',
      '支払いの期限があるなら、その期限より前に済ませている',
    ],
  },
  {
    pattern: /購入|買う|買い|注文|取り寄せ/,
    sentences: (name) => [
      `「${name}」で買うもの（品名・数・サイズや色など）が決まっていて、その通りに注文・購入している`,
      '注文・購入できたことを、注文番号・注文確認のメール・レシートのどれかで確かめられる',
      '受け取る日（届く日）が分かっている、または受け取り済み',
    ],
  },
  {
    pattern: /連絡|電話|返信|返事|伝え|問い合わせ|相談する|メールする|送る/,
    sentences: (name) => [
      `「${name}」の用件を、相手に伝え終えている`,
      '伝えたことを、送ったメッセージ・メール・通話の記録のどれかで確かめられる',
      '返事が要る用件なら、返事を受け取っている（または待つ期限が決まっている）',
    ],
  },
];

/** Places and errands that are not software work, without a known shape of their own. */
const ERRAND_HINT =
  /歯医者|病院|医院|役所|区役所|市役所|銀行|郵便|買い物|掃除|片付け|洗濯|引っ越し|更新/;

/** Bounded task name for the sentences ラピ writes herself. */
export function taskName(title: string): string {
  return title.trim().slice(0, 120) || 'このタスク';
}

/**
 * What kind of task this is, from its wording.
 *
 * NOTE: Read from the task's own fields only, never from the criteria. The
 * criteria change on the card (and ラピ's errand sentences mention "画面"), so
 * reading them would let an edit flip the kind — and with it every verifier —
 * between the draft and the confirm.
 *
 * @param input - Title, description and goals / タスクの文言
 * @returns 'software', 'errand' or 'unknown' / タスクの種類
 */
export function detectTaskKind(input: SupplementInput): TaskKind {
  const text = [input.title, input.description ?? '', ...(input.goals ?? [])].join('\n');
  if (SOFTWARE.test(text)) return 'software';
  if (ERRANDS.some((e) => e.pattern.test(text)) || ERRAND_HINT.test(text)) return 'errand';
  return 'unknown';
}

/**
 * The supplements for a task, most specific first.
 *
 * Goals and constraints come first (they are what the user said). Then the
 * sentences of the task's kind. The verifier is part of each sentence: the
 * jury only gets sentences a diff can show.
 *
 * @param input - The task's own fields / タスク自身の項目
 * @param kind - From {@link detectTaskKind} / タスクの種類
 * @returns Candidate criteria / 補う完了条件の候補
 */
export function supplementCandidates(
  input: SupplementInput,
  kind: TaskKind,
): SupplementCandidate[] {
  const name = taskName(input.title);
  const goals = input.goals ?? [];
  const constraints = input.constraints ?? [];
  // A diff can show a goal or constraint only when the task is a change to software.
  const said: CriterionVerifier = kind === 'software' ? 'jury' : 'user';
  const fromUser: SupplementCandidate[] = [
    ...goals.map((g) => ({
      text:
        kind === 'software'
          ? `目標「${g}」が達成されたことを、変更内容または成果物で示せる`
          : `目標「${g}」が達成されたことを、本人が結果（記録・画面・書類など）で確かめられる`,
      verifier: said,
    })),
    ...constraints.map((c) => ({
      text:
        kind === 'software'
          ? `制約「${c}」を守っている（変更内容で確かめられる）`
          : `制約「${c}」を守れたことを、本人が確かめている`,
      verifier: said,
    })),
  ];

  if (kind === 'software') {
    return [
      ...fromUser,
      {
        text: `「${name}」の変更が入っていて、変更したファイル・画面・コマンドの場所を示せる`,
        verifier: 'jury',
      },
      {
        text: `「${name}」に関係しない既存の機能やデータを壊していない（関連するテストや確認手順が通る）`,
        verifier: 'jury',
      },
      {
        text: `「${name}」の結果を本人が実際に操作して、求めていた動きだと確かめられる`,
        verifier: 'user',
      },
    ];
  }

  const text = [input.title, input.description ?? '', ...goals].join('\n');
  const errand = ERRANDS.find((e) => e.pattern.test(text));
  if (errand) {
    return [
      ...fromUser,
      ...errand.sentences(name).map((s) => ({ text: s, verifier: 'user' as const })),
    ];
  }

  // Not enough to be specific (an errand without a known shape, or unknown).
  // Still sentences the person can check, but flagged so the card asks for
  // them to be rewritten into the actual result before confirming.
  return [
    ...fromUser,
    {
      text: `「${name}」の結果（できたもの・決まったこと）を、本人が見て確かめられる`,
      verifier: 'user',
      generic: true,
    },
    {
      text: `「${name}」の結果が、本人が後から確かめられる形（記録・写真・メールなど）で残っている`,
      verifier: 'user',
      generic: true,
    },
    {
      text: `「${name}」について、ほかに残っている作業が無いことを本人が確かめている`,
      verifier: 'user',
      generic: true,
    },
  ];
}
