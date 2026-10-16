/**
 * outage-slack-notifier
 *
 * Builds Slack Block Kit payloads for outage assessments (verdict + evidence
 * dependency paths) and back-test summaries, and posts them to the team's
 * Incoming Webhook. Sending never throws — a Slack failure must not fail the
 * assessment. Does not compute verdicts.
 */
import { createLogger } from '../../config/logger';
import type { OutageAssessment, OutageVerdict, SimulationReport } from './outage-guidance.types';

const log = createLogger('outage-guidance:slack');

/** Evidence paths listed per message; the rest is summarized as a count. */
export const MAX_SLACK_PATHS = 10;
// Slack rejects section text above 3000 chars; keep a margin for the ellipsis.
const MAX_BLOCK_TEXT = 2900;

/** Japanese verdict labels shown to the team. */
export const VERDICT_LABELS: Record<OutageVerdict, string> = {
  safe: '停止安全',
  risk: 'リスク',
  danger: '危険',
};

/** Minimal Block Kit payload (mrkdwn sections only). */
export interface OutageSlackPayload {
  text: string;
  blocks: Array<{ type: 'section'; text: { type: 'mrkdwn'; text: string } }>;
}

/** Outcome of a send attempt. */
export interface OutageSlackResult {
  sent: boolean;
  reason?: 'no_webhook' | 'network_error' | `http_${number}`;
}

function section(text: string): OutageSlackPayload['blocks'][number] {
  const clipped = text.length > MAX_BLOCK_TEXT ? `${text.slice(0, MAX_BLOCK_TEXT - 1)}…` : text;
  return { type: 'section', text: { type: 'mrkdwn', text: clipped } };
}

function label(id: string, names: Readonly<Record<string, string>>): string {
  return `${names[id] ?? id}(${id})`;
}

/**
 * Builds the assessment message: verdict + service, the numbers behind it,
 * and the dependency paths that justify each impact.
 *
 * @param assessment - Result to publish / 通知する判定結果
 * @param serviceNames - id → display name / サービスID→表示名
 * @returns Slack payload / Slackペイロード
 */
export function buildOutageSlackPayload(
  assessment: OutageAssessment,
  serviceNames: Readonly<Record<string, string>>,
): OutageSlackPayload {
  const verdictLabel = VERDICT_LABELS[assessment.verdict];
  const target = label(assessment.targetServiceId, serviceNames);
  const pct = (assessment.blastRatio * 100).toFixed(1);
  const shown = assessment.affected.slice(0, MAX_SLACK_PATHS);
  const rest = assessment.affected.length - shown.length;
  const pathLines = shown.map(
    (a) => `• ${a.path.map((id) => label(id, serviceNames)).join(' → ')}`,
  );
  if (rest > 0) pathLines.push(`…他 ${rest} 件`);
  const pathsText =
    pathLines.length > 0 ? pathLines.join('\n') : '影響を受ける依存サービスはありません';

  return {
    text: `[停止影響判定] ${target}: ${verdictLabel}`,
    blocks: [
      section(`*停止影響判定: ${verdictLabel}*\n対象: ${target}`),
      section(
        [
          `推定復旧: ${assessment.estimatedRecoveryMinutes} 分 / 許容時間(影響下限): ${assessment.toleranceMinutes} 分`,
          `影響サービス: ${assessment.affected.length} 件 (波及率 ${pct}%) / 復旧履歴: ${assessment.historySamples} 件`,
          `根拠: ${assessment.reasons.join(', ')}`,
        ].join('\n'),
      ),
      section(`*根拠となった依存パス*\n${pathsText}`),
    ],
  };
}

/**
 * Builds the back-test summary message.
 *
 * @param report - Simulation result / シミュレーション結果
 * @param team - Team name, if any / チーム名
 * @returns Slack payload / Slackペイロード
 */
export function buildSimulationSlackPayload(
  report: SimulationReport,
  team?: string,
): OutageSlackPayload {
  const statusLabel =
    report.status === 'passed' ? '合格' : report.status === 'failed' ? '基準未達' : 'データ不足';
  const acc = `${(report.accuracy * 100).toFixed(1)}%`;
  const head = `障害影響判定シミュレーション${team ? ` (${team})` : ''}`;
  const mismatchLines = report.mismatches
    .slice(0, MAX_SLACK_PATHS)
    .map(
      (m) =>
        `• ${m.incidentId}: 正解 ${VERDICT_LABELS[m.expected]} / 予測 ${VERDICT_LABELS[m.predicted]}`,
    );
  if (report.mismatches.length > MAX_SLACK_PATHS) {
    mismatchLines.push(`…他 ${report.mismatches.length - MAX_SLACK_PATHS} 件`);
  }
  return {
    text: `[${head}] ${statusLabel}: 精度 ${acc}`,
    blocks: [
      section(
        `*${head}: ${statusLabel}*\n精度 ${acc} (${report.correct}/${report.total}) / 基準 ${(report.threshold * 100).toFixed(0)}%`,
      ),
      section(`*不一致*\n${mismatchLines.length > 0 ? mismatchLines.join('\n') : 'なし'}`),
    ],
  };
}

/**
 * Webhook URL: RAPITAS_OUTAGE_SLACK_WEBHOOK_URL (team channel), else
 * UserSettings.slackWebhookUrl. Never throws.
 *
 * @returns URL or null when none is configured / 未設定ならnull
 */
export async function resolveSlackWebhookUrl(): Promise<string | null> {
  const fromEnv = process.env.RAPITAS_OUTAGE_SLACK_WEBHOOK_URL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  try {
    // Lazy import keeps Prisma out of module load (scheduler tests mock around it).
    const { prisma } = await import('../../config/database');
    const settings = (await prisma.userSettings.findFirst()) as Record<string, unknown> | null;
    const url = settings?.slackWebhookUrl;
    return typeof url === 'string' && url.trim().length > 0 ? url : null;
  } catch (err) {
    log.warn({ err }, 'Failed to read Slack webhook from user settings');
    return null;
  }
}

/**
 * Posts a payload to Slack. Never throws.
 *
 * @param payload - Block Kit payload / 送信するペイロード
 * @param opts - webhookUrl overrides resolution (null = none) / 送信先の明示指定
 * @returns Whether it was sent, and why not / 送信結果
 */
export async function sendOutageSlack(
  payload: OutageSlackPayload,
  opts: { webhookUrl?: string | null } = {},
): Promise<OutageSlackResult> {
  const url = 'webhookUrl' in opts ? opts.webhookUrl : await resolveSlackWebhookUrl();
  if (!url) {
    log.info('No Slack webhook configured — outage guidance notification skipped');
    return { sent: false, reason: 'no_webhook' };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, 'Slack rejected outage guidance notification');
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    log.warn({ err }, 'Failed to send outage guidance notification');
    return { sent: false, reason: 'network_error' };
  }
}
