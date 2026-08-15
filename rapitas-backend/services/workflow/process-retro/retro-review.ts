/**
 * RetroReview
 *
 * Orchestration of the process retrospective for one completed task: toggle
 * gate → evidence bundle → clean-round skip → ONE aux-AI call → parse/select →
 * dedup-keyed concern filing. Entirely fail-open: every failure is logged and
 * recorded as a retro_review_failed timeline event, never rethrown into the
 * completion path. NOT the artifact-content retrospective
 * (services/ai/retrospective-service.ts) — this reviews process metadata only.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { submitConcern } from '../../memory/concern-backlog-service';
import { resolveSelfDevelopmentThemeId } from '../self-development-theme';
import { appendEvent } from '../../memory/timeline';
import { sendAIMessage } from '../../../utils/ai-client';
import { buildEvidenceBundle, fetchRetroRows, isCleanRound } from './retro-evidence';
import { buildDedupKey, parseFindingsResult, selectConcerns } from './retro-parse';
import { RETRO_SYSTEM_PROMPT, buildRetroPrompt, formatEvidenceSummary } from './retro-prompt';
import { readRetroReviewEnabled } from './retro-settings-store';
import type { EvidenceBundle, RetroCategory, RetroFinding } from './retro-types';

const log = createLogger('workflow:process-retro');

/** Japanese labels used in filed concern titles. */
const CATEGORY_LABELS: Record<RetroCategory, string> = {
  critic_loop: '批評差し戻しの反復',
  repair_loop: '修復ループ',
  replan_loop: '再計画ループ',
  anomaly_cause: '異常cause検出',
  phase_wallclock: 'フェーズ所要時間の異常',
  gate_jurisdiction: 'ゲート管轄逸脱',
  process_other: 'その他のプロセス摩擦',
};

/** Truncation limit for concern titles (long titles hurt task conversion). */
const TITLE_MAX_CHARS = 120;
/** Findings are a few short items at most — 1500 tokens is ample. */
const RETRO_MAX_TOKENS = 1500;

function buildConcernTitle(finding: RetroFinding): string {
  return `[回顧] ${CATEGORY_LABELS[finding.category]}: ${finding.recommendation}`.slice(
    0,
    TITLE_MAX_CHARS,
  );
}

function buildConcernDetail(
  finding: RetroFinding,
  bundle: EvidenceBundle,
  detectedAtIso: string,
): string {
  return [
    '## 回顧所見(プロセス摩擦)',
    `- カテゴリ: ${finding.category} (${CATEGORY_LABELS[finding.category]})`,
    `- 系統性: systemic / 深刻度: ${finding.severity}`,
    `- 検出日時: ${detectedAtIso} / 観測タスク: #${bundle.taskId}`,
    '',
    '## 教育提案',
    finding.recommendation,
    '',
    '## 根拠',
    finding.evidence || '(AI出力に根拠記載なし — 下記の証拠バンドル要約を参照)',
    '',
    '## 証拠バンドル要約',
    formatEvidenceSummary(bundle),
  ].join('\n');
}

/**
 * Run the process retrospective for one completed task. Fire-and-forget
 * semantics: never throws; failures degrade to a warn log plus a
 * retro_review_failed timeline event and file nothing (fail-open). The aux AI
 * is called at most once per task, and not at all on clean rounds or when the
 * retroReviewEnabled toggle is off.
 *
 * @param taskId - The completed task to review. / 回顧対象の完了タスク
 */
export async function runProcessRetro(taskId: number): Promise<void> {
  try {
    if (!readRetroReviewEnabled()) {
      log.debug({ taskId }, '[process-retro] disabled by retroReviewEnabled toggle — skipped');
      return;
    }

    const rows = await fetchRetroRows(taskId);
    const task = await prisma.task
      .findUnique({ where: { id: taskId }, select: { title: true } })
      .catch(() => null);

    // Active self-experiment context (task 562): informational only — the AI
    // must know an intervention is running so it does not misattribute its
    // effect as systemic friction. Never enters isCleanRound. Best-effort.
    const experimentInfo = await import('../../self-learning/experiment-loop/experiment-store')
      .then(({ readActiveExperiment }) => {
        const active = readActiveExperiment();
        return active
          ? { role: active.role, hypothesisId: active.hypothesisId, statement: active.statement }
          : undefined;
      })
      .catch(() => undefined);

    const bundle = buildEvidenceBundle(rows, { taskId, title: task?.title ?? '' }, experimentInfo);

    if (isCleanRound(bundle)) {
      log.debug({ taskId }, '[process-retro] clean round — AI call skipped');
      return;
    }

    // One aux-AI call per task, no retry (the next completed task is the retry).
    const response = await sendAIMessage({
      provider: 'claude',
      systemPrompt: RETRO_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildRetroPrompt(bundle) }],
      maxTokens: RETRO_MAX_TOKENS,
    });

    const parsed = parseFindingsResult(response.content);
    if (parsed.parseFailed) {
      log.warn({ taskId }, '[process-retro] findings parse failed — fail-open (nothing filed)');
      await appendEvent({
        eventType: 'retro_review_failed',
        actorType: 'system',
        payload: { taskId, reason: 'parse_failed' },
        correlationId: `task_${taskId}`,
      }).catch(() => {});
      return;
    }

    const selected = selectConcerns(parsed.findings);
    if (selected.length === 0) {
      log.info(
        { taskId, findings: parsed.findings.length },
        '[process-retro] no systemic finding above threshold — nothing filed',
      );
      return;
    }

    const detectedAtIso = new Date().toISOString();
    // Retrospective findings are about the WORKFLOW ENGINE (critic bounces,
    // repair loops, phase timings), so they belong to the theme that develops
    // rapitas — not to whichever project the reviewed task happened to touch.
    // See self-development-theme.ts for the incident this prevents.
    const selfThemeId = await resolveSelfDevelopmentThemeId();
    for (const finding of selected) {
      await submitConcern({
        ...(selfThemeId != null ? { themeId: selfThemeId } : {}),
        title: buildConcernTitle(finding),
        detail: buildConcernDetail(finding, bundle, detectedAtIso),
        type: 'other',
        severity: finding.severity,
        originTaskId: taskId,
        source: 'process_retro',
        dedupKey: buildDedupKey(finding.category, finding.slug),
      });
    }
    log.info(
      { taskId, filed: selected.length, categories: selected.map((f) => f.category) },
      '[process-retro] retro concerns filed',
    );
  } catch (err) {
    log.warn({ err, taskId }, '[process-retro] retro review failed — fail-open (nothing filed)');
    await appendEvent({
      eventType: 'retro_review_failed',
      actorType: 'system',
      payload: { taskId, reason: err instanceof Error ? err.message : String(err) },
      correlationId: `task_${taskId}`,
    }).catch(() => {});
  }
}
