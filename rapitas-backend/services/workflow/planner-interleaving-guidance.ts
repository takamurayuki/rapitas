/**
 * planner-interleaving-guidance
 *
 * Prompt text that makes the planner enumerate every check-then-act step on
 * shared state (who can interleave, what a crash leaves behind, the guard,
 * the test that reproduces it), and the matching verifier cross-check. Not
 * responsible for deciding whether a task touches shared state — the planner
 * judges that from the change.
 *
 * NOTE: Tasks 1519 and 1521 (2026-11-20/21, a dev-all lock and PID file)
 * bounced 9 and 3+ times. Each round's reviewer found one more interleaving
 * (stale lock blocks every start → self PID → a lock taken over between the
 * final check and the delete). The premortem asks for the 3 most likely
 * failures, which does not make anyone walk every check-then-act pair, so the
 * plan never saw the next one until a reviewer did.
 *
 * NOTE: The planner then accepted (「許容」) 1521's concurrent-takeover window,
 * the one window in which two starts both run — what the task exists to
 * prevent. The verifier honoured the acceptance and the diff review blocked it
 * (2026-11-21), so acceptance is now barred for any window that breaks what an
 * acceptance criterion promises.
 */

/** Heading the planner writes and the verifier looks for. */
export const INTERLEAVING_HEADING = '## 状態と割り込み';

const PLANNER_JA = `${INTERLEAVING_HEADING}（共有状態を扱う場合は必須）
変更が、複数のプロセス・リクエスト・スレッド・再起動の前後から読み書きされる状態（ロックファイル、PID ファイル、一時ファイル、DB 行の読み取り→更新、キュー、キャッシュ）を扱う場合、plan.md に \`${INTERLEAVING_HEADING}\` セクションを設けて、**確認してから操作する箇所を全て**表にしてください。上位3件ではなく全数です。

| 確認→操作 | 間に割り込める者と結果 | 途中で落ちたら何が残るか・誰が回収するか | 守り方（または許容する理由） | 再現テスト |
| --- | --- | --- | --- | --- |

- 「割り込める者」は、同じ処理のもう1つの実行（二重起動）、逆の処理（起動と停止）、自分自身の再起動を必ず検討する。
- 守り方は、既存の排他手段（排他作成・内容の再確認つき削除など）の再利用を優先し、新しい機構は既存手段で守れない行にだけ使う。
- 許容する窓は「許容」と書き、理由を1行添える。許容と書いた行は承認済みの設計判断として扱われる。
- ただし、**受入条件が防ぐと約束していることを破る窓は許容しない**（例: 二重起動を防ぐタスクで、同時に2つ起動できてしまう窓）。その窓には守り方を設計する。守れない場合は、計画で受入条件の見直しを質問する。
- 再現テストは、ファイル操作や生存確認を注入して割り込みの順序を決め打ちで再現するものにする（タイミング任せの並行実行にしない）。
- 共有状態を扱わない変更なら、このセクションは \`${INTERLEAVING_HEADING}\`: 対象なし（理由1行）とだけ書く。`;

const PLANNER_EN = `${INTERLEAVING_HEADING} (REQUIRED when the change touches shared state)
If the change reads or writes state that several processes, requests, threads or restarts can touch (lock files, PID files, temp files, read-then-update of a DB row, queues, caches), add a \`${INTERLEAVING_HEADING}\` section to plan.md listing **every** check-then-act step — all of them, not the top 3.

| Check → act | Who can interleave, and the result | What a crash midway leaves, and who reclaims it | Guard (or why the window is accepted) | Reproducing test |
| --- | --- | --- | --- | --- |

- Always consider a second run of the same operation (double start), the opposite operation (start vs stop), and a restart of the process itself.
- Prefer reusing an existing exclusion (exclusive create, delete only after re-checking the content) and add a new mechanism only for rows those cannot guard.
- Mark an accepted window as 「許容」 with a one-line reason; an accepted row is an approved design decision.
- But **never accept a window that breaks what an acceptance criterion promises to prevent** (e.g. a window that lets two starts both run, in a task that prevents double starts). Design a guard for it, or ask in the plan to revisit the criterion.
- Reproduce each interleaving deterministically by injecting the file operations or liveness probe — never by racing real processes.
- If the change touches no shared state, write only \`${INTERLEAVING_HEADING}\`: 対象なし with a one-line reason.`;

const VERIFIER_JA = `
### 状態と割り込みの照合（plan.md に \`${INTERLEAVING_HEADING}\` の表がある場合のみ）
- 表の各行について、再現テストが存在して通るかを確認し、verify.md の \`## 状態と割り込みの照合\` に1行ずつ \`- <確認→操作>: 再現テストあり・通過|なし|失敗（根拠）\` で記載する。
- 「許容」と書かれた窓は承認済みの設計判断。その窓だけを理由に ❌ にしない。ただし、その窓で受入条件の目的が破れる（例: 二重起動防止なのに2つ起動できる）なら、許容自体を誤りとして ❌ にし、根拠の順序を書く。
- 表に無い割り込みを見つけた場合は、その順序（誰が・どの行の間に）を具体的に書いて残課題にする。表の不足として扱い、次の計画で行を足せるようにする。`;

const VERIFIER_EN = `
### Interleaving cross-check (only when plan.md has a \`${INTERLEAVING_HEADING}\` table)
- For each row, check that its reproducing test exists and passes, and record it in verify.md under \`## 状態と割り込みの照合\` as \`- <check → act>: test present and passing | missing | failing (evidence)\`.
- A window marked 「許容」 is an approved design decision; do not mark ❌ for that window alone — unless that window breaks what an acceptance criterion promises (e.g. two starts both run in a double-start guard); then the acceptance itself is wrong: mark ❌ and give the order of events.
- If you find an interleaving the table lacks, state the exact order (who, between which steps) as outstanding work, as a gap in the table the next plan can add a row for.`;

/**
 * Planner directive to enumerate check-then-act steps on shared state.
 *
 * @param language - Prompt language / プロンプトの言語
 * @returns The directive text / 指示文
 */
export function plannerInterleavingGuidance(language: string): string {
  return language === 'en' ? PLANNER_EN : PLANNER_JA;
}

/**
 * Append the interleaving cross-check to the verifier instruction, only when
 * the plan carries the table the planner was asked for.
 *
 * @param instruction - Verifier instruction so far / 検証役への指示
 * @param plan - plan.md content, or null for lightweight tasks / plan.md の内容
 * @param language - Prompt language / プロンプトの言語
 * @returns The instruction, extended when the plan has the table / 追記後の指示
 */
export function withInterleavingCheck(
  instruction: string,
  plan: string | null | undefined,
  language: string,
): string {
  if (!plan || !plan.includes(INTERLEAVING_HEADING)) return instruction;
  // "対象なし" means the planner judged no shared state; nothing to cross-check.
  const section = plan.slice(
    plan.indexOf(INTERLEAVING_HEADING),
    plan.indexOf(INTERLEAVING_HEADING) + 200,
  );
  if (/対象なし/.test(section) && !section.includes('|')) return instruction;
  return `${instruction}\n${language === 'en' ? VERIFIER_EN : VERIFIER_JA}`;
}
