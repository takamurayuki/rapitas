/**
 * miss-signature-suggester
 *
 * Generates detection-cue suggestions (signature + required explanation text)
 * from recorded DetectionMissCase rows via ONE aux-AI call per case, capped
 * per run. Every suggestion lands as pending_review — nothing is applied here
 * (see miss-signature-service.ts for review/apply). Previously rejected
 * signatures are fed back as a do-not-repropose list, so failed candidates
 * inform the next analysis instead of recycling.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';

const log = createLogger('self-improvement:miss-suggester');

/** Max cases turned into suggestions per run (LLM cost + noise bound). */
const SUGGEST_BATCH_DEFAULT = 3;

/** Bounds for AI-provided fields (drop-invalid, fail-open). */
const SIGNATURE_MAX_CHARS = 160;
const EXPLANATION_MAX_CHARS = 600;

/** Suggestion payload extracted from the AI response. */
export interface ParsedSuggestion {
  signature: string;
  explanation: string;
  /** Stable slug derived from the signature, used in the dedup key. */
  signatureKey: string;
}

/** A miss case as the prompt builder consumes it. */
export interface SuggestibleCase {
  id: number;
  taskId: number;
  gate: string;
  reason: string;
  evidenceJson: string;
}

/**
 * Normalize a signature into a stable dedup slug (same shape as retro-parse's
 * normalizeSlug): lowercase, non-alnum runs → single hyphens, ≤60 chars.
 * Returns null when nothing usable survives — the suggestion is then dropped.
 *
 * @param raw - AI-provided signature text. / AI出力の兆候文字列
 * @returns Normalized key, or null when invalid. / 正規化キー(不正はnull)
 */
export function normalizeSignatureKey(raw: string): string | null {
  const key = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return /^[a-z0-9][a-z0-9-]{2,59}$/.test(key) ? key : null;
}

/**
 * Parse the AI response into validated suggestions. Structural failures yield
 * an empty list (fail-open); individually invalid entries are dropped.
 *
 * @param raw - AI response text. / AI応答テキスト
 * @returns Validated suggestions (possibly empty). / 検証済み提案
 */
export function parseSuggestions(raw: string): ParsedSuggestion[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== 'object') return [];
  const suggestions = (parsed as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) return [];

  const out: ParsedSuggestion[] = [];
  for (const s of suggestions) {
    if (s === null || typeof s !== 'object') continue;
    const rec = s as Record<string, unknown>;
    const signature =
      typeof rec.signature === 'string' ? rec.signature.trim().slice(0, SIGNATURE_MAX_CHARS) : '';
    const explanation =
      typeof rec.explanation === 'string'
        ? rec.explanation.trim().slice(0, EXPLANATION_MAX_CHARS)
        : '';
    // The explanation text is a hard requirement (task spec: 生成ルールには
    // 説明テキスト付与) — a cue without a WHY is unreviewable, so drop it.
    if (!signature || !explanation) continue;
    const signatureKey = normalizeSignatureKey(signature);
    if (signatureKey === null) continue;
    out.push({ signature, explanation, signatureKey });
  }
  return out;
}

/**
 * Build the analysis prompt for one miss case. Exported for tests.
 *
 * @param missCase - The recorded miss case. / 記録済み事例
 * @param rejectedSignatures - Previously rejected cues (do not repropose). / 棄却済み兆候
 * @returns The user prompt. / プロンプト本文
 */
export function buildSuggestionPrompt(
  missCase: SuggestibleCase,
  rejectedSignatures: string[],
): string {
  return `あなたは品質ゲートの検出漏れを分析する専門家です。
以下は、品質ゲートを素通りして事後に判明した欠陥事例です。

## 事例
- 検出元ゲート: ${missCase.gate}
- 対象タスク: #${missCase.taskId}
- 素通し理由: ${missCase.reason}
- 証拠: ${missCase.evidenceJson}

## 棄却済みの兆候（再提案禁止 — 過去に人間が不適切と判断したもの）
${rejectedSignatures.length > 0 ? rejectedSignatures.map((s) => `- ${s}`).join('\n') : '(なし)'}

同型の欠陥を次回は完了前に捕まえるための「兆候」を1件だけ提案してください。
制約:
- signature は検証者・レビュアーが機械的に確認できる観察可能な兆候（英語のスラッグ調でもよい）
- explanation はなぜその兆候がこの型の欠陥を予測するのかの説明（日本語、1〜3文）
- 検出ルールのコード生成はしない。観察すべき兆候の記述のみ
- 出力は次のJSONのみ: {"suggestions":[{"signature":"...","explanation":"..."}]}`;
}

/**
 * Generate suggestions for miss cases that have none yet. One aux-AI call per
 * case, at most `limit` cases per run; every failure is per-case fail-open.
 *
 * @param opts.limit - Max cases this run (default env / 3). / 1回の処理上限
 * @returns Number of suggestions created. / 生成件数
 */
export async function generateMissSuggestions(opts: { limit?: number } = {}): Promise<number> {
  const envBatch = parseInt(process.env.RAPITAS_MISS_SUGGEST_BATCH ?? '', 10);
  const limit =
    opts.limit ?? (Number.isFinite(envBatch) && envBatch > 0 ? envBatch : SUGGEST_BATCH_DEFAULT);

  let cases: SuggestibleCase[];
  let rejectedSignatures: string[];
  try {
    const suggested = await prisma.missSignatureSuggestion.findMany({
      select: { caseId: true },
    });
    const suggestedCaseIds = suggested
      .map((s: { caseId: number | null }) => s.caseId)
      .filter((id: number | null): id is number => id !== null);

    cases = await prisma.detectionMissCase.findMany({
      where: { id: { notIn: suggestedCaseIds } },
      select: { id: true, taskId: true, gate: true, reason: true, evidenceJson: true },
      orderBy: { detectedAt: 'desc' },
      take: limit,
    });

    const rejected = await prisma.missSignatureSuggestion.findMany({
      where: { status: 'rejected' },
      select: { signature: true },
      orderBy: { reviewedAt: 'desc' },
      take: 50,
    });
    rejectedSignatures = rejected.map((r: { signature: string }) => r.signature);
  } catch (err) {
    log.warn({ err }, '[miss-suggester] candidate query failed — fail-open (nothing generated)');
    return 0;
  }

  let created = 0;
  for (const missCase of cases) {
    try {
      const response = await sendAIMessage({
        messages: [{ role: 'user', content: buildSuggestionPrompt(missCase, rejectedSignatures) }],
        maxTokens: 700,
      });
      const [suggestion] = parseSuggestions(response.content);
      if (!suggestion) {
        log.warn({ caseId: missCase.id }, '[miss-suggester] no valid suggestion in AI output');
        continue;
      }
      await prisma.missSignatureSuggestion.create({
        data: {
          caseId: missCase.id,
          signature: suggestion.signature,
          explanation: suggestion.explanation,
          status: 'pending_review',
          dedupKey: `suggest:${missCase.gate}:${suggestion.signatureKey}`,
        },
      });
      created++;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'P2002') {
        // Same cue already proposed for this gate — noise control, not an error.
        log.debug({ caseId: missCase.id }, '[miss-suggester] duplicate cue skipped');
      } else {
        log.warn({ err, caseId: missCase.id }, '[miss-suggester] suggestion failed — continuing');
      }
    }
  }
  if (created > 0) {
    log.info({ created }, '[miss-suggester] suggestions created — awaiting review');
  }
  return created;
}
