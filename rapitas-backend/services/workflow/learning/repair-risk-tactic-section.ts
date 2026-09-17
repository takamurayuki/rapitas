/**
 * repair-risk-tactic-section
 *
 * Prompt entry point of the repair-risk predictor: classifies the phase about
 * to run and, only when its cell is high-risk, returns a fixed-template tactic
 * block (more detail / worked examples / explicit constraints) and records a
 * prediction snapshot. Does not distill anything — recurring concrete misses
 * are critic-lessons' job; this block only says "this shape of run bounces".
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import {
  REPAIR_RISK_PREDICTION_ACTION,
  REPAIR_RISK_SEVERE_RATE,
  repairRiskInputBounds,
  repairRiskMinSamples,
  repairRiskThreshold,
  type RepairRiskStream,
} from './repair-risk-constants';
import {
  bucketKey,
  classifyComplexity,
  classifyInputLength,
  classifyRisk,
  type RepairRiskClassification,
} from './repair-risk-model';
import { fetchTaskComplexity, getBucketTable, resolveInputLength } from './repair-risk-inputs';

const log = createLogger('repair-risk');

/** Snapshot stored in ActivityLog.metadata. */
export interface RepairRiskPredictionSnapshot extends RepairRiskClassification {
  stream: RepairRiskStream;
  inputChars: number;
  inputSource: string;
  complexityScore: number;
  threshold: number;
  minSamples: number;
}

type Tactic = 'detail' | 'examples' | 'constraints';

const TACTIC_TEXT: Record<'ja' | 'en', Record<Tactic, Record<RepairRiskStream, string>>> = {
  ja: {
    detail: {
      research:
        '詳細度UP: 依存関係・既存実装・破壊的変更リスクを file:line 付きで具体的に書き、推測で埋めない。',
      plan: '詳細度UP: チェックリスト項目ごとに対象ファイル・期待動作・確認方法を明記する。',
      implement: '詳細度UP: 計画の各チェック項目と差分の対応を1件ずつ確認してから完了とする。',
      verify:
        '詳細度UP: 各判定に実測値（コマンド・終了コード・件数）を添え、形容詞だけの評価をしない。',
    },
    examples: {
      research: '具体例追加: 主張ごとに該当コード片または実測結果を1つ以上添える。',
      plan: '具体例追加: 境界値・エッジケースの入出力例を計画に書く。',
      implement: '具体例追加: 正常系・異常系それぞれ1件以上のテストケースを実装と同時に追加する。',
      verify: '具体例追加: 失敗時は失敗したテスト名とエラーメッセージを原文で引用する。',
    },
    constraints: {
      research: '制約明示: 未確認の前提は「未確認」と明記し、スコープ外の調査に広げない。',
      plan: '制約明示: 変更予定ファイル表に無いファイルを触らないこと、受入条件を縮小しないことを明記する。',
      implement:
        '制約明示: 計画外ファイルの変更・受入条件の無言縮小・テストのモックによる欠落隠しをしない。',
      verify: '制約明示: 実測と矛盾する合格判定や、未実施の工程を完了扱いにしない。',
    },
  },
  en: {
    detail: {
      research:
        'More detail: cite dependencies, existing code and breaking-change risks with file:line; do not fill gaps by guessing.',
      plan: 'More detail: give every checklist item its target file, expected behaviour and how to check it.',
      implement: 'More detail: map every plan checklist item to the diff before declaring done.',
      verify: 'More detail: back every verdict with a measurement (command, exit code, counts).',
    },
    examples: {
      research: 'Worked examples: attach at least one code excerpt or measurement per claim.',
      plan: 'Worked examples: include input/output examples for boundaries and edge cases.',
      implement:
        'Worked examples: add at least one happy-path and one failure-path test alongside the change.',
      verify: 'Worked examples: on failure, quote the failing test name and error verbatim.',
    },
    constraints: {
      research:
        'Explicit constraints: mark unverified premises as unverified; do not widen the investigation.',
      plan: 'Explicit constraints: state that files outside the change table are off-limits and criteria are not narrowed.',
      implement:
        'Explicit constraints: no out-of-plan files, no silent narrowing of criteria, no mocks hiding gaps.',
      verify:
        'Explicit constraints: never report a pass that contradicts measurements or count unrun steps as done.',
    },
  },
};

