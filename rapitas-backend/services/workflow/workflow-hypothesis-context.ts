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
            '## 仮説思考の指示',
            '- 調査で「正しいか不明だが検証で明らかになりそうな事象」に気づいたら、research.md に `## 仮説` 見出しを設け、1行1件 `- [domain] 反証可能な主張` の形式で列挙せよ（domain: codebase|agent-behavior|performance|architecture）。**保存時に自動で台帳へ起票される**。質問形（?）や12文字未満は不可。タスクは作らない。',
            `- 上記の検証待ち仮説に関わる事実を見つけたら証拠を記録: \`POST /hypotheses/:id/evidence {stance:"for"|"against", detail, artifact, taskId:${taskId}, phase}\`。`,
            '- **artifact は必ず具体的に**（file:line / テスト名 / 計測値 / #PR）。曖昧な証拠は拒否される。立証は推測ではなく根拠で。',
          ].join('\n')
        : [
            '## Hypothesis-thinking instructions',
            '- Spotted something uncertain-but-testable while investigating? Add a `## 仮説` (Hypotheses) heading to research.md and list one per line as `- [domain] falsifiable claim` (domain: codebase|agent-behavior|performance|architecture); they are AUTO-FILED to the ledger on save. No questions (?) or <12 chars. Do NOT create a task.',
            `- Found a fact bearing on an open hypothesis? Record evidence: \`POST /hypotheses/:id/evidence {stance:"for"|"against", detail, artifact, taskId:${taskId}, phase}\`.`,
            '- The artifact MUST be concrete (file:line / test name / measurement / #PR). Hand-wavy evidence is rejected.',
          ].join('\n'),
    );

    return parts.join('\n\n');
  } catch {
    return '';
  }
}
