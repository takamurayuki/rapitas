/**
 * workflow-hypothesis-context
 *
 * Builds the 仮説台帳 (Hypothesis Ledger) block injected into agent prompts so
 * hypotheses are tested as a byproduct of normal work: it lists OPEN hypotheses
 * the agent should look for evidence on, surfaces already-PROVEN/REFUTED findings
 * as established knowledge, and tells the agent how to record evidence or file a
 * new conjecture — all via the HTTP API, never by spawning a task.
 */
import { prisma } from '../../config/database';
import { listHypotheses, type HypothesisEntry } from '../memory/hypothesis-service';

/** How many open / proven hypotheses to surface (keep the prompt bounded). */
const MAX_OPEN = 6;
const MAX_PROVEN = 4;

/** One-line summary of a hypothesis for the prompt. */
function line(h: HypothesisEntry): string {
  const conf = Math.round(h.confidence * 100);
  return `- [#${h.id}] (${h.domain}, 確信度${conf}%) ${h.statement}`;
}

/**
 * Builds the hypothesis-ledger context block for a task's theme. Always returns
 * the "how to contribute" guidance (so the ledger gets seeded even when empty);
 * lists open + proven hypotheses when any exist.
 *
 * @param taskId - The task being worked on (for evidence provenance). / 対象タスクID
 * @param language - Prompt language. / プロンプト言語
 * @returns The block, or '' on error. / 注入ブロック
 */
export async function buildHypothesisContext(
  taskId: number,
  language: 'ja' | 'en' = 'ja',
): Promise<string> {
  try {
    const taskRow = await prisma.task
      .findUnique({ where: { id: taskId }, select: { themeId: true } })
      .catch(() => null);
    const themeId = taskRow?.themeId ?? undefined;

    const [open, supported, refuted] = await Promise.all([
      listHypotheses({ status: 'open', themeId, limit: MAX_OPEN }),
      listHypotheses({ status: 'supported', themeId, limit: MAX_PROVEN }),
      listHypotheses({ status: 'refuted', themeId, limit: MAX_PROVEN }),
    ]);

    const ja = language === 'ja';
    const parts: string[] = [];
    parts.push(ja ? '# 仮説台帳 (Hypothesis Ledger)' : '# Hypothesis Ledger');

    if (open.hypotheses.length > 0) {
      parts.push(
        ja
          ? '## 検証待ちの仮説 — 調査/実装/検証中にこれらに関わる**具体的事実**に当たったら証拠を記録せよ'
          : '## Open hypotheses — if your work yields CONCRETE facts bearing on these, record evidence',
      );
      parts.push(open.hypotheses.map(line).join('\n'));
    }
    if (supported.hypotheses.length > 0) {
      parts.push(
        ja ? '## 立証済み（信頼してよい確定知見）' : '## Supported (established — rely on these)',
      );
      parts.push(supported.hypotheses.map(line).join('\n'));
    }
    if (refuted.hypotheses.length > 0) {
      parts.push(
        ja
          ? '## 反証済み（この前提に基づく案は避けよ）'
          : '## Refuted (do not pursue ideas resting on these)',
      );
      parts.push(refuted.hypotheses.map(line).join('\n'));
    }

    // Always include the contribution guide — this is what seeds and advances the
    // ledger. Evidence MUST carry a concrete artifact or the API rejects it (422).
    parts.push(
      ja
        ? [
            '## 仮説思考の指示（深い推論の核 — 必須）',
            '- **research.md の末尾に必ず `## 仮説` セクションを設けよ。** このタスク/コードベースについて「いま正しいか不明だが、検証で真偽が決まる」事柄を深く推論し、1行1件 `- [domain] 反証可能な主張` の形式で1〜3件記載する（domain: codebase|agent-behavior|performance|architecture）。**保存時に自動で台帳へ起票される。** 質問形（?）や12文字未満は不可。本当に該当が無い時のみ `- なし` と記す。タスクは作らない。',
            `- 上記の検証待ち仮説に関わる事実を見つけたら \`POST /hypotheses/:id/evidence\` で証拠を記録する。**本文は妥当な JSON であること**（キーは必ず二重引用符で囲む。下は書式の説明ではなく、そのまま送れる形の例）: \`{"stance":"for","detail":"根拠の要約","artifact":"path/to/file.ts:42","taskId":${taskId},"phase":"research"}\`。stance は "for" か "against" のいずれか一方を選ぶ。`,
            '- 本文に日本語・引用符・改行を含む場合は、コマンドラインに直接埋めず一時ファイルへ書いて `-d @body.json` で送ること（シェルのクォート差で本文が壊れ、400 Failed to parse JSON になる）。',
            '- **artifact は必ず具体的に**（file:line / テスト名 / 計測値 / #PR）。曖昧な証拠は拒否される。立証は推測ではなく根拠で。',
            '- **verify フェーズでは、このタスクが起こした上記の検証待ち仮説について `## 仮説評価` セクションを verify.md に必ず設けよ。** 各仮説を1行 `- [#id] 成立|不成立: 根拠(file:line/テスト/計測)` で判定する。**行頭は必ず上の台帳の `[#id]`（例 `[#3097]`）をそのまま使う — `[domain]` ではない。** **成立は予測が実際に的中した場合のみ**（タスクが完了したから、は不可）。判定した仮説は検証済み知識へ昇格／反証される。確証が持てなければ記載しない（検証待ちのまま残す）。',
          ].join('\n')
        : [
            '## Hypothesis-thinking instructions (core of deep reasoning — required)',
            '- **Always add a `## 仮説` (Hypotheses) section at the end of research.md.** Reason deeply about this task/codebase and list 1-3 "uncertain now but testable" claims, one per line as `- [domain] falsifiable claim` (domain: codebase|agent-behavior|performance|architecture). AUTO-FILED to the ledger on save. No questions (?) or <12 chars. Write `- なし` only when genuinely none. Do NOT create a task.',
            `- Found a fact bearing on an open hypothesis? Record it with \`POST /hypotheses/:id/evidence\`. **The body must be valid JSON** (quote every key; the following is a sendable example, not a shape description): \`{"stance":"for","detail":"what you found","artifact":"path/to/file.ts:42","taskId":${taskId},"phase":"research"}\`. Pick exactly one of "for" / "against".`,
            '- If the body contains quotes, newlines or non-ASCII text, write it to a temp file and send `-d @body.json` rather than inlining it — shell quoting differences corrupt the body and the request fails with 400 Failed to parse JSON.',
            '- The artifact MUST be concrete (file:line / test name / measurement / #PR). Hand-wavy evidence is rejected.',
            '- **In the verify phase, add a `## 仮説評価` section to verify.md** judging each open hypothesis this task formed, one per line as `- [#id] 成立|不成立: evidence(file:line/test/metric)`. **成立 (confirmed) only when the prediction ACTUALLY held** (not merely because the task completed). Judged hypotheses graduate to validated knowledge or are refuted. Omit any you cannot judge confidently (leave it open).',
          ].join('\n'),
    );

    return parts.join('\n\n');
  } catch {
    return '';
  }
}