/**
 * Tactics for a high-risk cell. Worked examples are added only for severe
 * cells — they cost the most context.
 *
 * @param repairRate - Cell bounce rate. / セルの差し戻し率
 * @returns Tactics in render order. / 適用する戦術
 */
export function selectTactics(repairRate: number): Tactic[] {
  return repairRate >= REPAIR_RISK_SEVERE_RATE
    ? ['detail', 'examples', 'constraints']
    : ['detail', 'constraints'];
}

/**
 * Render the tactic block; '' unless the classification is high-risk.
 *
 * @param c - Classification. / 判定結果
 * @param stream - Phase. / 実行段階
 * @param language - Output language. / 出力言語
 * @returns Markdown block or ''. / 注入ブロック
 */
export function renderRepairRiskTacticSection(
  c: RepairRiskClassification,
  stream: RepairRiskStream,
  language: 'ja' | 'en',
): string {
  if (c.risk !== 'high') return '';
  const pct = Math.round(c.repairRate * 100);
  const lines = selectTactics(c.repairRate).map((t) => `- ${TACTIC_TEXT[language][t][stream]}`);
  const head =
    language === 'ja'
      ? `## 差し戻し高リスク判定（複雑度×入力長×実行段階: ${c.bucketKey}）\n過去の同条件の実行 ${c.sampleSize} 件中 ${pct}% が差し戻されています。次の戦術を必ず適用してください。`
      : `## High repair-risk run (complexity × input length × phase: ${c.bucketKey})\n${pct}% of ${c.sampleSize} past runs of this shape were bounced. Apply these tactics.`;
  return `${head}\n${lines.join('\n')}`;
}

/**
 * Persist a high-risk prediction. Fail-open.
 *
 * @param taskId - Task id. / タスクID
 * @param snapshot - Prediction at the moment it was made. / 予測スナップショット
 */
export async function recordRepairRiskPrediction(
  taskId: number,
  snapshot: RepairRiskPredictionSnapshot,
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        taskId,
        action: REPAIR_RISK_PREDICTION_ACTION,
        metadata: JSON.stringify(snapshot),
      },
    });
  } catch (err) {
    log.warn({ err, taskId }, '[repair-risk] failed to record prediction (non-fatal)');
  }
}

/**
 * Build the tactic block for a phase about to run. Returns '' on low /
 * indeterminate risk and on any error — a learning aid must never block the
 * workflow.
 *
 * @param taskId - Task id. / タスクID
 * @param task - Task description holder. / タスク
 * @param stream - Phase about to run. / 実行段階
 * @param language - Output language. / 出力言語
 * @returns Markdown block or ''. / 注入ブロック
 */
export async function buildRepairRiskTacticSection(
  taskId: number,
  task: { description: string | null },
  stream: RepairRiskStream,
  language: 'ja' | 'en',
): Promise<string> {
  try {
    const complexityScore = await fetchTaskComplexity(taskId);
    const complexity = classifyComplexity(complexityScore);
    if (complexity === null || complexityScore === null) return '';
    const [input, table] = await Promise.all([
      resolveInputLength(taskId, task, stream),
      getBucketTable(),
    ]);
    const bounds = repairRiskInputBounds();
    const key = bucketKey(complexity, classifyInputLength(input.chars, bounds), stream);
    const threshold = repairRiskThreshold();
    const minSamples = repairRiskMinSamples();
    const c = classifyRisk(key, table, { minSamples, threshold });
    if (c.risk !== 'high') return '';
    await recordRepairRiskPrediction(taskId, {
      ...c,
      stream,
      inputChars: input.chars,
      inputSource: input.source,
      complexityScore,
      threshold,
      minSamples,
    });
    return renderRepairRiskTacticSection(c, stream, language);
  } catch (err) {
    log.debug({ err, taskId, stream }, '[repair-risk] tactic section skipped');
    return '';
  }
}
